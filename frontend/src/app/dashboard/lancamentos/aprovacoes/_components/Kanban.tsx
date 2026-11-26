'use client'
import { useState } from 'react'
import { cn, fmtBRL } from '@/lib/utils'
import { nomeCentro } from '@/lib/centros'
import { SeloRecibo } from '@/lib/recibo'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { Despesa } from '@/types'
import type { CentroCusto, OrdemCompra } from '../../_components/shared'

/**
 * Peças do quadro de Aprovações no redesenho UX (fase 6, 26/11/2026):
 * cards com Aprovar/Rejeitar à vista, colunas Pendentes/Aprovadas/Rejeitadas
 * (a coluna "Lançadas" saiu: repetia os cards) e o diálogo de rejeição com
 * motivos prontos.
 */

export type TipoCard = 'despesa' | 'ordem'
export type ItemKanban =
  | { tipo: 'despesa'; dado: Despesa }
  | { tipo: 'ordem'; dado: OrdemCompra }

const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '')

export function tituloItem(i: ItemKanban) { return i.tipo === 'ordem' ? i.dado.assunto : i.dado.descricao }

// ── Card ────────────────────────────────────────────────────────
export function CardKanban({ item, centros, anexos, ocupado, selecionavel, marcado, onSel, onAprovar, onRejeitar, onAbrir, onExcluir, onDragStart }: {
  item: ItemKanban
  centros: CentroCusto[]
  anexos?: number
  ocupado: boolean
  selecionavel?: boolean
  marcado?: boolean
  onSel?: () => void
  onAprovar?: () => void
  onRejeitar?: () => void
  onAbrir?: () => void
  onExcluir?: () => void
  onDragStart?: () => void
}) {
  const { tipo, dado } = item
  const ordem = tipo === 'ordem' ? (dado as OrdemCompra) : null
  const despesa = tipo === 'despesa' ? (dado as Despesa) : null
  const pendente = dado.status === 'pendente'
  // "Sem recibo": ordem de compra pendente sem nota/comprovante anexado.
  const semRecibo = !!ordem && pendente && !anexos
  const centro = ordem ? (ordem.centro_custo ? nomeCentro(ordem.centro_custo, centros) : null) : nomeCentro(despesa!.centro_custo, centros)
  const detalhe = ordem
    ? [`Pedido por ${ordem.solicitante}`, centro, ddmm(ordem.data_prevista ?? ordem.data_solicitacao)]
    : [despesa!.tipo_nome ?? despesa!.categoria, centro, despesa!.data_vencimento ? `vence ${ddmm(despesa!.data_vencimento)}` : null]
  const arrastavel = !ocupado && !!onDragStart

  return (
    <article
      draggable={arrastavel}
      onDragStart={arrastavel ? (e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart!() } : undefined}
      className={cn('flex select-none flex-col gap-2.5 rounded-xl bg-white p-3.5 transition-opacity',
        marcado ? 'border-2 border-sel' : semRecibo ? 'border-2 border-red-700' : 'border border-gray-200',
        ocupado && 'opacity-60', arrastavel && 'cursor-grab active:cursor-grabbing')}>
      <div className="flex items-start gap-2.5">
        {selecionavel && (
          <input type="checkbox" checked={!!marcado} onChange={onSel} aria-label={`Selecionar ${tituloItem(item)}`}
            className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-navy" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('self-start rounded-md px-2 py-0.5 text-[13px] font-semibold',
            ordem ? 'bg-slate-100 text-slate-700' : 'bg-indigo-100 text-indigo-800')}>
            {ordem ? 'Ordem de compra' : 'Despesa'}
          </span>
          {onAbrir ? (
            <button type="button" onClick={onAbrir} className="focus-ring -my-3.5 rounded py-3.5 text-left md:-my-3 md:py-3 text-[15px] font-semibold text-slate-900 hover:underline">
              {tituloItem(item)}
            </button>
          ) : <span className="text-[15px] font-semibold text-slate-900">{tituloItem(item)}</span>}
          <span className={cn('text-[13px]', semRecibo ? 'font-semibold text-red-800' : 'text-slate-600')}>
            {detalhe.filter(Boolean).join(' · ')}{semRecibo && ' · sem recibo'}
          </span>
        </div>
        <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-slate-900">
          {dado.valor != null ? fmtBRL(dado.valor) : '—'}
        </span>
      </div>

      {dado.status === 'aprovada' && (
        <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-green-800">
          Aprovada{dado.aprovado_em ? ` em ${ddmm(dado.aprovado_em.slice(0, 10))}` : ''}
          {ordem?.despesa_id && <> · virou despesa <SeloRecibo status={ordem.recibo_status} /></>}
        </span>
      )}
      {dado.status === 'rejeitada' && dado.rejeitado_motivo && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800"><b>Motivo:</b> {dado.rejeitado_motivo}</p>
      )}

      {(pendente && (onAprovar || onRejeitar)) || onExcluir ? (
        <div className="flex items-center gap-2">
          {pendente && ordem && !semRecibo && anexos ? (
            <span className="flex-1 whitespace-nowrap text-[13px] text-slate-600">📎 {anexos} recibo{anexos > 1 ? 's' : ''}</span>
          ) : <span className="flex-1" />}
          {onExcluir && (
            <button type="button" onClick={onExcluir} disabled={ocupado} aria-label={`Excluir ${tituloItem(item)}`} title="Excluir"
              className="focus-ring flex h-12 w-12 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 md:h-11 md:w-11">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            </button>
          )}
          {pendente && onRejeitar && (
            <button type="button" onClick={onRejeitar} disabled={ocupado}
              className="focus-ring h-12 flex-1 rounded-lg border border-gray-300 bg-white px-3.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 md:h-11 md:flex-none">
              Rejeitar
            </button>
          )}
          {pendente && onAprovar && (
            <button type="button" onClick={onAprovar} disabled={ocupado}
              className="focus-ring h-12 flex-1 rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 md:h-11 md:flex-none">
              Aprovar
            </button>
          )}
        </div>
      ) : null}
    </article>
  )
}

// ── Coluna ──────────────────────────────────────────────────────
export function ColunaKanban({ id, titulo, ponto, itens, soma, ativaCelular, aceitaDrop, onDrop, dicaDrop, vazio, children }: {
  id: string; titulo: string; ponto: string; itens: number; soma: number
  /** No celular só a coluna da aba escolhida aparece. */
  ativaCelular: boolean
  aceitaDrop?: boolean; onDrop?: () => void; dicaDrop?: string; vazio: string
  children: React.ReactNode
}) {
  const [sobre, setSobre] = useState(false)
  return (
    <section aria-labelledby={id}
      onDragOver={aceitaDrop ? (e) => { e.preventDefault(); setSobre(true) } : undefined}
      onDragLeave={aceitaDrop ? () => setSobre(false) : undefined}
      onDrop={aceitaDrop && onDrop ? (e) => { e.preventDefault(); setSobre(false); onDrop() } : undefined}
      className={cn('min-w-0 flex-col gap-2.5 rounded-2xl bg-slate-100 p-3 md:flex', ativaCelular ? 'flex' : 'hidden',
        sobre && 'ring-2 ring-inset ring-sel')}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id={id} className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
          <span className={cn('h-2.5 w-2.5 rounded-full', ponto)} aria-hidden="true" />{titulo}
        </h2>
        <span className="text-[13px] tabular-nums text-slate-600">{itens} · {fmtBRL(soma)}</span>
      </div>
      <div className="flex flex-col gap-2.5 md:max-h-[calc(100vh-300px)] md:overflow-y-auto md:pr-0.5">
        {itens === 0 && !aceitaDrop && <p className="py-8 text-center text-sm text-slate-600">{vazio}</p>}
        {children}
        {aceitaDrop && dicaDrop && (
          <div aria-hidden="true" className="hidden min-h-[96px] items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-sm font-semibold text-slate-600 md:flex">
            {dicaDrop}
          </div>
        )}
        {aceitaDrop && itens === 0 && <p className="py-6 text-center text-sm text-slate-600 md:hidden">{vazio}</p>}
      </div>
    </section>
  )
}

// ── Diálogo de rejeição ─────────────────────────────────────────
const MOTIVOS = ['Sem recibo', 'Fora da política', 'Valor errado']

export function DialogRejeitar({ titulo, resumo, avisar, loading, onCancelar, onConfirmar }: {
  titulo: string
  resumo: string
  /** Nome de quem pediu: o botão vira "Rejeitar e avisar <nome>". */
  avisar?: string | null
  loading: boolean
  onCancelar: () => void
  onConfirmar: (motivo: string) => void
}) {
  const [motivos, setMotivos] = useState<string[]>([])
  const [obs, setObs] = useState('')
  const [tentou, setTentou] = useState(false)
  const motivo = [motivos.join(', '), obs.trim()].filter(Boolean).join('. ')
  const vazio = !motivo
  const alternar = (m: string) => setMotivos(l => l.includes(m) ? l.filter(x => x !== m) : [...l, m])

  return (
    <Modal open onClose={onCancelar} title={titulo} variant="sheet" maxWidth="sm:max-w-md" dismissable={!loading}
      footer={
        <div className="grid grid-cols-[1fr_2fr] gap-2.5 sm:flex sm:justify-end">
          <Button variant="secondary" onClick={onCancelar} disabled={loading}>Cancelar</Button>
          <Button variant="danger" loading={loading} onClick={() => { setTentou(true); if (!vazio) onConfirmar(motivo) }}>
            {avisar ? `Rejeitar e avisar ${avisar}` : 'Rejeitar'}
          </Button>
        </div>
      }>
      <p className="text-sm text-slate-600">{resumo}</p>
      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-slate-700">Motivo</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {MOTIVOS.map(m => {
            const sel = motivos.includes(m)
            return (
              <button key={m} type="button" aria-pressed={sel} onClick={() => alternar(m)}
                className={cn('focus-ring h-11 rounded-full px-4 text-sm', sel ? 'border-2 border-sel bg-sel-bg font-semibold text-sel-text' : 'border border-gray-300 bg-white text-slate-700 hover:bg-gray-50')}>
                {m}
              </button>
            )
          })}
        </div>
      </fieldset>
      <label htmlFor="obs-rejeicao" className="mt-4 block text-[13px] text-slate-600">Observação para quem lançou (opcional)</label>
      <textarea id="obs-rejeicao" value={obs} onChange={e => setObs(e.target.value)} rows={3} maxLength={400}
        aria-invalid={tentou && vazio || undefined} aria-describedby={tentou && vazio ? 'rej-erro' : undefined}
        placeholder="Ex.: mande a nota fiscal das cadeiras e eu aprovo."
        className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-base text-slate-900 focus:border-navy focus-ring focus:outline-none md:text-sm" />
      {tentou && vazio && <p id="rej-erro" role="alert" className="mt-1 text-[13px] text-red-800">Escolha um motivo ou escreva uma observação.</p>}
      <p className="mt-2 text-[13px] text-slate-600">O motivo fica gravado e aparece para quem lançou.</p>
    </Modal>
  )
}
