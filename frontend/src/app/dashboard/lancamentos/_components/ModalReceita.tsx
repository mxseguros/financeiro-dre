import { OpcoesCentro, nomeCentro } from '@/lib/centros'
import { CampoAnexos, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import { useEffect, useId, useState } from 'react'
import { api } from '@/lib/api'
import { mesAtual } from '@/lib/utils'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Receita, type ReceitasResp,
  type Classificacao, type Despesa,
} from './shared'
import { AvisoRecorrencia, type SerieRecorrencia } from './AvisoRecorrencia'
import { DicaEspelhoIndisponivel, ESPELHO_VAZIO, FaixaVinculo, PainelEspelho, ehEmprestimo, payloadEspelho, useVinculo, type EspelhoForm } from './Emprestimo'
import {
  Campo, CaixaInterruptor, Checklist, EscolhaBotoes, Historico, ResumoFaixa, ResumoValor, Secao,
  SeloClassificacao, atalhoSalvar, campoCls, corBanco, mesAno,
} from './FormLancamento'
import { Selo, hojeISO, situacaoReceita } from './situacao'

/** Forma de recebimento (0054) — espelha o CHECK da migration. */
const FORMAS_RECEBIMENTO = [
  { valor: 'pix', texto: 'Pix' }, { valor: 'ted', texto: 'Transferência (TED)' }, { valor: 'boleto', texto: 'Boleto' },
  { valor: 'deposito', texto: 'Depósito' }, { valor: 'cartao', texto: 'Cartão' }, { valor: 'dinheiro', texto: 'Dinheiro' },
  { valor: 'outro', texto: 'Outro' },
]

interface ModalReceitaProps {
  token: string
  categorias: Categoria[]
  tipos: TipoLancamento[]
  bancos: Banco[]
  centros: CentroCusto[]
  receita?: Receita
  mesDefault?: string
  onClose: () => void
  onSaved: () => void
  classificacoes?: Classificacao[]
  /** Editando: mostra Excluir no rodapé (o botão saiu da linha da tabela, redesenho UX). */
  onExcluir?: () => void
  /** Empréstimo vinculado: abre o lado despesa no lugar deste modal. */
  onAbrirVinculado?: (tipo: 'despesa' | 'receita', item: Despesa | Receita) => void
}

export function ModalReceita({ token, categorias, tipos, bancos, centros, receita, mesDefault, onClose, onSaved, classificacoes, onExcluir, onAbrirVinculado }: ModalReceitaProps) {
  const editando = !!receita
  const tipoInicial = receita ? tipos.find(t => t.id === receita.tipo_lancamento_id) : undefined
  const [form, setForm] = useState({
    categoria_id:       tipoInicial?.categoria_id ?? '',
    tipo_lancamento_id: receita?.tipo_lancamento_id ?? '',
    banco_id:           receita?.banco_id ?? '',
    descricao:          receita?.descricao ?? '',
    valor:              receita ? String(receita.valor) : '',
    competencia:        receita ? receita.competencia.slice(0, 7) : (mesDefault ?? mesAtual()[0].slice(0, 7)),
    data_vencimento:    receita?.data_vencimento ?? '',
    recebido_em:        receita?.recebido_em ?? '',
    // Sem padrão: "matriz" virou grupo (0044) e o backend recusa lançamento nele.
    centro_custo:       receita?.centro_custo ?? '',
    observacao:         receita?.observacao ?? '',
    // Bloco Recebimento (0054).
    recebido_de:        receita?.recebido_de ?? '',
    forma_recebimento:  receita?.forma_recebimento ?? '',
    recorrente:         false,
    data_final:         '',
  })
  const [salvando, setSalvando] = useState(false)
  // Classificação é do LANÇAMENTO (migration 0040): ao escolher o subitem,
  // vem preenchida com o padrão dele, se ainda estiver vazia.
  const [classificacao, setClassificacao] = useState(receita?.custo_tipo ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [anexosPendentes, setAnexosPendentes] = useState<AnexoPendente[]>([])
  // Salvou, mas algum anexo falhou: não deixa salvar de novo (duplicaria a receita).
  const [falhaAnexos, setFalhaAnexos] = useState<string | null>(null)
  // Empréstimo (28/11/2026): despesa espelho na criação; faixa do vínculo na edição.
  const [espelho, setEspelho] = useState<EspelhoForm>(ESPELHO_VAZIO)
  const vinculado = useVinculo(token, 'receita', receita?.id)
  // Novo layout (28/11/2026): "Já foi recebida" mostra a data de recebimento.
  const [recebidaLigada, setRecebidaLigada] = useState(!!receita?.recebido_em)
  const formId = useId()

  // Recorrência na edição (24/11/2026): a série atual vem da API.
  const [serie, setSerie] = useState<SerieRecorrencia | null>(null)
  useEffect(() => {
    if (!receita?.id) return
    api.get<SerieRecorrencia>(`/lancamentos/receitas/${receita.id}/recorrencia`, token)
      .then(s => {
        setSerie(s)
        setForm(f => ({ ...f, recorrente: s.recorrente, data_final: s.ate ? s.ate.slice(0, 7) : '' }))
      })
      .catch(() => {})
  }, [receita?.id, token])
  const mudouRecorrencia = !!serie && (form.recorrente !== serie.recorrente
    || (form.recorrente && form.data_final !== (serie.ate ?? '').slice(0, 7)))

  const limparErro = (k: string) => setErros(e => (k in e ? { ...e, [k]: '' } : e))
  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }))
    limparErro(k)
  }

  function selecionarCategoria(categoriaId: string) {
    setForm(f => ({ ...f, categoria_id: categoriaId, tipo_lancamento_id: '' }))
  }

  function selecionarSubitem(tipoId: string) {
    set('tipo_lancamento_id', tipoId)
    setClassificacao(c => c || (tipos.find(t => t.id === tipoId)?.custo_tipo ?? ''))
  }

  const categoriasReceita = categorias.filter(c => c.natureza === 'receita' && c.ativo)
  const subitensDaCategoria = tipos.filter(t => t.natureza === 'receita' && t.categoria_id === form.categoria_id)
  const categoriaEmprestimo = ehEmprestimo(categorias.find(c => c.id === form.categoria_id)?.nome)
  const espelhoDisponivel = !editando && categoriaEmprestimo && !form.recorrente

  /** Validação por campo — a mensagem aparece ao lado do campo, não em faixa única. */
  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.descricao.trim()) e.descricao = 'Informe a descrição.'
    if (!((parseFloat(form.valor) || 0) > 0)) e.valor = 'Informe um valor maior que zero.'
    if (!form.competencia) e.competencia = 'Informe a competência.'
    if (!form.centro_custo) e.centro_custo = 'Selecione o centro de custo.'
    if (recebidaLigada && !form.recebido_em) e.recebido_em = 'Informe a data de recebimento.'
    if (form.recorrente && !form.data_final) e.data_final = 'Informe até quando repetir.'
    else if (form.recorrente && form.data_final < form.competencia) e.data_final = 'Não pode ser antes da competência.'
    if (espelhoDisponivel && espelho.ativo && !espelho.tipo_lancamento_id) e.espelho = 'Selecione o subitem da despesa.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar(e?: React.FormEvent, criarOutra = false) {
    e?.preventDefault()
    if (salvando || falhaAnexos) return
    if (!validar()) return
    setSalvando(true)
    setErro(null)
    const [y, m] = form.competencia.split('-')
    const compMes = `${y}-${m}-01`

    const basePayload: Record<string, unknown> = {
      tipo_lancamento_id: form.tipo_lancamento_id || null,
      custo_tipo:         classificacao || null,
      banco_id:           form.banco_id || null,
      descricao:          form.descricao,
      valor:              parseFloat(form.valor),
      centro_custo:       form.centro_custo,
    }
    // Na edição vão sempre (vazio limpa); na criação, só se preenchidos.
    if (editando || form.data_vencimento) basePayload.data_vencimento = form.data_vencimento || null
    if (editando || form.recebido_em) basePayload.recebido_em = form.recebido_em || null
    if (form.observacao)  basePayload.observacao  = form.observacao
    if (editando || form.recebido_de.trim()) basePayload.recebido_de = form.recebido_de.trim() || null
    if (editando || form.forma_recebimento) basePayload.forma_recebimento = form.forma_recebimento || null

    try {
      let criadaId: string | undefined
      if (editando) {
        await api.patch(`/lancamentos/receitas/${receita!.id}`, token, {
          ...basePayload,
          competencia: compMes,
          // Só manda a recorrência quando ela mudou (o backend cria/remove as seguintes).
          ...(mudouRecorrencia
            ? { recorrente: form.recorrente, ...(form.recorrente ? { repetir_ate: `${form.data_final}-01` } : {}) }
            : {}),
        })
      } else if (form.recorrente && form.data_final && form.data_final >= form.competencia) {
        // Backend cria um registro por mês atomicamente em uma única chamada
        const [ey, em] = form.data_final.split('-')
        criadaId = (await api.post<Receita>('/lancamentos/receitas', token, {
          ...basePayload,
          competencia: compMes,
          repetir_ate: `${ey}-${em}-01`,
        }))?.id
        // Guarda de compatibilidade: um backend desatualizado ignora
        // `repetir_ate` e cria apenas o 1º mês. Confere se o último mês existe.
        if (form.data_final > form.competencia) {
          const ultimoDia = new Date(Number(ey), Number(em), 0).getDate()
          const check = await api.get<ReceitasResp>(
            `/lancamentos/receitas?inicio=${ey}-${em}-01&fim=${ey}-${em}-${String(ultimoDia).padStart(2, '0')}`, token)
          const criouUltimoMes = (check.items ?? []).some(r =>
            r.origem === 'manual' && r.descricao === form.descricao && r.competencia.slice(0, 7) === form.data_final)
          if (!criouUltimoMes) {
            throw new Error(
              'O servidor está desatualizado e não suporta recorrência — foi criado apenas o 1º mês. ' +
              'Exclua-o e contate o administrador para atualizar o backend.'
            )
          }
        }
      } else {
        criadaId = (await api.post<Receita>('/lancamentos/receitas', token, {
          ...basePayload, competencia: compMes,
          ...(espelhoDisponivel && espelho.ativo ? { espelho: payloadEspelho(espelho) } : {}),
        }))?.id
      }
      // Anexos de receita nova: vão para a do 1º mês.
      if (criadaId && anexosPendentes.length) {
        const falhas = await enviarAnexos(token, 'receita', criadaId, anexosPendentes)
        if (falhas.length) {
          onSaved()
          setFalhaAnexos(`A receita foi salva, mas: ${falhas.join(' ')} Abra a receita para anexar de novo.`)
          setSalvando(false)
          return
        }
      }
      onSaved()
      if (criarOutra) {
        // "Salvar e criar outra": limpa o que muda de uma receita para outra e
        // mantém competência, categoria, banco e centro.
        setForm(f => ({ ...f, descricao: '', valor: '', data_vencimento: '', recebido_em: '', recebido_de: '', observacao: '', recorrente: false, data_final: '' }))
        setRecebidaLigada(false); setAnexosPendentes([]); setEspelho(ESPELHO_VAZIO); setErros({})
        setSalvando(false)
        return
      }
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
      setSalvando(false)
    }
  }

  // ── Novo layout ────────────────────────────────────────────
  const subitem = tipos.find(t => t.id === form.tipo_lancamento_id)
  const categoria = categorias.find(c => c.id === form.categoria_id)
  const valorNum = parseFloat(form.valor) || 0
  const bancoNome = bancos.find(b => b.id === form.banco_id)?.nome ?? 'Sem banco'
  const situacao = receita
    ? situacaoReceita({ ...receita, recebido_em: form.recebido_em || null, data_vencimento: form.data_vencimento || null })
    : null

  function ligarRecebida(v: boolean) {
    setRecebidaLigada(v)
    set('recebido_em', v ? (form.recebido_em || hojeISO()) : '')
  }

  const faltam = [
    { texto: 'Descrição', estado: form.descricao.trim() ? 'ok' : 'falta' },
    { texto: 'Valor', estado: valorNum > 0 ? 'ok' : 'falta' },
    { texto: 'Competência', estado: form.competencia ? 'ok' : 'falta' },
    { texto: 'Centro de custo', estado: form.centro_custo ? 'ok' : 'falta' },
  ] as const
  const prontoParaSalvar = faltam.every(f => f.estado === 'ok')

  const subtitulo = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {situacao
        ? <Selo texto={situacao.texto} tom={situacao.tom} className="text-xs" />
        : <Selo texto="Entrada" tom="verde" className="text-xs" />}
      <span>
        {categoria && subitem ? `${categoria.nome} › ${subitem.nome} · ` : ''}Competência {mesAno(form.competencia)}
        {!editando && ' · os campos com * são obrigatórios'}
      </span>
    </span>
  )

  const rodape = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      {onExcluir && !falhaAnexos ? (
        <Button type="button" variant="ghost" tone="danger" onClick={onExcluir} disabled={salvando}>Excluir receita</Button>
      ) : <span />}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {falhaAnexos ? (
          <Button type="button" onClick={onClose} className="flex-1 sm:flex-none">Fechar</Button>
        ) : (
          <>
            <span className="hidden text-xs text-slate-500 md:inline">Ctrl + Enter para salvar</span>
            <Button type="button" variant="secondary" onClick={onClose} disabled={salvando} className="flex-1 sm:flex-none">Cancelar</Button>
            {!editando && (
              <Button type="button" variant="secondary" onClick={() => salvar(undefined, true)} disabled={salvando || !prontoParaSalvar}
                className="hidden text-green-800 sm:inline-flex">
                Salvar e criar outra
              </Button>
            )}
            <Button type="submit" form={formId} loading={salvando} disabled={!prontoParaSalvar}
              className="flex-[2] !bg-green-700 hover:!bg-green-800 sm:flex-none">
              {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar receita'}
            </Button>
          </>
        )}
      </div>
    </div>
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? 'Editar receita' : 'Nova receita'}
      subtitle={subtitulo}
      variant="sheet"
      maxWidth="sm:max-w-5xl"
      dismissable={!salvando}
      bodyClassName="flex-1 overflow-y-auto border-t border-slate-200 bg-slate-50"
      footer={rodape}
    >
      <ResumoFaixa tema="receita" rotulo="Valor a receber" valor={valorNum}
        detalhe={`${mesAno(form.competencia)} · ${bancoNome}`} />

      <form id={formId} onSubmit={salvar} onKeyDown={e => atalhoSalvar(e, () => salvar())} noValidate
        className="flex gap-6 p-4 sm:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <FaixaVinculo token={token} vinculado={vinculado} onAbrir={onAbrirVinculado} />

          <Secao n={1} titulo="O que é" tema="receita">
            <Campo id={`${formId}-desc`} rotulo="Descrição" obrigatorio erro={erros.descricao}>
              <input id={`${formId}-desc`} value={form.descricao} onChange={e => set('descricao', e.target.value)}
                placeholder="Ex.: Comissão extra Porto – outubro" aria-invalid={!!erros.descricao}
                className={campoCls(!!erros.descricao, 'text-[15px] focus:border-green-600')} />
            </Campo>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id={`${formId}-cat`} rotulo="Categoria">
                <select id={`${formId}-cat`} value={form.categoria_id} onChange={e => selecionarCategoria(e.target.value)} className={campoCls()}>
                  <option value="">Selecionar categoria</option>
                  {categoriasReceita.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              <Campo id={`${formId}-sub`} rotulo="Subitem" desabilitado={!form.categoria_id}>
                <select id={`${formId}-sub`} disabled={!form.categoria_id} value={form.tipo_lancamento_id}
                  onChange={e => selecionarSubitem(e.target.value)} className={campoCls()}>
                  <option value="">{form.categoria_id ? 'Selecionar subitem' : 'Escolha a categoria primeiro'}</option>
                  {subitensDaCategoria.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </Campo>
            </div>
            {subitem?.somente_dre && (
              <p className="rounded-[10px] border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                Este subitem consta <strong>apenas na DRE</strong>: a receita não entra na Visão Geral nem nos totais de Lançamentos.
              </p>
            )}
            <SeloClassificacao id={`${formId}-classif`} valor={classificacao} padraoSubitem={subitem?.custo_tipo}
              onChange={setClassificacao} classificacoes={classificacoes} natureza="receita" />
          </Secao>

          {espelhoDisponivel && (
            <PainelEspelho lado="despesa" valor={espelho} onChange={v => { setEspelho(v); limparErro('espelho') }}
              categorias={categorias} tipos={tipos} bancos={bancos} centros={centros} erro={erros.espelho}
              base={{ subitemNome: subitem?.nome, banco_id: form.banco_id, centro_custo: form.centro_custo }} />
          )}
          {!editando && categoriaEmprestimo && !espelhoDisponivel && <DicaEspelhoIndisponivel />}

          <Secao n={2} titulo="Quanto e quando" tema="receita">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id={`${formId}-valor`} rotulo="Valor" obrigatorio erro={erros.valor}>
                <InputMoeda id={`${formId}-valor`} value={form.valor} onChange={v => set('valor', v)}
                  className="!h-11 !rounded-[10px] !border-slate-300 !text-lg font-semibold tabular-nums text-right" />
              </Campo>
              <Campo id={`${formId}-comp`} rotulo="Competência" obrigatorio erro={erros.competencia}>
                <input id={`${formId}-comp`} type="month" value={form.competencia} onChange={e => set('competencia', e.target.value)}
                  aria-invalid={!!erros.competencia} className={campoCls(!!erros.competencia)} />
              </Campo>
              <Campo id={`${formId}-venc`} rotulo="Previsão de recebimento">
                <input id={`${formId}-venc`} type="date" value={form.data_vencimento} onChange={e => set('data_vencimento', e.target.value)}
                  className={campoCls()} />
              </Campo>
            </div>
            {/* Receita recorrente — na edição (24/11/2026), a partir desta receita. */}
            {(!editando || serie) && (
              <CaixaInterruptor id={`${formId}-rec`} titulo="Repetir todo mês" dica="Cria a mesma receita nas próximas competências"
                ligado={form.recorrente as boolean} onChange={v => set('recorrente', v)}>
                <div className="flex flex-col gap-2">
                  <Campo id={`${formId}-ate`} rotulo="Repetir até (mês/ano)" obrigatorio erro={erros.data_final} className="max-w-[220px]">
                    <input id={`${formId}-ate`} type="month" value={form.data_final} min={form.competencia}
                      onChange={e => set('data_final', e.target.value)} className={campoCls(!!erros.data_final)} />
                  </Campo>
                  {editando && serie && <AvisoRecorrencia serie={serie} recorrente={form.recorrente} ate={form.data_final} competencia={form.competencia} />}
                  {!editando && form.data_final && form.data_final >= form.competencia && (() => {
                    const [sy, sm] = form.competencia.split('-').map(Number)
                    const [ey, em] = form.data_final.split('-').map(Number)
                    const n = (ey - sy) * 12 + (em - sm) + 1
                    return n > 1 ? <p className="text-xs text-blue-700">Serão criados <strong>{n} registros</strong> mensais.</p> : null
                  })()}
                </div>
              </CaixaInterruptor>
            )}
          </Secao>

          <Secao n={3} titulo="Para onde vai" tema="receita">
            <EscolhaBotoes rotulo="Banco" tema="receita" colunas={bancos.length + 1 > 3 ? 4 : bancos.length + 1 === 3 ? 3 : 2}
              valor={form.banco_id} onChange={v => set('banco_id', v)}
              opcoes={[...bancos.map(b => ({ valor: b.id, texto: b.nome, ponto: corBanco(b.nome) })), { valor: '', texto: 'Sem banco' }]} />
            <Campo id={`${formId}-cc`} rotulo="Centro de custo" obrigatorio erro={erros.centro_custo} className="sm:max-w-[50%]">
              <select id={`${formId}-cc`} value={form.centro_custo} onChange={e => set('centro_custo', e.target.value)}
                aria-invalid={!!erros.centro_custo} className={campoCls(!!erros.centro_custo)}>
                <option value="">Selecionar centro de custo</option>
                <OpcoesCentro centros={centros} atual={form.centro_custo} />
              </select>
            </Campo>
          </Secao>

          <Secao n={4} titulo="Recebimento" tema="receita">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id={`${formId}-de`} rotulo="Recebido de">
                <input id={`${formId}-de`} value={form.recebido_de} maxLength={200} onChange={e => set('recebido_de', e.target.value)}
                  placeholder="Seguradora ou cliente" className={campoCls()} />
              </Campo>
              <Campo id={`${formId}-forma`} rotulo="Forma de recebimento">
                <select id={`${formId}-forma`} value={form.forma_recebimento} onChange={e => set('forma_recebimento', e.target.value)} className={campoCls()}>
                  <option value="">Pix, transferência, boleto…</option>
                  {FORMAS_RECEBIMENTO.map(f => <option key={f.valor} value={f.valor}>{f.texto}</option>)}
                </select>
              </Campo>
            </div>
            {/* Data de recebimento existe em toda receita (04/08/2026): abre ligado quando há data. */}
            <CaixaInterruptor id={`${formId}-recebida`} titulo="Já foi recebida" dica="Ao marcar, aparece a data de recebimento"
              ligado={recebidaLigada} onChange={ligarRecebida}>
              <div className="flex flex-col gap-2">
                <Campo id={`${formId}-recem`} rotulo="Data de recebimento" obrigatorio erro={erros.recebido_em} className="max-w-[220px]">
                  <input id={`${formId}-recem`} type="date" value={form.recebido_em} onChange={e => set('recebido_em', e.target.value)}
                    className={campoCls(!!erros.recebido_em)} />
                </Campo>
                {!editando && form.recorrente && (
                  <p className="text-xs text-slate-500">A data vale para o 1º mês; os demais ficam em aberto para recebimento mês a mês.</p>
                )}
              </div>
            </CaixaInterruptor>
          </Secao>

          <Secao titulo="Anexos" tema="receita">
            <CampoAnexos token={token} entidade="receita" entidadeId={receita?.id} variante="area"
              dicaArea="extrato de comissão, nota fiscal, comprovante"
              pendentes={anexosPendentes} onPendentes={setAnexosPendentes} />
          </Secao>

          {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
          {erro && <p role="alert" className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
          {falhaAnexos && <p role="alert" className="rounded-[10px] bg-amber-50 px-3 py-2 text-sm text-amber-800">{falhaAnexos}</p>}
          {!prontoParaSalvar && (
            <p className="text-xs text-slate-500 lg:hidden">
              Falta para salvar: {faltam.filter(f => f.estado !== 'ok').map(f => f.texto.toLowerCase()).join(', ')}.
            </p>
          )}
        </div>

        <aside className="hidden w-[280px] flex-none flex-col gap-4 lg:flex">
          <ResumoValor tema="receita" rotulo="Valor a receber" valor={valorNum}
            sub={valorNum ? (form.data_vencimento ? `Previsto para ${form.data_vencimento.split('-').reverse().join('/')}` : 'Sem previsão de recebimento') : 'Informe o valor para ver o resumo'}
            linhas={[['Competência', mesAno(form.competencia)], ['Banco', bancoNome],
              ['Centro de custo', form.centro_custo ? nomeCentro(form.centro_custo, centros) : '—'],
              ['Status', form.recebido_em ? `Recebida ${form.recebido_em.slice(8, 10)}/${form.recebido_em.slice(5, 7)}` : 'A receber']]} />
          {!prontoParaSalvar ? (
            <Checklist titulo="Falta para salvar" itens={[...faltam]}
              rodape={!form.tipo_lancamento_id ? 'Recomendado: categoria e subitem, para a receita entrar certa no DRE.' : undefined} />
          ) : !form.tipo_lancamento_id ? (
            <Checklist titulo="Pronto para salvar" itens={[...faltam, { texto: 'Categoria e subitem (recomendado)', estado: 'opcional' }]} />
          ) : null}
          <Historico criado={receita?.criado_em} atualizado={receita?.atualizado_em} />
        </aside>
      </form>
    </Modal>
  )
}
