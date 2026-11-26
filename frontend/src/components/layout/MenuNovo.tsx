'use client'
import { useEffect, useRef, useState } from 'react'

export type TipoNovo = 'despesa' | 'receita' | 'ordem' | 'importar'

/** Evento que a TabBar dispara quando o "+ Lançar" é tocado já na tela de Lançamentos. */
export const EVENTO_NOVO = 'dre:novo-lancamento'

const OPCOES: [TipoNovo, string, string][] = [
  ['despesa', 'Despesa', 'Conta a pagar'],
  ['receita', 'Receita', 'Valor a receber'],
  ['ordem', 'Ordem de compra', 'Pedido para aprovação'],
  ['importar', 'Importar extrato', 'OFX ou CSV do banco'],
]

/**
 * Ação principal da tela de Lançamentos na barra do topo (spec §2.2):
 * "+ Novo ▾" com Despesa, Receita, Ordem de compra e Importar extrato.
 */
export function MenuNovo({ onEscolher }: { onEscolher: (t: TipoNovo) => void }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  return (
    <div ref={caixa} data-tour="novos-lancamentos" className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(v => !v)}
        className="focus-ring inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-lg bg-navy px-4 text-sm font-semibold text-white shadow-sm hover:bg-navy-light md:h-11">
        <span className="text-lg leading-none">+</span> Novo
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 opacity-80" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {OPCOES.map(([tipo, rotulo, dica]) => (
            <button key={tipo} type="button" role="menuitem"
              data-tour={tipo === 'importar' ? 'importar' : undefined}
              onClick={() => { setAberto(false); onEscolher(tipo) }}
              className={`focus-ring flex min-h-[52px] w-full flex-col justify-center px-4 text-left hover:bg-gray-50 ${tipo === 'importar' ? 'border-t border-gray-100' : ''}`}>
              <span className="text-sm font-medium text-slate-900">{rotulo}</span>
              <span className="text-[13px] text-slate-600">{dica}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
