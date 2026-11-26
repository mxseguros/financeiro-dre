'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Role, Permissions } from '@/types'
import { iniciarTour } from '@/components/tour/tour'
import { GRUPOS, Icon, ROTULO_PERFIL, ancoraTour, iniciais, itemAtivo, itemVisivel, type Contador } from './navegacao'
import { DICA_CONTADOR } from './useContadores'

interface Props {
  role: Role
  permissions: Permissions
  email: string
  nome: string
  contadores: Partial<Record<Contador, number>>
  onSignOut: () => void
}

/**
 * Menu lateral (desktop, ≥ 768 px). No celular a navegação é a TabBar.
 * Redesenho UX, fase 1: 248 px, itens de 44 px em 3 grupos, contadores e
 * perfil no rodapé.
 */
export function Sidebar({ role, permissions, email, nome, contadores, onSignOut }: Props) {
  const pathname = usePathname()
  const [menuPerfil, setMenuPerfil] = useState(false)
  const caixaPerfil = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuPerfil) return
    const fora = (e: MouseEvent) => { if (caixaPerfil.current && !caixaPerfil.current.contains(e.target as Node)) setMenuPerfil(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPerfil(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [menuPerfil])

  const nomeCurto = (nome || email.split('@')[0]).split(' ')[0]

  return (
    <aside className="hidden h-full w-[248px] shrink-0 flex-col bg-navy md:flex">
      <div className="flex h-[76px] shrink-0 items-center justify-center border-b border-white/10 px-5">
        <Image src="/logo_beige.png" alt="MX Corretora de Seguros" width={150} height={50} className="object-contain" />
      </div>

      <nav aria-label="Menu principal" className="flex-1 overflow-y-auto px-3 py-4">
        {GRUPOS.map(grupo => {
          const itens = grupo.itens.filter(i => itemVisivel(i, permissions, role))
          if (!itens.length) return null
          return (
            <div key={grupo.titulo} className="mb-5 last:mb-0">
              <p className="mb-1.5 px-3 text-[13px] font-medium text-white/55">{grupo.titulo}</p>
              <ul className="space-y-0.5">
                {itens.map(item => {
                  const ativo = itemAtivo(item.href, pathname)
                  const n = item.contador ? contadores[item.contador] ?? 0 : 0
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-tour={ancoraTour(item.href)}
                        aria-current={ativo ? 'page' : undefined}
                        className={cn(
                          'focus-ring flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                          ativo ? 'bg-white text-sel-text' : 'text-white/80 hover:bg-white/10 hover:text-white',
                        )}
                      >
                        <span className={ativo ? 'text-sel-text' : 'text-white/60'}>{item.icon}</span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {n > 0 && item.contador && (
                          <span
                            title={`${n} ${DICA_CONTADOR[item.contador]}`}
                            className={cn(
                              'min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[13px] font-semibold tabular-nums',
                              item.contador === 'aprovacoes'
                                ? 'bg-amber-300 text-amber-900'
                                : ativo ? 'bg-sel-bg text-sel-text' : 'bg-white/15 text-white',
                            )}
                          >
                            {n > 99 ? '99+' : n}
                            <span className="sr-only"> {DICA_CONTADOR[item.contador]}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Perfil: abre o menu com o tour desta tela e Sair. */}
      <div ref={caixaPerfil} className="relative border-t border-white/10 p-3">
        {menuPerfil && (
          <div role="menu" className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
            <p className="truncate px-4 py-2 text-[13px] text-slate-600">{email}</p>
            <button type="button" role="menuitem"
              onClick={() => { setMenuPerfil(false); iniciarTour(pathname) }}
              className="focus-ring flex h-11 w-full items-center gap-3 px-4 text-sm text-slate-700 hover:bg-gray-50">
              <span className="text-slate-500">{Icon.compass}</span> Tour guiado desta tela
            </button>
            <button type="button" role="menuitem" onClick={onSignOut}
              className="focus-ring flex h-11 w-full items-center gap-3 px-4 text-sm text-slate-700 hover:bg-gray-50">
              <span className="text-slate-500">{Icon.sair}</span> Sair
            </button>
          </div>
        )}
        <button
          type="button"
          data-tour="menu-tour"
          aria-haspopup="menu"
          aria-expanded={menuPerfil}
          onClick={() => setMenuPerfil(v => !v)}
          className="focus-ring flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-white/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-beige text-[13px] font-semibold text-navy">
            {iniciais(nome, email)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{nomeCurto}</span>
            <span className="block truncate text-[13px] text-white/60">{ROTULO_PERFIL[role] ?? role}</span>
          </span>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-white/60" aria-hidden="true">
            <path fillRule="evenodd" d="M14.77 12.79a.75.75 0 0 1-1.06-.02L10 8.832 6.29 12.77a.75.75 0 1 1-1.08-1.04l4.25-4.5a.75.75 0 0 1 1.08 0l4.25 4.5a.75.75 0 0 1-.02 1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
