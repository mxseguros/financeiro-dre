'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { Sidebar } from '@/components/layout/Sidebar'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ToastProvider } from '@/components/ui/Toast'
import { Spinner } from '@/components/ui/Button'
import { UserContext } from '@/contexts/UserContext'
import type { Usuario, Permissions } from '@/types'
import { getDefaultPermissions } from '@/types'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, token, signOut } = useAuth()
  const router = useRouter()
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [sidebarAberta, setSidebarAberta] = useState(false)

  useEffect(() => {
    if (!loading && !session) router.replace('/login')
  }, [loading, session, router])

  useEffect(() => {
    if (!token) return
    api.get<Usuario>('/usuarios/me', token)
      .then(setUsuario)
      .catch(() => {})
  }, [token])

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  // Mesmo estado visual para "carregando sessão" e "sem sessão" — no segundo
  // caso o efeito acima já está redirecionando para /login.
  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <Spinner size="lg" className="text-navy" />
      </div>
    )
  }

  const role = (usuario?.role ?? 'comercial') as import('@/types').Role
  const email = usuario?.email ?? session.user.email ?? ''
  const nome = usuario?.nome ?? ''
  const permissions: Permissions = (usuario?.permissions as Permissions | null | undefined) ?? getDefaultPermissions(role)

  // ToastProvider por fora do UserContext e do ErrorBoundary: os avisos precisam
  // sobreviver a um re-render do usuário e a um erro capturado de página.
  return (
    <ToastProvider>
      <UserContext.Provider value={{ role, nome, email, permissions }}>
        <div className="flex h-screen overflow-hidden bg-canvas">
          <Sidebar
            role={role}
            permissions={permissions}
            email={email}
            nome={nome}
            onSignOut={handleSignOut}
            aberta={sidebarAberta}
            onFechar={() => setSidebarAberta(false)}
          />

          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Header mobile — visível apenas em telas pequenas */}
            <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
              <button
                onClick={() => setSidebarAberta(true)}
                className="focus-ring rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
                aria-label="Abrir menu"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <Image
                src="/logo_navy.png"
                alt="MX Seguros"
                width={100}
                height={34}
                className="object-contain"
              />
              <div className="w-8" /> {/* espaçador para centralizar logo */}
            </header>

            <main className="flex-1 overflow-auto p-4 md:p-8">
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </UserContext.Provider>
    </ToastProvider>
  )
}
