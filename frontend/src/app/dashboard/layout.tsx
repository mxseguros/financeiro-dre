'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { TabBar } from '@/components/layout/TabBar'
import { useContadores } from '@/components/layout/useContadores'
import { TopBarProvider } from '@/contexts/TopBarContext'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { Spinner } from '@/components/ui/Button'
import { UserContext } from '@/contexts/UserContext'
import { PeriodoProvider, limparPeriodoSalvo } from '@/contexts/PeriodoContext'
import { iniciarTour, marcarTourVisto, tourInicialPendente } from '@/components/tour/tour'
import type { Usuario, Permissions } from '@/types'
import { getDefaultPermissions } from '@/types'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, token, signOut } = useAuth()
  const router = useRouter()
  const [usuario, setUsuario] = useState<Usuario | null>(null)

  useEffect(() => {
    if (!loading && !session) router.replace('/login')
  }, [loading, session, router])

  useEffect(() => {
    if (!token) return
    api.get<Usuario>('/usuarios/me', token)
      .then(setUsuario)
      .catch(() => {})
  }, [token])

  // Colaborador (0047) só lança Ordem de Compra: o painel não é para ele.
  const ehColaborador = usuario?.role === 'colaborador'
  useEffect(() => {
    if (ehColaborador) router.replace('/oc')
  }, [ehColaborador, router])

  // Primeiro acesso: tour guiado completo, uma vez por usuário neste navegador.
  // Espera o /usuarios/me (os itens do menu dependem das permissões) e um
  // respiro para os blocos da tela carregarem — passo sem elemento é pulado.
  const userId = session?.user.id
  useEffect(() => {
    if (!usuario || !userId || !tourInicialPendente(userId)) return
    const t = window.setTimeout(() => {
      marcarTourVisto(userId)
      iniciarTour(window.location.pathname, { completo: true })
    }, 1200)
    return () => window.clearTimeout(t)
  }, [usuario, userId])

  async function handleSignOut() {
    // Sair zera o periodo: o proximo login comeca no mes atual.
    limparPeriodoSalvo()
    await signOut()
    router.push('/login')
  }

  const role = (usuario?.role ?? 'comercial') as import('@/types').Role
  const permissions: Permissions = (usuario?.permissions as Permissions | null | undefined) ?? getDefaultPermissions(role)
  // Contadores do menu: só depois do /usuarios/me (dependem das permissões).
  const contadores = useContadores(usuario ? token : null, role, permissions)

  // Mesmo estado visual para "carregando sessão" e "sem sessão" — no segundo
  // caso o efeito acima já está redirecionando para /login.
  if (loading || !session || ehColaborador) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner size="lg" className="text-navy" />
      </div>
    )
  }

  const email = usuario?.email ?? session.user.email ?? ''
  const nome = usuario?.nome ?? ''
  const nav = { role, permissions, email, nome, contadores, onSignOut: handleSignOut }

  // ToastProvider por fora do UserContext e do ErrorBoundary: os avisos precisam
  // sobreviver a um re-render do usuário e a um erro capturado de página.
  return (
    <ToastProvider>
      <UserContext.Provider value={{ userId: session.user.id, role, nome, email, permissions }}>
      <PeriodoProvider>
      <TopBarProvider>
        {/* Redesenho UX (fase 1): menu lateral no desktop; no celular, barra
            inferior (TabBar). A barra do topo rola junto no celular. */}
        <div className="flex h-screen overflow-hidden bg-canvas">
          <Sidebar {...nav} />

          <div className="flex flex-1 flex-col overflow-y-auto">
            <TopBar />
            <main className="flex-1 px-4 py-4 pb-28 md:px-8 md:py-6 md:pb-8">
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>
          </div>

          <TabBar {...nav} />
        </div>
      </TopBarProvider>
      </PeriodoProvider>
      </UserContext.Provider>
    </ToastProvider>
  )
}
