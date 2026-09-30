'use client'
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { brl, brlMil, pct } from './formato'
import { MESES, type DreResposta } from './tipos'

// Série única de dados: barra = realizado, traço = previsto (meta).
// Verde/vermelho ficam reservados ao status de meta (plano §6.3), nunca à série.
const COR = '#2A78D6'
const COR_FRACA = '#9DBFEA'
const COR_META = '#0B1B36'

type Ponto = { mes: number; nome: string; realizado: number | null; previsto: number | null }

/** Traço horizontal no valor da meta — o "alvo" de cada mês. */
function TracoMeta(props: { cx?: number; cy?: number; payload?: Ponto }) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || payload?.previsto == null) return <g />
  return <line x1={cx - 13} x2={cx + 13} y1={cy} y2={cy} stroke={COR_META} strokeWidth={2} />
}

function Dica({ active, payload }: { active?: boolean; payload?: { payload: Ponto }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const d = p.realizado != null && p.previsto ? (p.realizado - p.previsto) / Math.abs(p.previsto) : null
  return (
    <div className="rounded-lg bg-navy px-3 py-2 text-xs leading-relaxed text-white shadow-lg tabular-nums">
      <p className="font-semibold">{MESES[p.mes - 1]}</p>
      <p>Realizado: {brl(p.realizado)}</p>
      <p>Meta: {brl(p.previsto)}</p>
      {d != null && <p className="text-blue-200">{d >= 0 ? '▲' : '▼'} {pct(Math.abs(d))} vs meta</p>}
    </div>
  )
}

export function ResultadoMensalChart({ mensal, mesRef, aoEscolherMes }: {
  mensal: DreResposta['mensal']
  mesRef: number
  aoEscolherMes: (mes: number) => void
}) {
  const dados: Ponto[] = mensal.map(m => ({ mes: m.mes, nome: MESES[m.mes - 1], realizado: m.resultado_liquido, previsto: m.rl_previsto }))
  return (
    <div>
      <div className="mb-2 flex gap-4 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-sm" style={{ background: COR }} />Realizado</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0.5 w-3" style={{ background: COR_META }} />Previsto (meta)</span>
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
            onClick={(e: { activePayload?: { payload: Ponto }[] } | null) => {
              const p = e?.activePayload?.[0]?.payload
              if (p) aoEscolherMes(p.mes)
            }}>
            <CartesianGrid vertical={false} stroke="#EEF0F4" />
            <XAxis dataKey="nome" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#8A93A3' }} />
            <YAxis tickFormatter={brlMil} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: '#8A93A3' }} />
            <ReferenceLine y={0} stroke="#C9CED8" />
            <Tooltip content={<Dica />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
            <Bar dataKey="realizado" radius={[4, 4, 4, 4]} maxBarSize={34} className="cursor-pointer">
              {dados.map(d => <Cell key={d.mes} fill={d.mes === mesRef ? COR : COR_FRACA} />)}
            </Bar>
            <Line dataKey="previsto" stroke="transparent" isAnimationActive={false}
              dot={<TracoMeta />} activeDot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">Clique num mês para torná-lo o mês de referência.</p>
    </div>
  )
}
