import { cn } from '@/lib/utils'
import { brl, pct } from './formato'
import type { DreResposta } from './tipos'

// Sem % Meta aqui de propósito: na planilha a célula era #REF! (P3 do plano).
// Mostra valor, posição da receita contra o ponto e a folga.
export function PontoEquilibrio({ pe }: { pe: DreResposta['ponto_equilibrio'] }) {
  const linhas: [string, string, number | null, number | null][] = [
    ['Operacional', 'Receita necessária para cobrir as despesas fixas', pe.operacional, pe.folga_op],
    ['Financeiro', 'Inclui parcelas, distribuição de lucros e investimentos', pe.financeiro, pe.folga_fin],
  ]
  if (pe.receita == null) {
    return <p className="text-sm text-gray-400">Sem realizado no período.</p>
  }
  if (pe.operacional == null) {
    return <p className="text-sm text-gray-400">Margem de contribuição zerada ou negativa — o ponto de equilíbrio não existe nesse cenário.</p>
  }
  const escala = Math.max(pe.receita, pe.operacional ?? 0, pe.financeiro ?? 0) * 1.08 || 1
  return (
    <div className="space-y-4">
      {linhas.map(([nome, desc, valor, folga]) => {
        const acima = valor != null && (pe.receita ?? 0) >= valor
        return (
          <div key={nome}>
            <div className="flex justify-between gap-2 text-xs text-gray-500">
              <span><b className="text-gray-800">{nome}</b> · {desc}</span>
              <span className="shrink-0 tabular-nums">{brl(valor)}</span>
            </div>
            <div className="relative mt-1.5 h-2.5 rounded-full bg-gray-100"
              title={`Receita ${brl(pe.receita)} · ponto de equilíbrio ${brl(valor)}`}>
              <b className="absolute inset-y-0 left-0 rounded-full bg-[#2A78D6]" style={{ width: `${(pe.receita ?? 0) / escala * 100}%` }} />
              {valor != null && <em className="absolute -inset-y-1 w-0.5 bg-navy" style={{ left: `${valor / escala * 100}%` }} />}
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', acima ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                  {acima ? '✓ acima' : '! abaixo'}
                </span>
                receita {brl(pe.receita)}
              </span>
              <span className="tabular-nums">folga {pct(folga)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
