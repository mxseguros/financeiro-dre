import { OpcoesCentro, nomeCentro } from '@/lib/centros'
import { CampoAnexos, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import { useEffect, useId, useState } from 'react'
import { api } from '@/lib/api'
import { cn, mesAtual } from '@/lib/utils'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AvisoRecorrencia, type SerieRecorrencia } from './AvisoRecorrencia'
import { BlocoPagamento, estadoPagamentoVazio, pagamentoPreenchido, salvarPagamento, type EstadoPagamento, type ResumoPagamento } from '@/components/pagamentos/BlocoPagamento'
import { type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Despesa, type DespesasResp, type Classificacao, type Receita } from './shared'
import { DicaEspelhoIndisponivel, ESPELHO_VAZIO, FaixaVinculo, PainelEspelho, ehEmprestimo, payloadEspelho, useVinculo, type EspelhoForm } from './Emprestimo'
import {
  Campo, CaixaInterruptor, Checklist, ContadorParcelas, EscolhaBotoes, Historico, ResumoFaixa, ResumoValor, Secao,
  SeloClassificacao, atalhoSalvar, campoCls, corBanco, mesAno, type EstadoItem,
} from './FormLancamento'
import { Selo, hojeISO, situacaoDespesa } from './situacao'

// Limites espelhados de DespesaCreate/DespesaUpdate (app/models/schemas.py).
// Sem eles o backend devolvia 422 e a tela mostrava só "HTTP 422".
// Parcelas: sem limite de negócio (pedido de 07/10/2026). 999 é só teto técnico —
// cada parcela vira um lançamento mensal, e um erro de digitação como "12000"
// gravaria milhares de linhas de uma vez.
const MAX_PARCELAS = 999
const DESCRICAO_MIN = 3
const DESCRICAO_MAX = 500
const SUBCATEGORIA_MAX = 100

/** Último mês aceito como competência: até 2 meses à frente do atual (AAAA-MM). */
function competenciaMaxima(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + 2)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface ModalDespesaProps {
  token: string
  categorias: Categoria[]
  tipos: TipoLancamento[]
  bancos: Banco[]
  centros: CentroCusto[]
  despesa?: Despesa
  mesDefault?: string
  onClose: () => void
  onSaved: () => void
  classificacoes?: Classificacao[]
  /** Editando: mostra Excluir no rodapé (o botão saiu da linha da tabela, redesenho UX). */
  onExcluir?: () => void
  /** Empréstimo vinculado: abre o lado receita no lugar deste modal. */
  onAbrirVinculado?: (tipo: 'despesa' | 'receita', item: Despesa | Receita) => void
}

export function ModalDespesa({ token, categorias, tipos, bancos, centros, despesa, mesDefault, onClose, onSaved, classificacoes, onExcluir, onAbrirVinculado }: ModalDespesaProps) {
  const editando = !!despesa
  const tipoInicial = despesa ? tipos.find(t => t.id === despesa.tipo_lancamento_id) : undefined
  const [form, setForm] = useState({
    categoria_id:       tipoInicial?.categoria_id ?? '',
    tipo_lancamento_id: despesa?.tipo_lancamento_id ?? '',
    banco_id:           despesa?.banco_id ?? '',
    descricao:          despesa?.descricao ?? '',
    competencia:        despesa ? despesa.competencia.slice(0, 7) : (mesDefault ?? mesAtual()[0].slice(0, 7)),
    data_vencimento:    despesa?.data_vencimento ?? '',
    paga_em:            despesa?.paga_em ?? '',
    // Sem padrão: "matriz" virou grupo (0044) e o backend recusa lançamento nele.
    centro_custo:       despesa?.centro_custo ?? '',
    recorrente:         despesa?.recorrente ?? false,
    repetir_ate:        '',
    // Parcelamento
    // A API serializa Decimal como texto ("4500.00") — Number() antes de formatar.
    valor_parcela:      despesa ? Number(despesa.valor).toFixed(2) : '',
    num_parcelas:       String(despesa?.parcela_total ?? 1),
  })
  // Classificação é do LANÇAMENTO (migration 0040): ao escolher o subitem,
  // vem preenchida com o padrão dele, se ainda estiver vazia.
  const [classificacao, setClassificacao] = useState(despesa?.custo_tipo ?? '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [anexosPendentes, setAnexosPendentes] = useState<AnexoPendente[]>([])
  // Salvou, mas algum anexo falhou: não deixa salvar de novo (duplicaria a despesa).
  const [falhaAnexos, setFalhaAnexos] = useState<string | null>(null)
  // Bloco "Pagamento" (CNAB, 0050): gravado depois da despesa.
  const [pagamento, setPagamento] = useState<EstadoPagamento>(estadoPagamentoVazio())
  // Empréstimo (28/11/2026): receita espelho na criação; faixa do vínculo na edição.
  const [espelho, setEspelho] = useState<EspelhoForm>(ESPELHO_VAZIO)
  const vinculado = useVinculo(token, 'despesa', despesa?.id)
  // Novo layout (28/11/2026): "Já foi paga" mostra a Data de Pagamento.
  const [pagaLigada, setPagaLigada] = useState(!!despesa?.paga_em)
  const [resumoPagto, setResumoPagto] = useState<ResumoPagamento | null>(null)
  const [nAnexos, setNAnexos] = useState(0)
  const formId = useId()

  // Se o modal abriu antes de a taxonomia terminar de carregar, a categoria
  // nasceu vazia — o useState acima só calcula o valor inicial uma vez — e o
  // Salvar ficava barrado por "Selecione a categoria.". Completa quando os
  // subitens chegarem, sem sobrescrever uma escolha já feita pelo usuário.
  useEffect(() => {
    if (!despesa?.tipo_lancamento_id) return
    const t = tipos.find(x => x.id === despesa.tipo_lancamento_id)
    if (!t?.categoria_id) return
    setForm(f => (f.categoria_id ? f : { ...f, categoria_id: t.categoria_id as string }))
  }, [tipos, despesa?.tipo_lancamento_id])

  const limparErro = (k: string) => setErros(e => (k in e ? { ...e, [k]: '' } : e))
  const set = (k: string, v: string | boolean) => {
    setForm(f => ({ ...f, [k]: v }))
    limparErro(k)
  }

  function selecionarCategoria(categoriaId: string) {
    setForm(f => ({ ...f, categoria_id: categoriaId, tipo_lancamento_id: '' }))
    limparErro('categoria_id')
  }

  function selecionarSubitem(tipoId: string) {
    set('tipo_lancamento_id', tipoId)
    setClassificacao(c => c || (tipos.find(t => t.id === tipoId)?.custo_tipo ?? ''))
  }

  const categoriasDespesa = categorias.filter(c => c.natureza === 'despesa' && c.ativo)
  const subitensDaCategoria = tipos.filter(t => t.natureza === 'despesa' && t.categoria_id === form.categoria_id)

  const numParcelas = Math.max(1, parseInt(form.num_parcelas) || 1)
  // Digita-se o valor de CADA parcela (o que cai no mes) e o total e derivado.
  // Antes era o inverso: total digitado, dividido por N ao salvar — com
  // arredondamento no meio, ja que no banco `valor` sempre foi por parcela.
  const valorParcela = parseFloat(form.valor_parcela) || 0
  const valorTotal   = valorParcela * numParcelas
  const parcelado    = numParcelas > 1
  const categoriaEmprestimo = ehEmprestimo(categorias.find(c => c.id === form.categoria_id)?.nome)
  const espelhoDisponivel = !editando && categoriaEmprestimo && !parcelado && !form.recorrente
  // Reparcelar reescreve datas e numeração de todo o grupo a partir da 1ª
  // parcela, então o backend só aceita o pedido vindo dela (422 caso contrário).
  const naoEhPrimeiraParcela = !!editando && (despesa?.parcela_atual ?? 1) > 1

  // Recorrência na edição (24/11/2026): a série atual vem da API e o
  // "Repetir até" abre preenchido com o último mês dela.
  const [serie, setSerie] = useState<SerieRecorrencia | null>(null)
  useEffect(() => {
    if (!despesa?.id || (despesa.parcela_total ?? 1) > 1) return
    api.get<SerieRecorrencia>(`/lancamentos/despesas/${despesa.id}/recorrencia`, token)
      .then(s => {
        setSerie(s)
        setForm(f => ({ ...f, recorrente: s.recorrente, repetir_ate: s.ate ? s.ate.slice(0, 7) : '' }))
      })
      .catch(() => {})
  }, [despesa?.id, despesa?.parcela_total, token])
  const mudouRecorrencia = !!serie && (form.recorrente !== serie.recorrente
    || (form.recorrente && form.repetir_ate !== (serie.ate ?? '').slice(0, 7)))

  const nMesesRecorrencia = (() => {
    if (!form.recorrente || !form.repetir_ate || form.repetir_ate < form.competencia) return 0
    const [sy, sm] = form.competencia.split('-').map(Number)
    const [ey, em] = form.repetir_ate.split('-').map(Number)
    return (ey - sy) * 12 + (em - sm) + 1
  })()

  /** Validação por campo — a mensagem aparece ao lado do campo, não em faixa única. */
  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.categoria_id) e.categoria_id = 'Selecione a categoria.'
    if (!form.tipo_lancamento_id) e.tipo_lancamento_id = 'Selecione o subitem.'
    const desc = form.descricao.trim()
    if (!desc) e.descricao = 'Informe a descrição.'
    else if (desc.length < DESCRICAO_MIN) e.descricao = `A descrição precisa de pelo menos ${DESCRICAO_MIN} caracteres.`
    else if (desc.length > DESCRICAO_MAX) e.descricao = `A descrição pode ter no máximo ${DESCRICAO_MAX} caracteres.`
    if (valorParcela <= 0) e.valor_parcela = 'Informe um valor maior que zero.'
    const nParc = parseInt(form.num_parcelas)
    if (form.num_parcelas && (!(nParc >= 1) || nParc > MAX_PARCELAS)) e.num_parcelas = `Informe um número de parcelas entre 1 e ${MAX_PARCELAS}.`
    if (!form.competencia) e.competencia = 'Informe a competência.'
    // A trava de competência futura só existe na criação (DespesaCreate).
    else if (!editando && form.competencia > competenciaMaxima()) e.competencia = 'A competência pode ser no máximo 2 meses à frente.'
    if (!form.data_vencimento) e.data_vencimento = 'Informe a data de vencimento.'
    if (!form.centro_custo) e.centro_custo = 'Selecione o centro de custo.'
    if (pagaLigada && !form.paga_em) e.paga_em = 'Informe a data de pagamento.'
    // Só na criação: o campo "Repetir até" não é desenhado na edição, e exigi-lo
    // ali travava o Salvar de toda despesa recorrente em silêncio (erro num
    // campo invisível).
    if (form.recorrente && !form.repetir_ate && (!editando || (serie && !parcelado))) e.repetir_ate = 'Informe até quando repetir.'
    else if (editando && form.recorrente && form.repetir_ate && form.repetir_ate < form.competencia) e.repetir_ate = 'Não pode ser antes da competência.'
    if (espelhoDisponivel && espelho.ativo && !espelho.tipo_lancamento_id) e.espelho = 'Selecione o subitem da receita.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar(e?: React.FormEvent) {
    e?.preventDefault()
    if (salvando || falhaAnexos) return
    if (!validar()) {
      // Rede de segurança: se algum erro cair num campo fora da tela, o
      // usuário ainda vê que o salvamento foi barrado — nunca mais botão "morto".
      setErro('Revise os campos destacados antes de salvar.')
      return
    }
    setSalvando(true)
    setErro(null)
    const [y, m] = form.competencia.split('-')
    const descricao = form.descricao.trim()
    // `subcategoria` repete a descrição, mas no banco o limite é 100 caracteres
    // (a descrição aceita 500) — descrição longa dava 422 ao salvar.
    const subcategoria = descricao.slice(0, SUBCATEGORIA_MAX)

    try {
      let criadaId: string | undefined
      if (editando) {
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          // O backend reconstrói o grupo quando este número muda; quando é
          // igual ao atual, ignora. `valor` acima já é o valor POR PARCELA.
          num_parcelas:       numParcelas,
        }
        payload.paga_em = form.paga_em || null
        // Só manda a recorrência quando ela mudou: o backend cria, remove ou
        // desmarca as ocorrências seguintes a partir desta.
        if (mudouRecorrencia && !parcelado) {
          payload.recorrente = form.recorrente
          if (form.recorrente) payload.repetir_ate = `${form.repetir_ate}-01`
        }
        await api.patch(`/lancamentos/despesas/${despesa!.id}`, token, payload)
      } else if (parcelado) {
        // Backend cria as N parcelas atomicamente em uma única chamada
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         false,
          num_parcelas:       numParcelas,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        const criada = await api.post<Despesa>('/lancamentos/despesas', token, payload)
        criadaId = criada?.id
        // Guarda de compatibilidade: um backend desatualizado ignora
        // `num_parcelas` e cria apenas 1 registro, sem marcar as parcelas.
        if (criada?.parcela_total !== numParcelas) {
          throw new Error(
            'O servidor está desatualizado e não suporta parcelamento — foi criado apenas 1 lançamento. ' +
            'Exclua-o e contate o administrador para atualizar o backend.'
          )
        }
      } else if (form.recorrente && form.repetir_ate && form.repetir_ate >= form.competencia) {
        // Backend cria um registro por mês atomicamente em uma única chamada
        const [ey, em] = form.repetir_ate.split('-')
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         true,
          repetir_ate:        `${ey}-${em}-01`,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        criadaId = (await api.post<Despesa>('/lancamentos/despesas', token, payload))?.id
        // Guarda de compatibilidade: um backend desatualizado ignora
        // `repetir_ate` e cria apenas o 1º mês. Confere se o último mês existe.
        if (form.repetir_ate > form.competencia) {
          const ultimoDia = new Date(Number(ey), Number(em), 0).getDate()
          const check = await api.get<DespesasResp>(
            `/lancamentos/despesas?inicio=${ey}-${em}-01&fim=${ey}-${em}-${String(ultimoDia).padStart(2, '0')}`, token)
          const criouUltimoMes = (check.items ?? []).some(d =>
            d.descricao === descricao && d.competencia.slice(0, 7) === form.repetir_ate)
          if (!criouUltimoMes) {
            throw new Error(
              'O servidor está desatualizado e não suporta recorrência — foi criado apenas o 1º mês. ' +
              'Exclua-o e contate o administrador para atualizar o backend.'
            )
          }
        }
      } else {
        const payload: Record<string, unknown> = {
          tipo_lancamento_id: form.tipo_lancamento_id || null,
          custo_tipo:         classificacao || null,
          banco_id:           form.banco_id || null,
          descricao,
          subcategoria,
          valor:              valorParcela,
          competencia:        `${y}-${m}-01`,
          data_vencimento:    form.data_vencimento,
          centro_custo:       form.centro_custo,
          recorrente:         form.recorrente,
        }
        if (form.paga_em) payload.paga_em = form.paga_em
        if (espelhoDisponivel) payload.espelho = payloadEspelho(espelho)
        criadaId = (await api.post<Despesa>('/lancamentos/despesas', token, payload))?.id
      }
      // Pagamento: na despesa editada, se mudou; na nova, na 1ª parcela/ocorrência.
      const alvoPagamento = editando ? (pagamento.alterado ? despesa!.id : undefined)
        : (criadaId && pagamentoPreenchido(pagamento) ? criadaId : undefined)
      let falhaPagamento: string | null = null
      if (alvoPagamento) {
        try {
          const avisos = await salvarPagamento(token, alvoPagamento, pagamento)
          if (avisos.length) falhaPagamento = `Despesa salva. Atenção: ${avisos.join(' ')}`
        } catch (e) {
          if (editando) throw e
          falhaPagamento = `A despesa foi salva, mas os dados de pagamento não: ${e instanceof Error ? e.message : 'erro'}. Abra a despesa para corrigir.`
        }
      }
      // Anexos de despesa nova: vão para a 1ª parcela/ocorrência.
      if (criadaId && anexosPendentes.length) {
        const falhas = await enviarAnexos(token, 'despesa', criadaId, anexosPendentes)
        if (falhas.length) {
          onSaved()
          setFalhaAnexos(`A despesa foi salva, mas: ${falhas.join(' ')} Abra a despesa para anexar de novo.${falhaPagamento ? ` ${falhaPagamento}` : ''}`)
          setSalvando(false)
          return
        }
      }
      if (falhaPagamento) {
        onSaved()
        setFalhaAnexos(falhaPagamento)
        setSalvando(false)
        return
      }
      onSaved()
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
      setSalvando(false)
    }
  }

  // ── Novo layout ────────────────────────────────────────────
  const subitem = tipos.find(t => t.id === form.tipo_lancamento_id)
  const categoria = categorias.find(c => c.id === form.categoria_id)
  const bancoNome = bancos.find(b => b.id === form.banco_id)?.nome ?? 'Sem banco'
  const centroNome = form.centro_custo ? nomeCentro(form.centro_custo, centros) : '—'
  const situacao = despesa ? situacaoDespesa({ ...despesa, paga_em: form.paga_em || null, data_vencimento: form.data_vencimento || null }) : null
  const classifNome = classificacao
    ? (classificacoes ?? []).find(c => c.codigo === classificacao)?.nome ?? classificacao.replace('_', ' ')
    : '—'

  function ligarPaga(v: boolean) {
    setPagaLigada(v)
    set('paga_em', v ? (form.paga_em || hojeISO()) : '')
  }

  // "Pronto para remessa?" (CNAB): só faz sentido para despesa em aberto.
  const mostrarRemessa = !!resumoPagto?.habilitado && !form.paga_em
  const itensRemessa: { texto: string; estado: EstadoItem }[] = [
    { texto: 'Valor e vencimento', estado: valorParcela > 0 && form.data_vencimento ? 'ok' : 'falta' },
    { texto: 'Banco pagador', estado: form.banco_id ? 'ok' : 'falta' },
    { texto: 'Forma de pagamento', estado: resumoPagto?.forma ? 'ok' : 'falta' },
    ...(resumoPagto?.forma
      ? [{ texto: resumoPagto.falta ?? (resumoPagto.favorecidoNome ? `Favorecido: ${resumoPagto.favorecidoNome}` : 'Dados do pagamento'),
          estado: (resumoPagto.falta ? 'alerta' : 'ok') as EstadoItem }]
      : []),
    { texto: 'Nota ou boleto anexado (opcional)', estado: nAnexos > 0 ? 'ok' : 'opcional' },
  ]

  const subtitulo = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {situacao && <Selo texto={situacao.texto} tom={situacao.tom} className="text-xs" />}
      <span>
        {categoria && subitem ? `${categoria.nome} › ${subitem.nome} · ` : ''}Competência {mesAno(form.competencia)}
        {!editando && ' · os campos com * são obrigatórios'}
      </span>
    </span>
  )

  const rodape = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      {onExcluir && !falhaAnexos ? (
        <Button type="button" variant="ghost" tone="danger" onClick={onExcluir} disabled={salvando}>Excluir despesa</Button>
      ) : <span />}
      <div className="flex items-center gap-2 sm:gap-3">
        {falhaAnexos ? (
          <Button type="button" onClick={onClose} className="flex-1 sm:flex-none">Fechar</Button>
        ) : (
          <>
            <span className="hidden text-xs text-slate-500 md:inline">Ctrl + Enter para salvar</span>
            <Button type="button" variant="secondary" onClick={onClose} disabled={salvando} className="flex-1 sm:flex-none">Cancelar</Button>
            <Button type="submit" form={formId} loading={salvando} className="flex-[2] sm:flex-none">
              {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : parcelado ? `Criar ${numParcelas} parcelas` : 'Salvar despesa'}
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
      title={editando ? 'Editar despesa' : 'Nova despesa'}
      subtitle={subtitulo}
      variant="sheet"
      maxWidth="sm:max-w-5xl"
      dismissable={!salvando}
      bodyClassName="flex-1 overflow-y-auto border-t border-slate-200 bg-slate-50"
      footer={rodape}
    >
      <ResumoFaixa tema="despesa" rotulo="Valor total" valor={valorTotal}
        detalhe={`${numParcelas}x · ${bancoNome}${form.data_vencimento ? ` · vence ${form.data_vencimento.slice(8, 10)}/${form.data_vencimento.slice(5, 7)}` : ''}`} />

      <form id={formId} onSubmit={salvar} onKeyDown={e => atalhoSalvar(e, () => salvar())} noValidate
        className="flex gap-6 p-4 sm:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <FaixaVinculo token={token} vinculado={vinculado} onAbrir={onAbrirVinculado} />
          {/* Regra de 19/10/2026: Data de Pagamento aprova a despesa (qualquer perfil). */}
          {editando && (form.paga_em ? (
            <p className="rounded-[10px] border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              Com Data de Pagamento, a despesa fica <strong>Aprovada</strong>.
            </p>
          ) : (
            <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Ao salvar, a despesa volta para <strong>Pendente</strong> e precisa de nova aprovação.
            </p>
          ))}

          <Secao n={1} titulo="O que é" tema="despesa">
            <Campo id={`${formId}-desc`} rotulo="Descrição" obrigatorio erro={erros.descricao}>
              <input id={`${formId}-desc`} value={form.descricao} onChange={e => set('descricao', e.target.value)}
                maxLength={DESCRICAO_MAX} placeholder="Ex.: Aluguel sede matriz" aria-invalid={!!erros.descricao}
                className={campoCls(!!erros.descricao, 'text-[15px]')} />
            </Campo>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id={`${formId}-cat`} rotulo="Categoria" obrigatorio erro={erros.categoria_id}>
                <select id={`${formId}-cat`} value={form.categoria_id} onChange={e => selecionarCategoria(e.target.value)}
                  aria-invalid={!!erros.categoria_id} className={campoCls(!!erros.categoria_id)}>
                  <option value="">Selecionar categoria</option>
                  {categoriasDespesa.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </Campo>
              <Campo id={`${formId}-sub`} rotulo="Subitem" obrigatorio erro={erros.tipo_lancamento_id} desabilitado={!form.categoria_id}>
                <select id={`${formId}-sub`} value={form.tipo_lancamento_id} disabled={!form.categoria_id}
                  onChange={e => selecionarSubitem(e.target.value)} aria-invalid={!!erros.tipo_lancamento_id}
                  className={campoCls(!!erros.tipo_lancamento_id)}>
                  <option value="">{form.categoria_id ? 'Selecionar subitem' : 'Escolha a categoria primeiro'}</option>
                  {subitensDaCategoria.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </Campo>
            </div>
            <SeloClassificacao id={`${formId}-classif`} valor={classificacao} padraoSubitem={subitem?.custo_tipo}
              onChange={setClassificacao} classificacoes={classificacoes} natureza="despesa" />
          </Secao>

          {espelhoDisponivel && (
            <PainelEspelho lado="receita" valor={espelho} onChange={v => { setEspelho(v); limparErro('espelho') }}
              categorias={categorias} tipos={tipos} bancos={bancos} centros={centros} erro={erros.espelho}
              base={{ subitemNome: subitem?.nome, banco_id: form.banco_id, centro_custo: form.centro_custo }} />
          )}
          {!editando && categoriaEmprestimo && !espelhoDisponivel && <DicaEspelhoIndisponivel />}

          <Secao n={2} titulo="Quanto e quando" tema="despesa">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo id={`${formId}-valor`} rotulo="Valor da parcela" obrigatorio erro={erros.valor_parcela}>
                <InputMoeda id={`${formId}-valor`} value={form.valor_parcela} onChange={v => set('valor_parcela', v)}
                  className="!h-11 !rounded-[10px] !border-slate-300 !text-lg font-semibold tabular-nums text-right" />
              </Campo>
              <Campo id={`${formId}-parc`} rotulo="Parcelas" erro={erros.num_parcelas}>
                {/* Sempre editável (29/09/2026). Parcelar desmarca "repetir" na criação. */}
                <ContadorParcelas id={`${formId}-parc`} valor={form.num_parcelas} max={MAX_PARCELAS} invalido={!!erros.num_parcelas}
                  onChange={v => {
                    set('num_parcelas', v)
                    if (!editando && (parseInt(v) || 1) > 1 && form.recorrente) set('recorrente', false)
                  }} />
              </Campo>
              <Campo id={`${formId}-comp`} rotulo={naoEhPrimeiraParcela || !parcelado ? 'Competência' : 'Competência (1ª parcela)'} obrigatorio erro={erros.competencia}>
                <input id={`${formId}-comp`} type="month" value={form.competencia} onChange={e => set('competencia', e.target.value)}
                  aria-invalid={!!erros.competencia} className={campoCls(!!erros.competencia)} />
              </Campo>
              <Campo id={`${formId}-venc`} rotulo="Vencimento" obrigatorio erro={erros.data_vencimento}>
                <input id={`${formId}-venc`} type="date" value={form.data_vencimento} onChange={e => set('data_vencimento', e.target.value)}
                  aria-invalid={!!erros.data_vencimento} className={campoCls(!!erros.data_vencimento)} />
              </Campo>
            </div>
            {parcelado && valorParcela > 0 && (
              <p className="text-[13px] text-slate-600">
                {numParcelas} parcelas de <strong>R$ {valorParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> ·
                total <strong>R$ {valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
              </p>
            )}
            {editando && form.recorrente && numParcelas > 1 && (
              <p className="text-xs text-amber-700">Esta despesa é recorrente: ao salvar, a série deste mês em diante vira {numParcelas} parcelas.</p>
            )}
            {naoEhPrimeiraParcela && (
              <p className="text-xs text-slate-500">
                Parcela {despesa?.parcela_atual} de {despesa?.parcela_total}: alterar o número refaz o parcelamento a partir da 1ª parcela.
              </p>
            )}
            {/* Recorrente: não combina com parcelamento. Na edição (24/11/2026), liga, estende,
                encurta ou desliga a série a partir desta despesa. */}
            {!parcelado && (!editando || serie) && (
              <CaixaInterruptor id={`${formId}-rec`} titulo="Repetir todo mês" dica="Cria a mesma despesa nas próximas competências"
                ligado={form.recorrente as boolean} onChange={v => set('recorrente', v)}>
                <div className="flex flex-col gap-2">
                  <Campo id={`${formId}-ate`} rotulo="Repetir até (mês/ano)" obrigatorio erro={erros.repetir_ate} className="max-w-[220px]">
                    <input id={`${formId}-ate`} type="month" value={form.repetir_ate} min={form.competencia}
                      onChange={e => set('repetir_ate', e.target.value)} className={campoCls(!!erros.repetir_ate)} />
                  </Campo>
                  {!editando && nMesesRecorrencia > 1 && (
                    <p className="text-xs text-blue-700">Serão criados <strong>{nMesesRecorrencia} registros</strong> mensais.</p>
                  )}
                  {editando && serie && <AvisoRecorrencia serie={serie} recorrente={form.recorrente} ate={form.repetir_ate} competencia={form.competencia} />}
                </div>
              </CaixaInterruptor>
            )}
          </Secao>

          <Secao n={3} titulo="De onde sai" tema="despesa">
            <EscolhaBotoes rotulo="Banco" tema="despesa" colunas={bancos.length + 1 > 3 ? 4 : bancos.length + 1 === 3 ? 3 : 2}
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

          <Secao n={4} titulo="Pagamento" tema="despesa"
            extra={resumoPagto?.habilitado ? <span className="text-xs text-slate-500">Usado na remessa CNAB</span> : undefined}>
            <BlocoPagamento token={token} despesaId={despesa?.id} valorDespesa={valorParcela}
              valor={pagamento} onChange={setPagamento} embutido onResumo={setResumoPagto} />
            {!editando && pagamentoPreenchido(pagamento) && (parcelado || form.recorrente) && (
              <p className="text-xs text-slate-500">O pagamento fica na {parcelado ? '1ª parcela' : 'despesa do 1º mês'}.</p>
            )}
            {/* Data de Pagamento existe em TODO lançamento (04/08/2026): o interruptor
                abre ligado quando há data e fica disponível em parcela e recorrente. */}
            <CaixaInterruptor id={`${formId}-paga`} titulo="Já foi paga" dica="Ao marcar, aparece a data de pagamento"
              ligado={pagaLigada} onChange={ligarPaga}>
              <div className="flex flex-col gap-2">
                <Campo id={`${formId}-pagaem`} rotulo="Data de pagamento" obrigatorio erro={erros.paga_em} className="max-w-[220px]">
                  <input id={`${formId}-pagaem`} type="date" value={form.paga_em} onChange={e => set('paga_em', e.target.value)}
                    className={campoCls(!!erros.paga_em)} />
                </Campo>
                {!editando && (
                  <p className="text-xs text-green-800">
                    A despesa entra como <strong>Aprovada</strong>{parcelado ? ' (a 1ª parcela; as demais ficam em aberto)' : form.recorrente ? ' (o 1º mês; os demais ficam em aberto)' : ''}.
                  </p>
                )}
              </div>
            </CaixaInterruptor>
          </Secao>

          <Secao titulo="Anexos" tema="despesa">
            <CampoAnexos token={token} entidade="despesa" entidadeId={despesa?.id} variante="area"
              pendentes={anexosPendentes} onPendentes={setAnexosPendentes} onQuantidade={setNAnexos} />
            {!editando && anexosPendentes.length > 0 && (parcelado || form.recorrente) && (
              <p className="text-xs text-slate-500">Os anexos ficam na {parcelado ? '1ª parcela' : 'despesa do 1º mês'}.</p>
            )}
          </Secao>

          {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
          {erro && <p role="alert" className="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}
          {falhaAnexos && <p role="alert" className="rounded-[10px] bg-amber-50 px-3 py-2 text-sm text-amber-800">{falhaAnexos}</p>}
        </div>

        <aside className="hidden w-[280px] flex-none flex-col gap-4 lg:flex">
          <ResumoValor tema="despesa" rotulo="Valor total" valor={valorTotal}
            sub={`${numParcelas} ${numParcelas === 1 ? 'parcela' : 'parcelas'}${form.data_vencimento ? ` · vence ${form.data_vencimento.split('-').reverse().join('/')}` : ''}`}
            linhas={[['Banco', bancoNome], ['Centro de custo', centroNome], ['Classificação', classifNome]]} />
          {mostrarRemessa && <Checklist titulo="Pronto para remessa?" itens={itensRemessa} />}
          {form.paga_em && (
            <div className={cn('rounded-xl border border-green-200 bg-green-50 p-4 text-[13px] text-green-900')}>
              Paga em <strong>{form.paga_em.split('-').reverse().join('/')}</strong>: não entra em remessa.
            </div>
          )}
          <Historico criado={despesa?.criado_em} atualizado={despesa?.atualizado_em} />
        </aside>
      </form>
    </Modal>
  )
}
