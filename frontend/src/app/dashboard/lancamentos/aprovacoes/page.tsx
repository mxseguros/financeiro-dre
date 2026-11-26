'use client'
import { useContagemAnexos } from '@/components/anexos/CampoAnexos'
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { arvoreCentros, OpcoesCentro } from '@/lib/centros'
import { cn, fmtBRL } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button, Spinner } from '@/components/ui/Button'
import { FILTRO_CAMPO, FILTRO_GRUPO, filtroAtivo, filtroSegmento } from '@/components/ui/filtros'
import { useToast } from '@/components/ui/Toast'
import { useUser } from '@/contexts/UserContext'
import { ModalDespesa } from '../_components/ModalDespesa'
import { ModalOrdemCompra } from '../_components/ModalOrdemCompra'
import { ModalAprovarOrdem } from '../_components/ModalAprovarOrdem'
import { DialogExcluirGrupo } from '../_components/DialogExcluirGrupo'
import { RecibosParaConferir } from '../_components/RecibosParaConferir'
import type { Despesa, DespesasResponse } from '@/types'
import {
  podeExcluirLancamento,
  type Banco, type Categoria, type CentroCusto, type TipoLancamento,
  type OrdemCompra, type OrdensCompraResp, type Classificacao,
} from '../_components/shared'
import { CardKanban, ColunaKanban, DialogRejeitar, tituloItem, type ItemKanban, type TipoCard } from './_components/Kanban'

// Receitas saíram do Kanban em 22/10/2026: toda receita já nasce aprovada.
interface DragRef { id: string; tipo: TipoCard }
type Coluna = 'pendente' | 'aprovada' | 'rejeitada'
type FiltroTipo = 'tudo' | 'ordem' | 'despesa'

// ── Página principal ───────────────────────────────────────────
export default function AprovacoesPage() {
  const { token } = useAuth()
  const { role, userId } = useUser()
  const podeAprovar = role === 'admin' || role === 'gestor'
  // Taxonomia que os modais de edicao precisam — mesma carga da listagem.
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [tipos, setTipos] = useState<TipoLancamento[]>([])
  const [bancos, setBancos] = useState<Banco[]>([])
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [classificacoes, setClassificacoes] = useState<Classificacao[]>([])
  const [editando, setEditando] = useState<ItemKanban | null>(null)
  const [excluindo, setExcluindo] = useState<ItemKanban | null>(null)
  const [excluindoBusy, setExcluindoBusy] = useState(false)
  const [despesas, setDespesas] = useState<Despesa[]>([])
  const [ordens, setOrdens] = useState<OrdemCompra[]>([])
  const anexosDesp = useContagemAnexos(token, 'despesa', useMemo(() => despesas.map(d => d.id), [despesas]))
  const anexosOrdens = useContagemAnexos(token, 'ordem_compra', useMemo(() => ordens.map(o => o.id), [ordens]))
  // Aprovar ordem = lançar a despesa: abre o mini-modal de subitem e centro (0047).
  const [aprovandoOrdem, setAprovandoOrdem] = useState<OrdemCompra | null>(null)
  const [loading, setLoading] = useState(true)
  const [processandoId, setProcessandoId] = useState<string | null>(null)
  const [rejeitando, setRejeitando] = useState<DragRef | null>(null)
  const [erroGlobal, setErroGlobal] = useState<string | null>(null)
  // Periodo compartilhado entre telas (ver contexts/PeriodoContext.tsx).
  const filtro = filtroDoPeriodo(usePeriodo())
  const dragId = useRef<DragRef | null>(null)


  const buscar = useCallback(() => {
    if (!token) return
    const { inicio, fim, base } = filtro
    setLoading(true)
    Promise.all([
      api.get<DespesasResponse>(`/lancamentos/despesas?inicio=${inicio}&fim=${fim}&base=${base}&ordenar_por=registro&ordem=desc`, token).then(r => r.items).catch(() => []),
      api.get<OrdensCompraResp>(`/ordens-compra?inicio=${inicio}&fim=${fim}`, token).then(r => r.items).catch(() => []),
    ])
      // Linhas "Total Salários Funcionários" não são lançamentos: salário
      // confidencial é aprovado só pelo Admin, que vê o detalhe (0046).
      .then(([d, o]) => { setDespesas(d.filter(x => !x.agregado)); setOrdens(o) })
      .finally(() => setLoading(false))
  }, [token, filtro.inicio, filtro.fim, filtro.base])

  useEffect(() => { buscar() }, [buscar])

  useEffect(() => {
    if (!token) return
    Promise.all([
      api.get<Categoria[]>('/configuracoes/categorias', token),
      api.get<TipoLancamento[]>('/configuracoes/tipos', token),
      api.get<Banco[]>('/configuracoes/bancos', token),
      api.get<CentroCusto[]>('/configuracoes/centros-custo', token),
    ]).then(([c, t, b, cc]) => { setCategorias(c); setTipos(t); setBancos(b); setCentros(cc) })
      .catch(() => { /* sem config o modal abre com listas vazias; a fila segue funcionando */ })
    api.get<Classificacao[]>('/configuracoes/classificacoes', token).then(setClassificacoes).catch(() => { /* lista padrão */ })
  }, [token])

  const endpointBase = (tipo: TipoCard) =>
    tipo === 'despesa' ? '/lancamentos/despesas' : '/ordens-compra'

  function aplicarStatus(id: string, tipo: TipoCard, novo: 'aprovada' | 'rejeitada', motivo?: string) {
    if (tipo === 'despesa') {
      setDespesas(prev => prev.map(d => d.id === id ? { ...d, status: novo, ...(motivo ? { rejeitado_motivo: motivo } : {}) } : d))
    } else {
      setOrdens(prev => prev.map(o => o.id === id ? { ...o, status: novo, ...(motivo ? { rejeitado_motivo: motivo } : {}) } : o))
    }
  }

  async function handleAprovar(id: string, tipo: TipoCard) {
    if (!token) return
    if (tipo === 'ordem') {
      const ordem = ordens.find(o => o.id === id)
      if (ordem) setAprovandoOrdem(ordem)
      return
    }
    setProcessandoId(id)
    setErroGlobal(null)
    try {
      await api.patch(`${endpointBase(tipo)}/${id}/aprovar`, token, {})
      aplicarStatus(id, tipo, 'aprovada')
    } catch (e) {
      setErroGlobal(e instanceof Error ? e.message : 'Erro ao aprovar.')
    } finally {
      setProcessandoId(null)
    }
  }

  async function handleRejeitar(motivo: string) {
    if (!token || !rejeitando) return
    const { id, tipo } = rejeitando
    setProcessandoId(id)
    setErroGlobal(null)
    setRejeitando(null)
    try {
      await api.patch(`${endpointBase(tipo)}/${id}/rejeitar`, token, { motivo })
      aplicarStatus(id, tipo, 'rejeitada', motivo)
    } catch (e) {
      setErroGlobal(e instanceof Error ? e.message : 'Erro ao rejeitar.')
    } finally {
      setProcessandoId(null)
    }
  }

  async function confirmarExclusao(futuras: boolean) {
    if (!token || !excluindo) return
    setExcluindoBusy(true)
    setErroGlobal(null)
    try {
      const params = futuras ? { excluir_futuras: 'true' } : undefined
      await api.delete(`${endpointBase(excluindo.tipo)}/${excluindo.dado.id}`, token, params)
      setExcluindo(null)
      buscar()
    } catch (e) {
      setErroGlobal(e instanceof Error ? e.message : 'Erro ao excluir.')
      setExcluindo(null)
    } finally {
      setExcluindoBusy(false)
    }
  }

  // Serie (parcelamento/recorrencia) oferece "esta e as futuras", como na listagem.
  const ehSerie = (i: ItemKanban) =>
    i.tipo === 'despesa' && (((i.dado.parcela_total ?? 0) > 1) || !!i.dado.recorrente)

  // Drag & Drop: soltar em coluna de destino
  function handleDropAprovar() {
    if (dragId.current) { handleAprovar(dragId.current.id, dragId.current.tipo); dragId.current = null }
  }
  function handleDropRejeitar() {
    if (dragId.current) { setRejeitando(dragId.current); dragId.current = null }
  }

  // Ordem: ultima movimentacao primeiro. Os cards vem de dois endpoints, entao
  // a ordenacao do servidor nao basta — depois do merge a lista voltaria a ficar
  // agrupada por origem. `atualizado_em` cobre criacao e edicao.
  const quando = (d: { atualizado_em?: string | null; criado_em: string | null }) =>
    new Date(d.atualizado_em ?? d.criado_em ?? 0).getTime()

  // Filtros: tipo (Tudo / Ordens / Despesas) e centro (o grupo traz os subgrupos).
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('tudo')
  const [filtroCentro, setFiltroCentro] = useState('')
  const centrosDoFiltro = useMemo(() => {
    if (!filtroCentro) return null
    const g = arvoreCentros(centros).find(x => x.grupo.codigo === filtroCentro)
    return new Set([filtroCentro, ...(g?.filhos.map(f => f.codigo) ?? [])])
  }, [filtroCentro, centros])

  const todos: ItemKanban[] = [
    ...despesas.map(d => ({ tipo: 'despesa' as const, dado: d })),
    ...ordens.map(o => ({ tipo: 'ordem' as const, dado: o })),
  ]
    .filter(i => filtroTipo === 'tudo' || i.tipo === filtroTipo)
    .filter(i => !centrosDoFiltro || centrosDoFiltro.has(i.dado.centro_custo ?? ''))
    .sort((a, b) => quando(b.dado) - quando(a.dado))
  const porColuna: Record<Coluna, ItemKanban[]> = {
    pendente: todos.filter(i => i.dado.status === 'pendente'),
    aprovada: todos.filter(i => i.dado.status === 'aprovada'),
    rejeitada: todos.filter(i => i.dado.status === 'rejeitada'),
  }
  const soma = (l: ItemKanban[]) => l.reduce((s, i) => s + Number(i.dado.valor ?? 0), 0)
  const [colunaCelular, setColunaCelular] = useState<Coluna>('pendente')

  // ── Seleção em lote (despesas pendentes) ──
  // Aprovar uma ordem pede subitem e centro (ela vira despesa): por isso o lote
  // aprova só despesas; ordens seguem uma a uma pelo botão do card.
  const [sel, setSel] = useState<Set<string>>(new Set())
  useEffect(() => { setSel(new Set()) }, [filtro.inicio, filtro.fim, filtroTipo, filtroCentro])
  const selecionadas = porColuna.pendente.filter(i => i.tipo === 'despesa' && sel.has(i.dado.id))
  const toast = useToast()
  const [lote, setLote] = useState(false)
  async function aprovarSelecionadas() {
    if (!token || !selecionadas.length) return
    setLote(true); setErroGlobal(null)
    const r = await Promise.allSettled(selecionadas.map(i => api.patch(`/lancamentos/despesas/${i.dado.id}/aprovar`, token, {})))
    r.forEach((x, k) => { if (x.status === 'fulfilled') aplicarStatus(selecionadas[k].dado.id, 'despesa', 'aprovada') })
    const falhas = r.filter(x => x.status === 'rejected').length
    setLote(false); setSel(new Set())
    if (r.length - falhas) toast.sucesso(`${r.length - falhas} despesa${r.length - falhas > 1 ? 's aprovadas' : ' aprovada'}.`)
    if (falhas) setErroGlobal(`${falhas} não ${falhas > 1 ? 'puderam' : 'pôde'} ser aprovada${falhas > 1 ? 's' : ''}. Tente de novo ou abra o card.`)
  }
  async function rejeitarSelecionadas(motivo: string) {
    if (!token) return
    setLote(true); setErroGlobal(null)
    const alvo = selecionadas
    const r = await Promise.allSettled(alvo.map(i => api.patch(`/lancamentos/despesas/${i.dado.id}/rejeitar`, token, { motivo })))
    r.forEach((x, k) => { if (x.status === 'fulfilled') aplicarStatus(alvo[k].dado.id, 'despesa', 'rejeitada', motivo) })
    const falhas = r.filter(x => x.status === 'rejected').length
    setLote(false); setSel(new Set()); setRejeitandoLote(false)
    if (falhas) setErroGlobal(`${falhas} não ${falhas > 1 ? 'puderam' : 'pôde'} ser rejeitada${falhas > 1 ? 's' : ''}.`)
  }
  const [rejeitandoLote, setRejeitandoLote] = useState(false)

  function renderItem(i: ItemKanban) {
    const pendente = i.dado.status === 'pendente'
    // Antes o botao Aprovar aparecia para todos e o backend recusava com 403.
    const comAcoes = pendente && podeAprovar
    // Regras reais do backend, por tipo:
    //  - despesa/ordem: excluir = admin/gestor, ou o autor antes da aprovacao
    //  - ordem: editar = admin/gestor ou o autor (policy ordens_compra_update)
    const podeEditar = i.tipo === 'despesa' || podeAprovar || i.dado.criado_por === userId
    const ref: DragRef = { id: i.dado.id, tipo: i.tipo }
    return (
      <CardKanban key={`${i.tipo}-${i.dado.id}`} item={i} centros={centros}
        anexos={i.tipo === 'despesa' ? anexosDesp[i.dado.id] : anexosOrdens[i.dado.id]}
        ocupado={processandoId === i.dado.id || lote}
        selecionavel={comAcoes && i.tipo === 'despesa'} marcado={sel.has(i.dado.id)}
        onSel={() => setSel(s => { const n = new Set(s); if (n.has(i.dado.id)) n.delete(i.dado.id); else n.add(i.dado.id); return n })}
        onAprovar={comAcoes ? () => handleAprovar(i.dado.id, i.tipo) : undefined}
        onRejeitar={comAcoes ? () => setRejeitando(ref) : undefined}
        onAbrir={podeEditar ? () => setEditando(i) : undefined}
        onExcluir={podeExcluirLancamento(i.dado, role, userId) ? () => setExcluindo(i) : undefined}
        onDragStart={comAcoes ? () => { dragId.current = ref } : undefined}
      />
    )
  }

  const itemRejeitando = rejeitando ? todos.find(i => i.dado.id === rejeitando.id) ?? null : null

  return (
    <>
      {editando?.tipo === 'despesa' && token && (
        <ModalDespesa token={token} categorias={categorias} tipos={tipos} bancos={bancos} centros={centros}
          classificacoes={classificacoes}
          despesa={editando.dado} onClose={() => setEditando(null)} onSaved={buscar} />
      )}
      {editando?.tipo === 'ordem' && token && (
        <ModalOrdemCompra token={token} ordem={editando.dado} centros={centros} onClose={() => setEditando(null)} onSaved={buscar} />
      )}
      {aprovandoOrdem && token && (
        <ModalAprovarOrdem token={token} ordem={aprovandoOrdem} categorias={categorias} tipos={tipos}
          centros={centros} bancos={bancos} classificacoes={classificacoes}
          onClose={() => setAprovandoOrdem(null)}
          onAprovada={o => {
            setOrdens(prev => prev.map(x => (x.id === o.id ? { ...x, ...o } : x)))
            setAprovandoOrdem(null)
          }} />
      )}

      <DialogExcluirGrupo
        open={!!excluindo && ehSerie(excluindo)}
        titulo="Excluir lançamento"
        mensagem={<>Este lançamento faz parte de uma série. Deseja excluir também os dos meses seguintes?</>}
        labelSomenteEsta="Só este"
        excluindo={excluindoBusy}
        onCancelar={() => setExcluindo(null)}
        onExcluir={confirmarExclusao}
      />
      <Modal
        open={!!excluindo && !ehSerie(excluindo)}
        onClose={() => setExcluindo(null)}
        title="Excluir lançamento"
        maxWidth="sm:max-w-sm"
        dismissable={!excluindoBusy}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExcluindo(null)} disabled={excluindoBusy}>Cancelar</Button>
            <Button variant="danger" onClick={() => confirmarExclusao(false)} loading={excluindoBusy}>
              {excluindoBusy ? 'Excluindo…' : 'Excluir'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          Excluir <strong>{excluindo ? tituloItem(excluindo) : ''}</strong>? O lançamento sai da fila e dos totais.
        </p>
      </Modal>

      {rejeitando && (
        <DialogRejeitar
          titulo={rejeitando.tipo === 'ordem' ? 'Rejeitar ordem de compra' : 'Rejeitar despesa'}
          resumo={itemRejeitando ? [tituloItem(itemRejeitando), itemRejeitando.dado.valor != null ? fmtBRL(itemRejeitando.dado.valor) : null,
            itemRejeitando.tipo === 'ordem' ? itemRejeitando.dado.solicitante : null].filter(Boolean).join(' · ') : ''}
          avisar={itemRejeitando?.tipo === 'ordem' ? itemRejeitando.dado.solicitante : null}
          loading={processandoId !== null}
          onCancelar={() => setRejeitando(null)}
          onConfirmar={handleRejeitar}
        />
      )}
      {rejeitandoLote && (
        <DialogRejeitar titulo={`Rejeitar ${selecionadas.length} despesa${selecionadas.length > 1 ? 's' : ''}`}
          resumo={`${fmtBRL(soma(selecionadas))} no total. O mesmo motivo vale para todas.`}
          loading={lote} onCancelar={() => setRejeitandoLote(false)} onConfirmar={rejeitarSelecionadas} />
      )}

      <div className="flex flex-col gap-4">
        {erroGlobal && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            <span>{erroGlobal}</span>
            <button onClick={() => setErroGlobal(null)} aria-label="Fechar aviso"
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-red-100">✕</button>
          </div>
        )}

        {/* Celular: abas por situação, com contador */}
        <div role="tablist" aria-label="Situação" className="grid h-14 grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1 md:hidden">
          {([['pendente', 'Pendentes'], ['aprovada', 'Aprovadas'], ['rejeitada', 'Rejeitadas']] as const).map(([k, r]) => (
            <button key={k} type="button" role="tab" aria-selected={colunaCelular === k} onClick={() => setColunaCelular(k)}
              className={cn('focus-ring rounded-lg text-sm', colunaCelular === k ? 'bg-white font-bold text-slate-900 shadow-sm' : 'text-slate-700')}>
              {r} <span className="tabular-nums">{porColuna[k].length}</span>
            </button>
          ))}
        </div>

        {/* Filtros e recibos */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div role="group" aria-label="Mostrar" className={FILTRO_GRUPO}>
            {([['tudo', 'Tudo', 'Tudo'], ['ordem', 'Ordens de compra', 'Ordens'], ['despesa', 'Despesas', 'Despesas']] as const).map(([k, r, c]) => (
              <button key={k} type="button" aria-pressed={filtroTipo === k} onClick={() => setFiltroTipo(k)} className={filtroSegmento(filtroTipo === k)}>
                <span className="md:hidden">{c}</span><span className="hidden md:inline">{r}</span>
              </button>
            ))}
          </div>
          <select aria-label="Centro de custo" value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)}
            className={cn(FILTRO_CAMPO, 'w-auto max-w-[14rem]', filtroAtivo(!!filtroCentro), filtroCentro && 'border-2')}>
            <option value="">Centro de custo</option>
            <OpcoesCentro centros={centros} filtro />
          </select>
        </div>

        {token && podeAprovar && <RecibosParaConferir token={token} onMudou={buscar} />}

        {selecionadas.length > 0 && (
          <div role="region" aria-label="Ações em lote" className="flex flex-wrap items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm text-white">
            <span><b>{selecionadas.length} selecionada{selecionadas.length > 1 ? 's' : ''}</b> · <span className="tabular-nums">{fmtBRL(soma(selecionadas))}</span></span>
            <span className="flex-1" />
            <button type="button" onClick={() => setRejeitandoLote(true)} disabled={lote}
              className="focus-ring h-11 rounded-lg border border-slate-500 px-3.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">Rejeitar selecionadas</button>
            <button type="button" onClick={aprovarSelecionadas} disabled={lote}
              className="focus-ring h-11 rounded-lg bg-white px-4 text-sm font-semibold text-navy hover:bg-slate-100 disabled:opacity-50">
              {lote ? 'Aprovando…' : 'Aprovar selecionadas'}
            </button>
            <button type="button" onClick={() => setSel(new Set())}
              className="focus-ring h-11 rounded-lg px-3 text-sm text-slate-300 hover:text-white">Limpar seleção</button>
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center"><Spinner size="lg" className="text-navy" /></div>
        ) : (
          <div data-tour="kanban" className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ColunaKanban id="col-pend" titulo="Pendentes" ponto="bg-amber-500" itens={porColuna.pendente.length} soma={soma(porColuna.pendente)}
              ativaCelular={colunaCelular === 'pendente'} vazio="Nada esperando aprovação.">
              {porColuna.pendente.map(renderItem)}
            </ColunaKanban>
            <ColunaKanban id="col-apr" titulo="Aprovadas" ponto="bg-green-700" itens={porColuna.aprovada.length} soma={soma(porColuna.aprovada)}
              ativaCelular={colunaCelular === 'aprovada'} aceitaDrop={podeAprovar} onDrop={handleDropAprovar}
              dicaDrop={podeAprovar ? 'Solte aqui para aprovar' : undefined} vazio="Nenhuma aprovada no período.">
              {porColuna.aprovada.map(renderItem)}
            </ColunaKanban>
            <ColunaKanban id="col-rej" titulo="Rejeitadas" ponto="bg-red-700" itens={porColuna.rejeitada.length} soma={soma(porColuna.rejeitada)}
              ativaCelular={colunaCelular === 'rejeitada'} aceitaDrop={podeAprovar} onDrop={handleDropRejeitar}
              dicaDrop={podeAprovar ? 'Solte aqui para rejeitar' : undefined} vazio="Nenhuma rejeitada no período.">
              {porColuna.rejeitada.map(renderItem)}
            </ColunaKanban>
          </div>
        )}
      </div>
    </>
  )
}
