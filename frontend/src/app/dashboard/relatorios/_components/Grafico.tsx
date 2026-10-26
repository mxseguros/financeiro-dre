'use client'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, formatoDe, nomeValor, type DadosGrafico, type Formato } from './pivot'

// Paleta categórica de referência, em ordem fixa (nunca ciclada). Validada com
// o validate_palette do skill de dataviz: CVD ΔE ≥ 9,1 entre vizinhas. Três
// cores ficam abaixo de 3:1 no fundo branco — por isso a tabela fica sempre
// disponível ao lado e a legenda nomeia cada série. A 1ª é o azul que o app já
// usa no gráfico da DRE.
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const EIXO = { fontSize: 11, fill: '#8A93A3' }

// Texto da legenda sempre em tinta de texto; a cor fica só no marcador.
const textoLegenda = (valor: string) => <span style={{ color: '#5E6B7D' }}>{valor}</span>

function compacto(x: number, f: Formato): string {
  if (f === 'int') return x.toLocaleString('pt-BR')
  if (f === 'pct') return `${x.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`
  const a = Math.abs(x)
  const s = x < 0 ? '−' : ''
  if (a >= 1_000_000) return `${s}R$ ${(a / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (a >= 1_000) return `${s}R$ ${(a / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`
  return `${s}R$ ${a.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
}

interface ItemDica { name: string; value: number | null; color: string }

function Dica({ active, payload, label, formato }: { active?: boolean; payload?: ItemDica[]; label?: string; formato: Formato }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-navy px-3 py-2 text-xs leading-relaxed text-white shadow-lg tabular-nums">
      <p className="mb-0.5 font-semibold">{label}</p>
      {payload.map(p => (
        <p key={p.name} className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="text-white/75">{p.name}:</span> {fmt(p.value, formato)}
        </p>
      ))}
    </div>
  )
}

export function Grafico({ dados }: { dados: DadosGrafico }) {
  const formato = formatoDe(dados.valor)
  const linhas = dados.categorias.map((c, i) => ({
    nome: c,
    ...Object.fromEntries(dados.series.map(s => [s.nome, s.valores[i]])),
  }))
  const legenda = dados.series.length > 1
  const tick = (x: number) => compacto(x, formato)

  if (dados.forma === 'linha') {
    return (
      <div className="h-80 px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={linhas} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#EEF0F4" />
            <XAxis dataKey="nome" tickLine={false} axisLine={false} tick={EIXO} />
            <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={92} tick={EIXO} />
            <Tooltip content={<Dica formato={formato} />} cursor={{ stroke: '#C9CED8', strokeWidth: 1 }} />
            {legenda && <Legend iconType="circle" iconSize={8} formatter={textoLegenda} wrapperStyle={{ fontSize: 11 }} />}
            {dados.series.map((s, i) => (
              <Line key={s.nome} dataKey={s.nome} stroke={PALETA[i]} strokeWidth={2} isAnimationActive={false}
                dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: PALETA[i] }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }}
                connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // Barras horizontais: os nomes dos grupos (subitens, bancos…) costumam ser longos.
  const altura = Math.max(200, dados.categorias.length * (dados.series.length > 1 ? 14 * dados.series.length + 14 : 30) + 60)
  return (
    <div className="px-2 pt-3" style={{ height: Math.min(altura, 720) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={linhas} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }} barGap={2} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="#EEF0F4" />
          <XAxis type="number" tickFormatter={tick} tickLine={false} axisLine={false} tick={EIXO} />
          <YAxis type="category" dataKey="nome" tickLine={false} axisLine={false} width={160} tick={{ ...EIXO, fill: '#5E6B7D' }}
            tickFormatter={(v: string) => (v.length > 26 ? v.slice(0, 25) + '…' : v)} />
          <Tooltip content={<Dica formato={formato} />} cursor={{ fill: 'rgba(42,120,214,0.06)' }} />
          {legenda && <Legend iconType="circle" iconSize={8} formatter={textoLegenda} wrapperStyle={{ fontSize: 11 }} />}
          {dados.series.map((s, i) => (
            <Bar key={s.nome} dataKey={s.nome} fill={PALETA[i]} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function legendaGrafico(dados: DadosGrafico): string {
  const v = nomeValor(dados.valor)
  return dados.forma === 'linha'
    ? `${v} ao longo do tempo, por grupo do 1º nível das linhas`
    : `${v} dos ${dados.categorias.length} maiores grupos do 1º nível das linhas`
}
