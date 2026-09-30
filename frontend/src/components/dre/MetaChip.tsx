import { cn } from '@/lib/utils'
import { pct } from './formato'
import type { Sentido } from './tipos'

/**
 * % Meta com seta, percentual e cor pela natureza da linha (plano §4):
 * receitas e resultados — acima da meta é bom; despesas — abaixo é bom.
 * |desvio| < 0,5% é neutro. Cor nunca aparece sozinha: sempre seta + número.
 */
export function MetaChip({ pctMeta, sentido, sufixo }: { pctMeta: number | null; sentido: Sentido; sufixo?: string }) {
  if (pctMeta == null) return <span className="text-gray-400">—</span>
  const neutro = Math.abs(pctMeta) < 0.005
  const bom = sentido === 'maior_melhor' ? pctMeta >= 0 : pctMeta <= 0
  const cls = neutro ? 'bg-gray-100 text-gray-600' : bom ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
  const rotulo = neutro ? 'na meta' : bom ? 'melhor que a meta' : 'pior que a meta'
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}
      title={rotulo}>
      <span aria-hidden="true">{pctMeta >= 0 ? '▲' : '▼'}</span>
      {pct(Math.abs(pctMeta))}
      {sufixo && <span className="font-normal">{sufixo}</span>}
      <span className="sr-only">{rotulo}</span>
    </span>
  )
}
