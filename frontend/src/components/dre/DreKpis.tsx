import { cn } from '@/lib/utils'
import { brl, pct } from './formato'
import type { DreResposta, Kpi, Sentido } from './tipos'

// No celular o Resultado líquido vem primeiro, em destaque, ocupando a linha.
const ITENS: { chave: keyof DreResposta['kpis']; rotulo: string; mostraAv: boolean; ordem: string }[] = [
  { chave: 'receita', rotulo: 'Receita realizada', mostraAv: false, ordem: 'order-2 md:order-none' },
  { chave: 'margem', rotulo: 'Margem de contribuição', mostraAv: true, ordem: 'order-3 md:order-none' },
  { chave: 'resultado_operacional', rotulo: 'Resultado operacional', mostraAv: true, ordem: 'order-4 md:order-none' },
  { chave: 'resultado_liquido', rotulo: 'Resultado líquido', mostraAv: true, ordem: 'order-1 col-span-2 md:order-none md:col-span-1' },
]

/**
 * Variação contra a meta ESCRITA (redesenho UX, fase 5): "R$ 3.632 abaixo da
 * meta (24,9%)". A cor acompanha o texto, nunca vai sozinha. Abaixo de 0,5%
 * conta como "na meta".
 */
export function textoMeta(k: { realizado: number | null; previsto: number | null; pct_meta: number | null; sentido: Sentido }) {
  if (k.realizado == null || k.previsto == null || k.pct_meta == null) return null
  const diff = k.realizado - k.previsto
  if (Math.abs(k.pct_meta) < 0.005) return { texto: 'Na meta', tom: 'neutro' as const }
  const bom = k.sentido === 'maior_melhor' ? diff >= 0 : diff <= 0
  return {
    texto: `${brl(Math.abs(diff))} ${diff >= 0 ? 'acima' : 'abaixo'} da meta (${pct(Math.abs(k.pct_meta))})`,
    tom: bom ? 'bom' as const : 'ruim' as const,
  }
}

function Card({ rotulo, k, mostraAv, destaque, className }: { rotulo: string; k: Kpi; mostraAv: boolean; destaque?: boolean; className?: string }) {
  const meta = textoMeta(k)
  const corMeta = !meta ? '' : meta.tom === 'neutro' ? (destaque ? 'text-slate-300' : 'text-slate-600')
    : meta.tom === 'bom' ? (destaque ? 'text-green-300' : 'text-green-800') : (destaque ? 'text-red-300' : 'text-red-800')
  return (
    <div className={cn('flex flex-col gap-1 rounded-xl p-4', destaque ? 'bg-navy text-white' : 'border border-gray-200 bg-white', className)}>
      <span className={cn('text-[13px]', destaque ? 'text-slate-300' : 'text-slate-600')}>{rotulo}</span>
      <span className={cn('font-bold tabular-nums', destaque ? 'text-[26px] md:text-[22px]' : 'text-lg md:text-[22px]')}>{brl(k.realizado)}</span>
      {meta && <span className={cn('text-[13px] font-semibold', corMeta)}>{meta.texto}</span>}
      <span className={cn('text-[13px]', destaque ? 'text-slate-300' : 'text-slate-600')}>
        Meta {brl(k.previsto)}{mostraAv && k.av != null && ` · ${pct(k.av)} da receita`}
      </span>
    </div>
  )
}

export function DreKpis({ kpis }: { kpis: DreResposta['kpis'] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
      {ITENS.map(i => (
        <Card key={i.chave} rotulo={i.rotulo} k={kpis[i.chave]} mostraAv={i.mostraAv}
          destaque={i.chave === 'resultado_liquido'} className={i.ordem} />
      ))}
    </div>
  )
}
