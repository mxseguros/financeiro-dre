import { brl, pct } from './formato'
import type { Linha, LinhaGrupo, LinhaResultado } from './tipos'

// Substitui o antigo "Despesas por Tipo de Lançamento" (plano §6.1 item 5).
const GRUPOS: [string, string][] = [
  ['2.1', 'Despesas variáveis'], ['4.1', 'Pessoal'], ['4.2', 'Comercial'], ['4.3', 'Administrativa'],
  ['4.4', 'Veículos'], ['4.5', 'Terceiros'], ['4.6', 'Financeira'], ['7.1', 'Não operacionais'], ['7.2', 'Investimentos'],
]

export function AnaliseVertical({ linhas }: { linhas: Linha[] }) {
  const por = (c: string) => linhas.find(l => l.codigo === c && l.tipo !== 'secao') as LinhaGrupo | LinhaResultado | undefined
  const itens = GRUPOS.map(([c, n]) => ({ n, g: por(c) }))
  const rl = por('9')
  const semReceita = itens.every(i => i.g?.av == null)
  if (semReceita) {
    return <p className="text-sm text-slate-600">Sem receita realizada no período — a análise vertical precisa de receita para calcular os percentuais.</p>
  }
  const max = Math.max(...itens.map(i => i.g?.av ?? 0), 0.0001)
  return (
    <div className="space-y-1.5">
      {itens.map(({ n, g }) => {
        const v = g?.av ?? 0
        return (
          <div key={n} className="grid grid-cols-[120px_1fr_56px] items-center gap-2 text-[13px] sm:grid-cols-[150px_1fr_60px]"
            title={`${n}: ${brl(g?.realizado ?? null)}`}>
            <span className="truncate text-gray-600">{n}</span>
            <span className="relative h-3 rounded bg-gray-100">
              <b className="absolute inset-y-0 left-0 rounded-r bg-[#2A78D6]" style={{ width: `${Math.max(0, v) / max * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-slate-600">{pct(g?.av ?? null)}</span>
          </div>
        )
      })}
      <div className="grid grid-cols-[120px_1fr_56px] gap-2 border-t border-gray-100 pt-1.5 text-[13px] font-semibold text-navy sm:grid-cols-[150px_1fr_60px]">
        <span>Resultado líquido</span><span /><span className="text-right tabular-nums">{pct(rl?.av ?? null)}</span>
      </div>
    </div>
  )
}
