import { cn } from '@/lib/utils'
import type { Despesa, Receita } from './shared'

/**
 * Situação de cada lançamento em texto (redesenho UX, fase 3): o status nunca
 * vai só por cor. Datas comparadas como 'YYYY-MM-DD' no fuso do navegador.
 */

export type Tom = 'verde' | 'ambar' | 'laranja' | 'vermelho' | 'azul' | 'cinza'

const TONS: Record<Tom, string> = {
  verde:    'bg-green-100 text-green-800',
  ambar:    'bg-amber-100 text-amber-900',
  laranja:  'bg-orange-100 text-orange-800',
  vermelho: 'bg-red-100 text-red-800',
  azul:     'bg-blue-100 text-blue-800',
  cinza:    'bg-slate-100 text-slate-700',
}

export function Selo({ texto, tom, className }: { texto: string; tom: Tom; className?: string }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold', TONS[tom], className)}>
      {texto}
    </span>
  )
}

export function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Dias inteiros de `a` até `b` (ambos 'YYYY-MM-DD'). */
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86_400_000)
}

/** 'YYYY-MM-DD' → 'dd/mm'. */
export const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

export interface Situacao { texto: string; tom: Tom; atrasada?: boolean; paga?: boolean }

export function situacaoDespesa(d: Despesa, hoje = hojeISO()): Situacao {
  if (d.paga_em) return { texto: `Paga ${ddmm(d.paga_em)}`, tom: 'verde', paga: true }
  if (d.status === 'rejeitada') return { texto: 'Rejeitada', tom: 'vermelho' }
  const venc = d.data_vencimento?.slice(0, 10)
  const atrasada = !!venc && venc < hoje
  if (d.status === 'pendente') return { texto: 'Aguardando aprovação', tom: 'ambar', atrasada }
  if (!venc) return { texto: 'A pagar', tom: 'laranja' }
  const n = diasEntre(hoje, venc)
  if (n < 0) return { texto: `Vencida há ${-n} dia${n === -1 ? '' : 's'}`, tom: 'vermelho', atrasada: true }
  if (n === 0) return { texto: 'Vence hoje', tom: 'ambar' }
  if (n <= 7) return { texto: `A pagar · ${n} dia${n === 1 ? '' : 's'}`, tom: 'laranja' }
  return { texto: 'A pagar', tom: 'laranja' }
}

export function situacaoReceita(r: Receita, hoje = hojeISO()): Situacao {
  if (r.recebido_em) return { texto: `Recebida ${ddmm(r.recebido_em)}`, tom: 'verde', paga: true }
  if (r.status === 'rejeitada') return { texto: 'Rejeitada', tom: 'vermelho' }
  const venc = r.data_vencimento?.slice(0, 10)
  if (venc && venc < hoje) {
    const n = diasEntre(venc, hoje)
    return { texto: `Atrasada ${n} dia${n === 1 ? '' : 's'}`, tom: 'vermelho', atrasada: true }
  }
  return { texto: 'A receber', tom: 'azul' }
}

const STATUS_ORDEM: Record<string, [string, Tom]> = {
  pendente:  ['Aguardando aprovação', 'ambar'],
  aprovada:  ['Aprovada', 'verde'],
  rejeitada: ['Rejeitada', 'vermelho'],
}
export function situacaoOrdem(status: string): Situacao {
  const [texto, tom] = STATUS_ORDEM[status] ?? [status, 'cinza']
  return { texto, tom }
}

/** Ponto com a cor do banco (Itaú/Santander); os demais em cinza. Nunca em texto. */
export function PontoBanco({ nome }: { nome: string | null | undefined }) {
  if (!nome) return <span className="text-slate-500">—</span>
  const n = nome.toLowerCase()
  const cor = n.includes('ita') ? 'bg-itau' : n.includes('santander') ? 'bg-santander' : 'bg-slate-400'
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', cor)} aria-hidden="true" />
      {nome}
    </span>
  )
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** '2026-11-27' → '27 nov · sexta'. */
export function diaExtenso(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return `${d.getDate()} ${MESES_CURTOS[d.getMonth()]} · ${DIAS_SEMANA[d.getDay()]}`
}
