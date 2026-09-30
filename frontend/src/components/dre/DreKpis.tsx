import { brl, pct } from './formato'
import { MetaChip } from './MetaChip'
import type { DreResposta, Kpi } from './tipos'

const ITENS: { chave: keyof DreResposta['kpis']; rotulo: string; mostraAv: boolean }[] = [
  { chave: 'receita', rotulo: 'Receita realizada', mostraAv: false },
  { chave: 'margem', rotulo: 'Margem de contribuição', mostraAv: true },
  { chave: 'resultado_operacional', rotulo: 'Resultado operacional', mostraAv: true },
  { chave: 'resultado_liquido', rotulo: 'Resultado líquido', mostraAv: true },
]

function Card({ rotulo, k, mostraAv }: { rotulo: string; k: Kpi; mostraAv: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{rotulo}</p>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-navy">{brl(k.realizado)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums text-gray-400">
        <MetaChip pctMeta={k.pct_meta} sentido={k.sentido} sufixo=" vs meta" />
        <span>meta {brl(k.previsto)}</span>
        {mostraAv && k.av != null && <span>· {pct(k.av)} da receita</span>}
      </div>
    </div>
  )
}

export function DreKpis({ kpis }: { kpis: DreResposta['kpis'] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ITENS.map(i => <Card key={i.chave} rotulo={i.rotulo} k={kpis[i.chave]} mostraAv={i.mostraAv} />)}
    </div>
  )
}
