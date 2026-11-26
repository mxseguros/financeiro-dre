'use client'
import { createContext, useContext, useEffect, useState, type DependencyList, type ReactNode } from 'react'

/**
 * Barra do topo (redesenho UX, fase 1): a página registra aqui a sua ação
 * principal (ex.: "+ Novo") e, se quiser, um subtítulo dinâmico. A barra lê
 * do contexto; ao sair da página o registro é desfeito.
 */
interface TopBarValor {
  acao: ReactNode
  subtitulo: ReactNode
  definirAcao: (n: ReactNode) => void
  definirSubtitulo: (n: ReactNode) => void
}

const TopBarContext = createContext<TopBarValor | null>(null)

export function TopBarProvider({ children }: { children: ReactNode }) {
  const [acao, definirAcao] = useState<ReactNode>(null)
  const [subtitulo, definirSubtitulo] = useState<ReactNode>(null)
  return (
    <TopBarContext.Provider value={{ acao, subtitulo, definirAcao, definirSubtitulo }}>
      {children}
    </TopBarContext.Provider>
  )
}

export function useTopBarValor(): TopBarValor {
  const v = useContext(TopBarContext)
  if (!v) throw new Error('useTopBarValor fora do TopBarProvider')
  return v
}

/**
 * Registra a ação principal e/ou o subtítulo da página na barra do topo.
 * `deps` controla quando o conteúdo é atualizado (como num useEffect).
 */
export function useTopBar({ acao, subtitulo }: { acao?: ReactNode; subtitulo?: ReactNode }, deps: DependencyList) {
  const ctx = useContext(TopBarContext)
  useEffect(() => {
    if (!ctx) return
    if (acao !== undefined) ctx.definirAcao(acao)
    if (subtitulo !== undefined) ctx.definirSubtitulo(subtitulo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => () => {
    if (!ctx) return
    if (acao !== undefined) ctx.definirAcao(null)
    if (subtitulo !== undefined) ctx.definirSubtitulo(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
