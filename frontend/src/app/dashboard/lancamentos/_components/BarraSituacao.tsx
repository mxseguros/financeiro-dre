'use client'
import { cn } from '@/lib/utils'
import type { Tom } from './situacao'

/**
 * Filtro "Situação" de Despesas e Receitas (28/11/2026). Uma situação por
 * lançamento, sem sobreposição — mesma regra do selo da lista e do backend
 * (app/services/situacao_filtro.py). A contagem não muda ao escolher um chip.
 */

export type SituacaoDespesa = 'a_pagar' | 'vence_hoje' | 'vencida' | 'aguardando' | 'paga' | 'rejeitada'
export type SituacaoReceita = 'a_receber' | 'atrasada' | 'recebida' | 'rejeitada'

export const OPCOES_DESPESA: { valor: SituacaoDespesa; texto: string; tom: Tom }[] = [
  { valor: 'a_pagar',    texto: 'A pagar',              tom: 'laranja' },
  { valor: 'vence_hoje', texto: 'Vence hoje',           tom: 'ambar' },
  { valor: 'vencida',    texto: 'Vencidas',             tom: 'vermelho' },
  { valor: 'aguardando', texto: 'Aguardando aprovação', tom: 'ambar' },
  { valor: 'paga',       texto: 'Pagas',                tom: 'verde' },
  { valor: 'rejeitada',  texto: 'Rejeitadas',           tom: 'cinza' },
]

export const OPCOES_RECEITA: { valor: SituacaoReceita; texto: string; tom: Tom }[] = [
  { valor: 'a_receber', texto: 'A receber',  tom: 'azul' },
  { valor: 'atrasada',  texto: 'Atrasadas',  tom: 'vermelho' },
  { valor: 'recebida',  texto: 'Recebidas',  tom: 'verde' },
  { valor: 'rejeitada', texto: 'Rejeitadas', tom: 'cinza' },
]

const PONTO: Record<Tom, string> = {
  verde: 'bg-green-600', ambar: 'bg-amber-500', laranja: 'bg-orange-500',
  vermelho: 'bg-red-600', azul: 'bg-blue-600', cinza: 'bg-slate-400',
}

export function BarraSituacao<T extends string>({ opcoes, valor, onChange, contagem }: {
  opcoes: { valor: T; texto: string; tom: Tom }[]
  valor: T | ''
  onChange: (v: T | '') => void
  contagem?: Record<string, number>
}) {
  const total = contagem ? Object.values(contagem).reduce((a, n) => a + n, 0) : null
  const chip = (ativo: boolean) => cn(
    'focus-ring inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors',
    ativo ? 'border-navy bg-navy text-white' : 'border-gray-300 bg-white text-slate-700 hover:bg-gray-50',
  )
  const qtd = (n: number | null | undefined, ativo: boolean) => n == null ? null : (
    <span className={cn('tabular-nums text-[13px]', ativo ? 'text-white/80' : 'text-slate-500')}>{n}</span>
  )
  return (
    <div role="group" aria-label="Situação"
      className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:p-0">
      <span className="mr-1 shrink-0 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Situação</span>
      <button type="button" aria-pressed={!valor} onClick={() => onChange('')} className={chip(!valor)}>
        Todas {qtd(total, !valor)}
      </button>
      {opcoes.map(o => {
        const ativo = valor === o.valor
        const n = contagem?.[o.valor]
        return (
          <button key={o.valor} type="button" aria-pressed={ativo}
            onClick={() => onChange(ativo ? '' : o.valor)}
            className={cn(chip(ativo), !ativo && n === 0 && 'opacity-60')}>
            <span className={cn('h-2 w-2 rounded-full', ativo ? 'bg-white' : PONTO[o.tom])} aria-hidden="true" />
            {o.texto} {qtd(n, ativo)}
          </button>
        )
      })}
    </div>
  )
}
