'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { fmtBRL, fmtData, mesAtual } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button, Spinner } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Field'
import type { Despesa, DespesasResponse } from '@/types'
import type { OrdemCompra, OrdensCompraResp, Receita, ReceitasResp } from '../_components/shared'

type TipoCard = 'despesa' | 'ordem' | 'receita'
interface DragRef { id: string; tipo: TipoCard }

function mesAtualStr() {
  const [inicio] = mesAtual()
  return inicio.slice(0, 7)
}

function fmtCompetencia(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

// ── Card de despesa no Kanban ──────────────────────────────────
interface CardProps {
  despesa: Despesa
  processandoId: string | null
  onAprovar?: (id: string) => void
  onIniciarRejeicao?: (id: string) => void
  onDragStart?: (id: string) => void
}

function DespesaCard({ despesa, processandoId, onAprovar, onIniciarRejeicao, onDragStart }: CardProps) {
  const ocupado = processandoId === despesa.id
  const arrastavel = !ocupado

  return (
    <div
      draggable={arrastavel}
      onDragStart={arrastavel && onDragStart ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(despesa.id) } : undefined}
      className={`rounded-xl border bg-white p-4 shadow-sm transition-opacity select-none
        ${ocupado ? 'opacity-60' : ''}
        ${arrastavel ? 'cursor-grab active:cursor-grabbing active:shadow-lg active:scale-[1.02] transition-transform' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 truncate max-w-[65%]">
          {despesa.tipo_nome ?? despesa.categoria ?? 'Outro'}
        </span>
        <span className="text-xs font-bold text-red-500 tabular-nums whitespace-nowrap">
          {fmtBRL(despesa.valor)}
        </span>
      </div>

      <p className="mt-2 text-xs font-medium text-gray-800 line-clamp-2 leading-snug">
        {despesa.descricao}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
        <span className="capitalize">{despesa.centro_custo.replace('_', ' ')}</span>
        <span>·</span>
        <span>{fmtCompetencia(despesa.competencia)}</span>
      </div>

      {/* Motivo de rejeição */}
      {despesa.status === 'rejeitada' && despesa.rejeitado_motivo && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <span className="font-semibold">Motivo: </span>
          {despesa.rejeitado_motivo}
        </div>
      )}

      {/* Ações para pendentes */}
      {onAprovar && onIniciarRejeicao && despesa.status === 'pendente' && (
        <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
          <button
            onClick={() => onAprovar(despesa.id)}
            disabled={ocupado}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-green-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Aprovar
          </button>
          <button
            onClick={() => onIniciarRejeicao(despesa.id)}
            disabled={ocupado}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Rejeitar
          </button>
        </div>
      )}
    </div>
  )
}

// ── Card de ordem de compra no Kanban ──────────────────────────
interface OrdemCardProps {
  ordem: OrdemCompra
  processandoId: string | null
  onAprovar?: (id: string) => void
  onIniciarRejeicao?: (id: string) => void
  onDragStart?: (id: string) => void
}

function OrdemCard({ ordem, processandoId, onAprovar, onIniciarRejeicao, onDragStart }: OrdemCardProps) {
  const ocupado = processandoId === ordem.id
  const arrastavel = !ocupado

  return (
    <div
      draggable={arrastavel}
      onDragStart={arrastavel && onDragStart ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(ordem.id) } : undefined}
      className={`rounded-xl border border-indigo-100 bg-white p-4 shadow-sm transition-opacity select-none
        ${ocupado ? 'opacity-60' : ''}
        ${arrastavel ? 'cursor-grab active:cursor-grabbing active:shadow-lg active:scale-[1.02] transition-transform' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-600 truncate max-w-[65%]">
          Ordem de Compra
        </span>
        {ordem.valor != null && (
          <span className="text-xs font-bold text-indigo-600 tabular-nums whitespace-nowrap">
            {fmtBRL(ordem.valor)}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs font-semibold text-gray-800 line-clamp-1 leading-snug">{ordem.assunto}</p>
      <p className="mt-0.5 text-xs text-gray-600 line-clamp-2 leading-snug">{ordem.descricao}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
        <span>{ordem.solicitante}</span>
        <span>·</span>
        <span>{fmtData(ordem.data_solicitacao)}</span>
      </div>

      {ordem.status === 'rejeitada' && ordem.rejeitado_motivo && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <span className="font-semibold">Motivo: </span>{ordem.rejeitado_motivo}
        </div>
      )}

      {onAprovar && onIniciarRejeicao && ordem.status === 'pendente' && (
        <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
          <button onClick={() => onAprovar(ordem.id)} disabled={ocupado}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-green-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5"><polyline points="20 6 9 17 4 12"/></svg>
            Aprovar
          </button>
          <button onClick={() => onIniciarRejeicao(ordem.id)} disabled={ocupado}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Rejeitar
          </button>
        </div>
      )}
    </div>
  )
}

// ── Coluna do Kanban ───────────────────────────────────────────
interface ColunaProps {
  titulo: string
  contagem: number
  cor: string
  corTexto: string
  aceitaDrop?: boolean
  onDrop?: () => void
  children: React.ReactNode
}

interface ReceitaCardProps {
  receita: Receita
  processandoId: string | null
  onAprovar?: (id: string) => void
  onIniciarRejeicao?: (id: string) => void
  onDragStart?: (id: string) => void
}

/* Espelha o DespesaCard. A borda verde e o sinal "+" distinguem receita de
   despesa numa coluna que mistura os tres tipos — sem isso o unico indicio
   seria o rotulo, facil de perder no meio do Kanban. */
function ReceitaCard({ receita, processandoId, onAprovar, onIniciarRejeicao, onDragStart }: ReceitaCardProps) {
  const ocupado = processandoId === receita.id
  const arrastavel = !ocupado

  return (
    <div
      draggable={arrastavel}
      onDragStart={arrastavel && onDragStart ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(receita.id) } : undefined}
      className={`rounded-xl border border-green-100 bg-white p-4 shadow-sm transition-opacity select-none
        ${ocupado ? 'opacity-60' : ''}
        ${arrastavel ? 'cursor-grab active:cursor-grabbing active:shadow-lg active:scale-[1.02] transition-transform' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 truncate max-w-[65%]">
          {receita.tipo_nome ?? 'Receita'}
        </span>
        <span className="shrink-0 text-sm font-bold tabular-nums text-green-600">+{fmtBRL(receita.valor)}</span>
      </div>

      <p className="mt-2 text-sm font-medium text-gray-800 line-clamp-2">{receita.descricao}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
        {receita.centro_custo && <><span className="capitalize">{receita.centro_custo.replace('_', ' ')}</span><span>·</span></>}
        <span>{fmtCompetencia(receita.competencia)}</span>
      </div>

      {receita.status === 'rejeitada' && receita.rejeitado_motivo && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          <span className="font-semibold">Motivo: </span>{receita.rejeitado_motivo}
        </div>
      )}

      {onAprovar && onIniciarRejeicao && receita.status === 'pendente' && (
        <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
          <button
            onClick={() => onAprovar(receita.id)}
            disabled={ocupado}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg bg-green-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
          >
            Aprovar
          </button>
          <button
            onClick={() => onIniciarRejeicao(receita.id)}
            disabled={ocupado}
            className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            Rejeitar
          </button>
        </div>
      )}
    </div>
  )
}

function KanbanColuna({ titulo, contagem, cor, corTexto, aceitaDrop, onDrop, children }: ColunaProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div className="flex w-[calc(100vw-2rem)] shrink-0 snap-start flex-col sm:w-auto sm:min-w-0">
      <div className={`mb-3 flex items-center justify-between rounded-xl px-4 py-2.5 ${cor}`}>
        <h3 className={`text-sm font-semibold ${corTexto}`}>{titulo}</h3>
        <span className={`rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-bold ${corTexto}`}>
          {contagem}
        </span>
      </div>
      <div
        onDragOver={aceitaDrop ? (e) => { e.preventDefault(); setDragOver(true) } : undefined}
        onDragLeave={aceitaDrop ? () => setDragOver(false) : undefined}
        onDrop={aceitaDrop && onDrop ? (e) => { e.preventDefault(); setDragOver(false); onDrop() } : undefined}
        className={`flex-1 space-y-3 overflow-y-auto rounded-xl pr-1 transition-colors
          ${dragOver ? 'bg-white/60 ring-2 ring-inset ring-white/50' : ''}
        `}
        style={{ maxHeight: 'calc(100vh - 260px)' }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Modal de rejeição ──────────────────────────────────────────
function ModalRejeicao({
  onConfirmar,
  onCancelar,
  loading,
}: {
  onConfirmar: (motivo: string) => void
  onCancelar: () => void
  loading: boolean
}) {
  const [motivo, setMotivo] = useState('')
  const motivoId = 'motivo-rejeicao'
  const vazio = !motivo.trim()

  return (
    <Modal
      open
      onClose={onCancelar}
      title="Rejeitar"
      variant="sheet"
      maxWidth="sm:max-w-md"
      dismissable={!loading}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancelar} disabled={loading}>Cancelar</Button>
          <Button variant="danger" onClick={() => onConfirmar(motivo)} disabled={vazio} loading={loading}>
            {loading ? 'Rejeitando…' : 'Confirmar Rejeição'}
          </Button>
        </div>
      }
    >
      <label htmlFor={motivoId} className="block text-sm text-gray-500">
        Informe o motivo da rejeição. O responsável será notificado.
      </label>

      <Textarea
        id={motivoId}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex: Nota fiscal ausente, valor divergente, centro de custo incorreto…"
        className="mt-3 resize-none"
        rows={4}
        autoFocus
        aria-invalid={vazio || undefined}
        aria-describedby={vazio ? `${motivoId}-msg` : undefined}
      />

      {vazio && (
        <p id={`${motivoId}-msg`} role="alert" className="mt-1 text-xs text-red-500">
          A justificativa é obrigatória.
        </p>
      )}
    </Modal>
  )
}

// ── Página principal ───────────────────────────────────────────
export default function AprovacoesPage() {
  const { token } = useAuth()
  const [despesas, setDespesas] = useState<Despesa[]>([])
  const [ordens, setOrdens] = useState<OrdemCompra[]>([])
  const [receitas, setReceitas] = useState<Receita[]>([])
  const [loading, setLoading] = useState(true)
  const [processandoId, setProcessandoId] = useState<string | null>(null)
  const [rejeitando, setRejeitando] = useState<DragRef | null>(null)
  const [erroGlobal, setErroGlobal] = useState<string | null>(null)
  const [mes, setMes] = useState(mesAtualStr)
  const dragId = useRef<DragRef | null>(null)
  const kanbanRef = useRef<HTMLDivElement>(null)
  const [colunaAtiva, setColunaAtiva] = useState(0)

  function mesParaDatas(m: string): [string, string] {
    const [y, mo] = m.split('-')
    const last = new Date(Number(y), Number(mo), 0).getDate()
    return [`${y}-${mo}-01`, `${y}-${mo}-${last}`]
  }

  const buscar = useCallback(() => {
    if (!token) return
    const [inicio, fim] = mesParaDatas(mes)
    setLoading(true)
    Promise.all([
      api.get<DespesasResponse>(`/lancamentos/despesas?inicio=${inicio}&fim=${fim}&ordenar_por=registro&ordem=desc`, token).then(r => r.items).catch(() => []),
      api.get<OrdensCompraResp>(`/ordens-compra?inicio=${inicio}&fim=${fim}`, token).then(r => r.items).catch(() => []),
      api.get<ReceitasResp>(`/lancamentos/receitas?inicio=${inicio}&fim=${fim}&ordenar_por=registro&ordem=desc`, token)
        // Comissao (origem=comissao) e derivada de apolice e nao tem status —
        // so receita manual entra na fila de aprovacao.
        .then(r => r.items.filter(i => i.origem === 'manual')).catch(() => []),
    ])
      .then(([d, o, r]) => { setDespesas(d); setOrdens(o); setReceitas(r) })
      .finally(() => setLoading(false))
  }, [token, mes])

  useEffect(() => { buscar() }, [buscar])

  useEffect(() => {
    const el = kanbanRef.current
    if (!el) return
    const handler = () => {
      const colWidth = el.scrollWidth / 4
      setColunaAtiva(Math.round(el.scrollLeft / colWidth))
    }
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [loading])

  function scrollParaColuna(idx: number) {
    if (!kanbanRef.current) return
    const colWidth = kanbanRef.current.scrollWidth / 4
    kanbanRef.current.scrollTo({ left: idx * colWidth, behavior: 'smooth' })
  }

  const endpointBase = (tipo: TipoCard) =>
    tipo === 'despesa' ? '/lancamentos/despesas'
    : tipo === 'receita' ? '/lancamentos/receitas'
    : '/ordens-compra'

  function aplicarStatus(id: string, tipo: TipoCard, novo: 'aprovada' | 'rejeitada', motivo?: string) {
    if (tipo === 'despesa') {
      setDespesas(prev => prev.map(d => d.id === id ? { ...d, status: novo, ...(motivo ? { rejeitado_motivo: motivo } : {}) } : d))
    } else {
      setOrdens(prev => prev.map(o => o.id === id ? { ...o, status: novo, ...(motivo ? { rejeitado_motivo: motivo } : {}) } : o))
    }
  }

  async function handleAprovar(id: string, tipo: TipoCard) {
    if (!token) return
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

  // Drag & Drop: soltar em coluna de destino
  function handleDropAprovar() {
    if (dragId.current) { handleAprovar(dragId.current.id, dragId.current.tipo); dragId.current = null }
  }
  function handleDropRejeitar() {
    if (dragId.current) { setRejeitando(dragId.current); dragId.current = null }
  }

  // Lista unificada (despesa + ordem) por status, com discriminador de tipo
  type ItemKanban =
    | { tipo: 'despesa'; dado: Despesa }
    | { tipo: 'ordem';   dado: OrdemCompra }
    | { tipo: 'receita'; dado: Receita }
  // Ordem: ultima movimentacao primeiro. Os cards vem de dois endpoints, entao
  // a ordenacao do servidor nao basta — depois do merge a lista voltaria a ficar
  // agrupada por origem. `atualizado_em` cobre criacao e edicao; o fallback para
  // `criado_em` mantem a tela coerente enquanto a migration 0034 nao roda.
  const quando = (d: { atualizado_em?: string | null; criado_em: string | null }) =>
    new Date(d.atualizado_em ?? d.criado_em ?? 0).getTime()

  const todos: ItemKanban[] = [
    ...despesas.map(d => ({ tipo: 'despesa' as const, dado: d })),
    ...ordens.map(o => ({ tipo: 'ordem' as const, dado: o })),
    ...receitas.map(r => ({ tipo: 'receita' as const, dado: r })),
  ].sort((a, b) => quando(b.dado) - quando(a.dado))
  const lancadas   = todos.filter(i => i.dado.status !== 'rejeitada')
  const pendentes  = todos.filter(i => i.dado.status === 'pendente')
  const aprovadas  = todos.filter(i => i.dado.status === 'aprovada')
  const rejeitadas = todos.filter(i => i.dado.status === 'rejeitada')

  const somaAprovadas = aprovadas.reduce((s, i) => s + Number(i.dado.valor ?? 0), 0)

  function renderItem(i: ItemKanban, comAcoes: boolean) {
    if (i.tipo === 'despesa') {
      return (
        <DespesaCard key={`d-${i.dado.id}`} despesa={i.dado} processandoId={processandoId}
          onAprovar={comAcoes ? (id) => handleAprovar(id, 'despesa') : undefined}
          onIniciarRejeicao={comAcoes ? (id) => setRejeitando({ id, tipo: 'despesa' }) : undefined}
          onDragStart={(id) => { dragId.current = { id, tipo: 'despesa' } }}
        />
      )
    }
    if (i.tipo === 'receita') {
      return (
        <ReceitaCard key={`r-${i.dado.id}`} receita={i.dado} processandoId={processandoId}
          onAprovar={comAcoes ? (id) => handleAprovar(id, 'receita') : undefined}
          onIniciarRejeicao={comAcoes ? (id) => setRejeitando({ id, tipo: 'receita' }) : undefined}
          onDragStart={(id) => { dragId.current = { id, tipo: 'receita' } }}
        />
      )
    }
    return (
      <OrdemCard key={`o-${i.dado.id}`} ordem={i.dado} processandoId={processandoId}
        onAprovar={comAcoes ? (id) => handleAprovar(id, 'ordem') : undefined}
        onIniciarRejeicao={comAcoes ? (id) => setRejeitando({ id, tipo: 'ordem' }) : undefined}
        onDragStart={(id) => { dragId.current = { id, tipo: 'ordem' } }}
      />
    )
  }

  return (
    <>
      {rejeitando && (
        <ModalRejeicao
          onConfirmar={handleRejeitar}
          onCancelar={() => setRejeitando(null)}
          loading={processandoId !== null}
        />
      )}

      <div className="flex flex-col space-y-4">
        {/* Cabeçalho */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href="/dashboard/lancamentos" className="text-sm text-gray-400 hover:text-gray-600">
                Lançamentos
              </Link>
              <span className="text-gray-300">/</span>
              <h1 className="text-xl font-bold text-navy md:text-2xl">Aprovações</h1>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">Arraste os cards para Aprovar ou Rejeitar</p>
          </div>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus-ring focus:outline-none sm:py-1.5"
          />
        </div>

        {/* Erro global */}
        {erroGlobal && (
          <div className="flex items-center justify-between rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <span>{erroGlobal}</span>
            <button onClick={() => setErroGlobal(null)} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        {/* Resumo rápido */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          {[
            { label: 'Total Lançadas',  valor: lancadas.length,    extra: '',                         cor: 'bg-slate-50  border-slate-200  text-slate-700' },
            { label: 'Pendentes',       valor: pendentes.length,   extra: '',                         cor: 'bg-amber-50  border-amber-200  text-amber-800' },
            { label: 'Aprovadas',       valor: aprovadas.length,   extra: fmtBRL(somaAprovadas),      cor: 'bg-green-50  border-green-200  text-green-800' },
            { label: 'Rejeitadas',      valor: rejeitadas.length,  extra: '',                         cor: 'bg-red-50    border-red-200    text-red-800'   },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border px-4 py-3 ${s.cor}`}>
              <p className="text-xs opacity-70">{s.label}</p>
              <p className="mt-1 text-xl font-bold">{s.valor}</p>
              {s.extra && <p className="text-xs opacity-60">{s.extra}</p>}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size="lg" className="text-navy" />
          </div>
        ) : (
          // ── Kanban ──────────────────────────────────────────
          <div className="space-y-3">
          <div ref={kanbanRef} className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">

            {/* Coluna 1 — Lançadas (pendentes + aprovadas) */}
            <KanbanColuna titulo="Lançadas" contagem={lancadas.length} cor="bg-slate-700" corTexto="text-white">
              {lancadas.length === 0
                ? <p className="py-10 text-center text-xs text-gray-400">Nenhum lançamento no período</p>
                : lancadas.map(i => renderItem(i, false))
              }
            </KanbanColuna>

            {/* Coluna 2 — Pendente Aprovação */}
            <KanbanColuna titulo="Pendente Aprovação" contagem={pendentes.length} cor="bg-amber-500" corTexto="text-white">
              {pendentes.length === 0
                ? <p className="py-10 text-center text-xs text-amber-400">Nenhuma pendente 🎉</p>
                : pendentes.map(i => renderItem(i, true))
              }
            </KanbanColuna>

            {/* Coluna 3 — Aprovadas (drop zone) */}
            <KanbanColuna titulo="Aprovadas" contagem={aprovadas.length} cor="bg-green-600" corTexto="text-white"
              aceitaDrop onDrop={handleDropAprovar}>
              {aprovadas.length === 0
                ? <p className="py-10 text-center text-xs text-green-300">Arraste aqui para aprovar</p>
                : aprovadas.map(i => renderItem(i, false))
              }
            </KanbanColuna>

            {/* Coluna 4 — Rejeitadas (drop zone) */}
            <KanbanColuna titulo="Rejeitadas" contagem={rejeitadas.length} cor="bg-red-600" corTexto="text-white"
              aceitaDrop onDrop={handleDropRejeitar}>
              {rejeitadas.length === 0
                ? <p className="py-10 text-center text-xs text-red-300">Arraste aqui para rejeitar</p>
                : rejeitadas.map(i => renderItem(i, false))
              }
            </KanbanColuna>

          </div>

            {/* Navegação mobile — setas + dots */}
            <div className="flex items-center justify-center gap-3 sm:hidden">
              <button
                onClick={() => scrollParaColuna(colunaAtiva - 1)}
                disabled={colunaAtiva === 0}
                aria-label="Coluna anterior"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm text-gray-600 disabled:opacity-25 transition-opacity"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4"><polyline points="15 18 9 12 15 6"/></svg>
              </button>

              <div className="flex items-center gap-1.5">
                {['Lançadas', 'Pendentes', 'Aprovadas', 'Rejeitadas'].map((lbl, i) => (
                  <button
                    key={i}
                    onClick={() => scrollParaColuna(i)}
                    title={lbl}
                    className={`rounded-full transition-all duration-200 ${
                      i === colunaAtiva
                        ? 'h-2 w-5 bg-navy'
                        : 'h-2 w-2 bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={() => scrollParaColuna(colunaAtiva + 1)}
                disabled={colunaAtiva === 3}
                aria-label="Próxima coluna"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm text-gray-600 disabled:opacity-25 transition-opacity"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
