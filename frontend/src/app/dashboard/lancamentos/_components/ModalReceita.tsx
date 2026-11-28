import { OpcoesCentro } from '@/lib/centros'
import { CampoAnexos, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { mesAtual } from '@/lib/utils'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import {
  Campo, inputCls, selectCls,
  type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Receita, type ReceitasResp,
  type Classificacao, type Despesa, classificacoesDe,
} from './shared'
import { DicaEspelhoIndisponivel, ESPELHO_VAZIO, FaixaVinculo, PainelEspelho, ehEmprestimo, payloadEspelho, useVinculo, type EspelhoForm } from './Emprestimo'
import { AvisoRecorrencia, type SerieRecorrencia } from './AvisoRecorrencia'

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
    centro_custo:       receita?.centro_custo ?? 'matriz',
    observacao:         receita?.observacao ?? '',
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
    if (form.recorrente && !form.data_final) e.data_final = 'Informe até quando repetir.'
    else if (form.recorrente && form.data_final < form.competencia) e.data_final = 'Não pode ser antes da competência.'
    if (espelhoDisponivel && espelho.ativo && !espelho.tipo_lancamento_id) e.espelho = 'Selecione o subitem da despesa.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
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
    if (form.data_vencimento) basePayload.data_vencimento = form.data_vencimento
    if (form.recebido_em) basePayload.recebido_em = form.recebido_em
    if (form.observacao)  basePayload.observacao  = form.observacao

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
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
      setSalvando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? 'Editar Receita' : 'Nova Receita'}
      variant="sheet"
      maxWidth="sm:max-w-xl"
      dismissable={!salvando}
    >
      <FaixaVinculo token={token} vinculado={vinculado} onAbrir={onAbrirVinculado} />
      <form onSubmit={salvar} noValidate className="space-y-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            <Campo label="Categoria">
              <select value={form.categoria_id} onChange={e => selecionarCategoria(e.target.value)} className={selectCls}>
                <option value="">Selecionar categoria</option>
                {categoriasReceita.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Subitem">
              <select disabled={!form.categoria_id} value={form.tipo_lancamento_id}
                onChange={e => selecionarSubitem(e.target.value)} className={selectCls}>
                <option value="">{form.categoria_id ? 'Selecionar subitem' : 'Escolha a categoria primeiro'}</option>
                {subitensDaCategoria.map(t => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </Campo>
          </div>
          {tipos.find(t => t.id === form.tipo_lancamento_id)?.somente_dre && (
            <p className="-mt-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700">
              Este subitem consta <strong>apenas na DRE</strong>: a receita não entra na Visão Geral nem nos totais de Lançamentos.
            </p>
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
            <Campo label="Classificação">
              <select value={classificacao}
                onChange={e => setClassificacao(e.target.value)} className={selectCls}>
                <option value="">Selecionar</option>
                {classificacoesDe(classificacoes, 'receita', classificacao).map(c => (
                  <option key={c.codigo} value={c.codigo}>{c.nome}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Banco">
              <select value={form.banco_id} onChange={e => set('banco_id', e.target.value)} className={selectCls}>
                <option value="">Sem banco</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Centro de custo">
              <select value={form.centro_custo} onChange={e => set('centro_custo', e.target.value)} className={selectCls}>
                <OpcoesCentro centros={centros} atual={form.centro_custo} />
              </select>
            </Campo>
          </div>

          <Field label="Descrição" required error={erros.descricao}>
            {p => (
              <Input {...p} size="sm" value={form.descricao} onChange={e => set('descricao', e.target.value)}
                placeholder="Ex: Comissão extra" />
            )}
          </Field>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            <Field label="Valor" required error={erros.valor}>
              {() => <InputMoeda value={form.valor} onChange={v => set('valor', v)} />}
            </Field>
            <Field label="Competência" required error={erros.competencia}>
              {p => (
                <Input {...p} size="sm" type="month" value={form.competencia}
                  onChange={e => set('competencia', e.target.value)} />
              )}
            </Field>
            <Campo label="Data de Vencimento">
              <input type="date" value={form.data_vencimento} onChange={e => set('data_vencimento', e.target.value)} className={inputCls} />
            </Campo>
            <Campo label="Data de Pagamento">
              <input type="date" value={form.recebido_em} onChange={e => set('recebido_em', e.target.value)} className={inputCls} />
            </Campo>
          </div>

          {/* A data informada vale para a 1ª ocorrência — as demais são
              recebidas mês a mês, editando cada lançamento. */}
          {!editando && form.recorrente && (
            <p className="-mt-1 text-xs text-gray-400">
              A Data de Pagamento se aplica ao 1º mês; os demais ficam em aberto para recebimento mês a mês.
            </p>
          )}

          {/* Receita Recorrente — na edição (24/11/2026), a partir desta receita. */}
          {(!editando || serie) && (
            <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.recorrente as boolean}
                  onChange={e => set('recorrente', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy"
                />
                <span className="text-sm font-medium text-gray-700">Receita Recorrente</span>
              </label>
              {form.recorrente && (
                <Field label="Repetir até (mês/ano)" required error={erros.data_final} className="max-w-[180px]">
                  {p => (
                    <Input {...p} size="sm" type="month" value={form.data_final} min={form.competencia}
                      onChange={e => set('data_final', e.target.value)} />
                  )}
                </Field>
              )}
              {editando && serie && <AvisoRecorrencia serie={serie} recorrente={form.recorrente} ate={form.data_final} competencia={form.competencia} />}
              {!editando && form.recorrente && form.data_final && form.data_final >= form.competencia && (() => {
                const [sy, sm] = form.competencia.split('-').map(Number)
                const [ey, em] = form.data_final.split('-').map(Number)
                const n = (ey - sy) * 12 + (em - sm) + 1
                return n > 1 ? (
                  <p className="text-xs text-blue-600">Serão criados <strong>{n} registros</strong> mensais.</p>
                ) : null
              })()}
            </div>
          )}

          {espelhoDisponivel && (
            <PainelEspelho lado="despesa" valor={espelho} onChange={v => { setEspelho(v); limparErro('espelho') }}
              categorias={categorias} tipos={tipos} bancos={bancos} centros={centros} erro={erros.espelho}
              base={{ subitemNome: tipos.find(t => t.id === form.tipo_lancamento_id)?.nome, banco_id: form.banco_id, centro_custo: form.centro_custo }} />
          )}
          {!editando && categoriaEmprestimo && !espelhoDisponivel && <DicaEspelhoIndisponivel />}

          <CampoAnexos token={token} entidade="receita" entidadeId={receita?.id}
            pendentes={anexosPendentes} onPendentes={setAnexosPendentes} />

          {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
          {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
          {falhaAnexos && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-700">{falhaAnexos}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            {onExcluir && !falhaAnexos && (
              <Button type="button" variant="ghost" tone="danger" onClick={onExcluir} disabled={salvando}
                className="mr-auto">Excluir</Button>
            )}
            {falhaAnexos ? (
              <Button type="button" onClick={onClose}>Fechar</Button>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
                <Button type="submit" loading={salvando}>
                  {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar'}
                </Button>
              </>
            )}
          </div>
      </form>
    </Modal>
  )
}
