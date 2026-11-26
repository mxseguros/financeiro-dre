'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Permissions, Role } from '@/types'
import { iniciarTour } from '@/components/tour/tour'
import { GRUPOS, Icon, ROTULO_PERFIL, iniciais, itemAtivo, itemVisivel, type Contador, type NavItem } from './navegacao'
import { DICA_CONTADOR } from './useContadores'
import { EVENTO_NOVO } from './MenuNovo'

interface Props {
  role: Role
  permissions: Permissions
  email: string
  nome: string
  contadores: Partial<Record<Contador, number>>
  onSignOut: () => void
}

const TODOS = GRUPOS.flatMap(g => g.itens)
const item = (href: string) => TODOS.find(i => i.href === href)!
const FIXOS = ['/dashboard', '/dashboard/lancamentos', '/dashboard/lancamentos/aprovacoes']

const NOVOS: [string, string, string][] = [
  ['despesa', 'Despesa', 'Conta a pagar'],
  ['receita', 'Receita', 'Valor a receber'],
  ['ordem', 'Ordem de compra', 'Pedido para aprovação'],
]

/** Folha que sobe de baixo, com fundo escurecido. Fecha com Esc ou tocando fora. */
function Folha({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-black/50" onClick={onFechar} />
      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-2">
          <p className="text-base font-semibold text-slate-900">{titulo}</p>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="focus-ring flex h-12 w-12 items-center justify-center rounded-lg text-xl text-slate-600 hover:bg-gray-100">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Barra inferior do celular (< 768 px), spec §2.3: Início, Lançamentos,
 * + Lançar, Aprovações e Mais. Substitui a gaveta do menu.
 */
export function TabBar({ role, permissions, email, nome, contadores, onSignOut }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [folha, setFolha] = useState<'novo' | 'mais' | null>(null)

  useEffect(() => { setFolha(null) }, [pathname])

  const ve = (i: NavItem) => itemVisivel(i, permissions, role)
  const [inicio, lancamentos, aprovacoes] = FIXOS.map(item)
  const podeLancar = ve(lancamentos)
  const mais = GRUPOS.map(g => ({ ...g, itens: g.itens.filter(i => !FIXOS.includes(i.href) && ve(i)) }))
    .filter(g => g.itens.length)
  const maisAtivo = mais.some(g => g.itens.some(i => itemAtivo(i.href, pathname)))

  const aba = (i: NavItem, rotulo: string) => {
    const ativo = itemAtivo(i.href, pathname)
    const n = i.contador ? contadores[i.contador] ?? 0 : 0
    return (
      <Link key={i.href} href={i.href} aria-current={ativo ? 'page' : undefined}
        className={cn('focus-ring relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[13px] font-medium',
          ativo ? 'text-sel-text' : 'text-slate-600')}>
        <span className="relative">
          {i.icon}
          {n > 0 && i.contador && (
            <span className="absolute -right-3 -top-2 min-w-[1.25rem] rounded-full bg-amber-300 px-1 text-center text-[13px] font-semibold leading-5 text-amber-900">
              {n > 99 ? '99+' : n}<span className="sr-only"> {DICA_CONTADOR[i.contador]}</span>
            </span>
          )}
        </span>
        {rotulo}
      </Link>
    )
  }

  return (
    <>
      <nav aria-label="Menu principal"
        className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(64px+env(safe-area-inset-bottom))] items-stretch gap-1 border-t border-gray-200 bg-white px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
        {ve(inicio) && aba(inicio, 'Início')}
        {podeLancar && aba(lancamentos, 'Lançamentos')}
        {podeLancar && (
          <div className="flex flex-1 items-start justify-center">
            <button type="button" onClick={() => setFolha('novo')} aria-label="Lançar: despesa, receita ou ordem de compra"
              className="focus-ring -mt-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-navy text-3xl font-light leading-none text-white shadow-lg">
              +
            </button>
          </div>
        )}
        {ve(aprovacoes) && aba(aprovacoes, 'Aprovações')}
        <button type="button" onClick={() => setFolha('mais')} aria-haspopup="dialog"
          className={cn('focus-ring flex flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[13px] font-medium',
            maisAtivo ? 'text-sel-text' : 'text-slate-600')}>
          {Icon.mais}
          Mais
        </button>
      </nav>

      {folha === 'novo' && (
        <Folha titulo="Lançar" onFechar={() => setFolha(null)}>
          <ul className="p-2">
            {NOVOS.map(([tipo, rotulo, dica]) => (
              <li key={tipo}>
                <button type="button" onClick={() => {
                  setFolha(null)
                  if (pathname === '/dashboard/lancamentos') window.dispatchEvent(new CustomEvent(EVENTO_NOVO, { detail: tipo }))
                  else router.push(`/dashboard/lancamentos?novo=${tipo}`)
                }}
                  className="focus-ring flex min-h-[56px] w-full flex-col justify-center rounded-lg px-4 text-left hover:bg-gray-50">
                  <span className="text-base font-medium text-slate-900">{rotulo}</span>
                  <span className="text-[13px] text-slate-600">{dica}</span>
                </button>
              </li>
            ))}
          </ul>
        </Folha>
      )}

      {folha === 'mais' && (
        <Folha titulo="Mais" onFechar={() => setFolha(null)}>
          {mais.map(g => (
            <div key={g.titulo} className="px-2 pt-3">
              <p className="px-4 pb-1 text-[13px] font-medium text-slate-600">{g.titulo}</p>
              {g.itens.map(i => {
                const n = i.contador ? contadores[i.contador] ?? 0 : 0
                return (
                  <Link key={i.href} href={i.href} aria-current={itemAtivo(i.href, pathname) ? 'page' : undefined}
                    className={cn('focus-ring flex h-12 items-center gap-3 rounded-lg px-4 text-base',
                      itemAtivo(i.href, pathname) ? 'bg-sel-bg text-sel-text' : 'text-slate-800 hover:bg-gray-50')}>
                    <span className="text-slate-500">{i.icon}</span>
                    <span className="flex-1">{i.label}</span>
                    {n > 0 && i.contador && (
                      <span className="rounded-full bg-gray-100 px-2 text-[13px] font-semibold tabular-nums text-slate-700">
                        {n}<span className="sr-only"> {DICA_CONTADOR[i.contador]}</span>
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
          <div className="mx-2 mt-3 border-t border-gray-100 pt-2">
            <button type="button" onClick={() => { setFolha(null); window.setTimeout(() => iniciarTour(pathname), 250) }}
              className="focus-ring flex h-12 w-full items-center gap-3 rounded-lg px-4 text-base text-slate-800 hover:bg-gray-50">
              <span className="text-slate-500">{Icon.compass}</span> Tour guiado desta tela
            </button>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-[13px] font-semibold text-white">
                {iniciais(nome, email)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{nome || email}</span>
                <span className="block text-[13px] text-slate-600">{ROTULO_PERFIL[role] ?? role}</span>
              </span>
              <button type="button" onClick={onSignOut}
                className="focus-ring h-12 rounded-lg border border-gray-300 px-4 text-sm font-medium text-slate-700 hover:bg-gray-50">
                Sair
              </button>
            </div>
          </div>
        </Folha>
      )}
    </>
  )
}
