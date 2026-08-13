'use client'
import { useRef } from 'react'
import { cn } from '@/lib/utils'

export interface TabItem<K extends string> {
  key: K
  label: string
  /** Contador exibido ao lado do rótulo (ex.: nº de pendentes). */
  badge?: React.ReactNode
}

/**
 * Abas acessíveis: `role="tablist"`, navegação por ←/→/Home/End e `aria-selected`.
 * Substitui as 3 implementações independentes de abas do app.
 *
 * O painel correspondente deve receber `id={panelId(k)}` e
 * `aria-labelledby={tabId(k)}` — use os helpers exportados.
 */
export function Tabs<K extends string>({ items, ativa, onChange, className, idPrefix = 'tab' }: {
  items: TabItem<K>[]
  ativa: K
  onChange: (k: K) => void
  className?: string
  idPrefix?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(e: React.KeyboardEvent) {
    const i = items.findIndex(t => t.key === ativa)
    let alvo = -1
    if (e.key === 'ArrowRight') alvo = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') alvo = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') alvo = 0
    else if (e.key === 'End') alvo = items.length - 1
    else return
    e.preventDefault()
    const k = items[alvo].key
    onChange(k)
    refs.current[k]?.focus()
  }

  return (
    <div role="tablist" onKeyDown={onKeyDown} className={cn('flex gap-1 border-b border-gray-200', className)}>
      {items.map(t => {
        const selecionada = t.key === ativa
        return (
          <button
            key={t.key}
            ref={el => { refs.current[t.key] = el }}
            role="tab"
            type="button"
            id={`${idPrefix}-${t.key}`}
            aria-selected={selecionada}
            aria-controls={`${idPrefix}-painel-${t.key}`}
            tabIndex={selecionada ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={cn(
              'focus-ring -mb-px flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              selecionada
                ? 'border-navy text-navy'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            )}
          >
            {t.label}
            {t.badge != null && t.badge !== 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">{t.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export const tabId = (prefix: string, k: string) => `${prefix}-${k}`
export const panelId = (prefix: string, k: string) => `${prefix}-painel-${k}`
