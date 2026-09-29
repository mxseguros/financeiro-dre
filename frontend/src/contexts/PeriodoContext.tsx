'use client'
import { createContext, useCallback, useContext, useState } from 'react'
import { mesAtual } from '@/lib/utils'

/**
 * Período selecionado, compartilhado por todas as telas do dashboard.
 *
 * Regra (pedido de 29/09/2026): ao entrar no sistema começa no mês atual;
 * depois que o usuário escolhe um mês, a escolha acompanha a navegação entre
 * telas até uma nova seleção. Por isso o estado vive no layout do dashboard
 * (que não desmonta ao trocar de página) e é espelhado no sessionStorage, para
 * sobreviver a um F5 — mas não a um novo login nem a uma aba nova.
 *
 * Meses em 'YYYY-MM'. Telas de mês único usam `mesInicio` e gravam com
 * `definirMes`, que iguala início e fim.
 */
export const CHAVE_PERIODO = 'dre.periodo'

interface PeriodoValor {
  mesInicio: string
  mesFim: string
  definirPeriodo: (inicio: string, fim: string) => void
  definirMes: (mes: string) => void
}

const PeriodoContext = createContext<PeriodoValor | null>(null)

const ehMes = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)

function inicial(): [string, string] {
  const atual = mesAtual()[0].slice(0, 7)
  try {
    const salvo = JSON.parse(window.sessionStorage.getItem(CHAVE_PERIODO) ?? 'null')
    if (Array.isArray(salvo) && ehMes(salvo[0]) && ehMes(salvo[1])) return [salvo[0], salvo[1]]
  } catch { /* sem storage (aba privada, SSR): segue no mês atual */ }
  return [atual, atual]
}

export function limparPeriodoSalvo() {
  try { window.sessionStorage.removeItem(CHAVE_PERIODO) } catch { /* idem */ }
}

export function PeriodoProvider({ children }: { children: React.ReactNode }) {
  const [[mesInicio, mesFim], setPeriodo] = useState<[string, string]>(inicial)

  const definirPeriodo = useCallback((inicio: string, fim: string) => {
    if (!ehMes(inicio) || !ehMes(fim)) return  // input limpo pelo usuário: mantém o anterior
    setPeriodo([inicio, fim])
    try { window.sessionStorage.setItem(CHAVE_PERIODO, JSON.stringify([inicio, fim])) } catch { /* idem */ }
  }, [])

  const definirMes = useCallback((mes: string) => definirPeriodo(mes, mes), [definirPeriodo])

  return (
    <PeriodoContext.Provider value={{ mesInicio, mesFim, definirPeriodo, definirMes }}>
      {children}
    </PeriodoContext.Provider>
  )
}

export function usePeriodo(): PeriodoValor {
  const ctx = useContext(PeriodoContext)
  if (!ctx) throw new Error('usePeriodo precisa estar dentro de <PeriodoProvider>')
  return ctx
}
