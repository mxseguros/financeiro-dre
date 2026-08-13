'use client'
import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

export type ModalVariant = 'center' | 'sheet' | 'fullscreen'

const FOCAVEIS = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Vai no `aria-labelledby`. Renderizado no header, exceto se `hideHeader`. */
  title: string
  /** Linha secundária sob o título, no header. */
  subtitle?: React.ReactNode
  hideHeader?: boolean
  /**
   * `center`  — diálogo centrado (padrão).
   * `sheet`   — bottom-sheet no mobile, centrado a partir de `sm`.
   * `fullscreen` — ocupa a tela inteira (wizards, como a importação de extrato).
   */
  variant?: ModalVariant
  /** Largura máxima no desktop. Ignorado em `fullscreen`. */
  maxWidth?: string
  /** Rodapé fixo — não rola junto com o conteúdo. */
  footer?: React.ReactNode
  /** Impede fechar por ESC/backdrop (ex.: durante um envio em andamento). */
  dismissable?: boolean
  /**
   * Substitui o padding e o scroll do corpo. Use quando o conteúdo gerencia a
   * própria rolagem — um wizard fullscreen com áreas fixas, por exemplo.
   */
  bodyClassName?: string
  children: React.ReactNode
}

/**
 * Diálogo acessível: `role="dialog"`, ESC, focus trap, retorno de foco ao
 * elemento que abriu e scroll-lock no `<body>`.
 *
 * Renderiza em portal no `<body>`. Formulários continuam funcionando dentro do
 * portal — o React propaga eventos pela árvore React, não pela árvore do DOM.
 */
export function Modal({
  open, onClose, title, subtitle, hideHeader, variant = 'center',
  maxWidth = 'sm:max-w-lg', footer, dismissable = true, bodyClassName, children,
}: ModalProps) {
  const painelRef = useRef<HTMLDivElement>(null)
  const abridorRef = useRef<HTMLElement | null>(null)
  const tituloId = useId()

  const fechar = useCallback(() => { if (dismissable) onClose() }, [dismissable, onClose])

  // Guarda quem abriu, foca o painel e restaura o foco ao fechar.
  useEffect(() => {
    if (!open) return
    abridorRef.current = document.activeElement as HTMLElement | null

    const primeiro = painelRef.current?.querySelector<HTMLElement>(FOCAVEIS)
    ;(primeiro ?? painelRef.current)?.focus()

    return () => { abridorRef.current?.focus?.() }
  }, [open])

  // Scroll-lock: preserva a largura da barra de rolagem para o fundo não "pular".
  useEffect(() => {
    if (!open) return
    const { body } = document
    const overflowAnterior = body.style.overflow
    const paddingAnterior = body.style.paddingRight
    const larguraBarra = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (larguraBarra > 0) body.style.paddingRight = `${larguraBarra}px`
    return () => { body.style.overflow = overflowAnterior; body.style.paddingRight = paddingAnterior }
  }, [open])

  // ESC fecha; Tab circula dentro do painel.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); fechar(); return }
      if (e.key !== 'Tab') return

      const alvos = Array.from(painelRef.current?.querySelectorAll<HTMLElement>(FOCAVEIS) ?? [])
        .filter(el => el.offsetParent !== null)
      if (alvos.length === 0) { e.preventDefault(); painelRef.current?.focus(); return }

      const primeiro = alvos[0]
      const ultimo = alvos[alvos.length - 1]
      const atual = document.activeElement

      if (e.shiftKey && (atual === primeiro || atual === painelRef.current)) {
        e.preventDefault(); ultimo.focus()
      } else if (!e.shiftKey && atual === ultimo) {
        e.preventDefault(); primeiro.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, fechar])

  if (!open || typeof document === 'undefined') return null

  const ehFullscreen = variant === 'fullscreen'
  const posicaoOverlay = ehFullscreen
    ? 'flex'
    : variant === 'sheet'
    ? 'flex items-end sm:items-center sm:justify-center'
    : 'flex items-center justify-center p-4'

  const formaPainel = ehFullscreen
    ? 'h-full w-full'
    : variant === 'sheet'
    ? cn('max-h-[92vh] w-full rounded-t-2xl sm:rounded-2xl', maxWidth)
    : cn('max-h-[92vh] w-full rounded-2xl', maxWidth)

  return createPortal(
    <div
      className={cn('fixed inset-0 z-50 bg-black/40', posicaoOverlay)}
      onMouseDown={(e) => { if (e.target === e.currentTarget) fechar() }}
    >
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn('flex flex-col overflow-hidden bg-white shadow-xl focus-ring focus:outline-none', formaPainel)}
      >
        <div className={cn('flex shrink-0 items-start justify-between gap-3 px-5 py-4', hideHeader && 'sr-only')}>
          <div className="min-w-0">
            <h2 id={tituloId} className="text-base font-semibold text-navy">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          </div>
          {dismissable && !hideHeader && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="focus-ring -mr-1 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className={bodyClassName ?? 'flex-1 overflow-y-auto px-5 pb-5'}>{children}</div>

        {footer && <div className="shrink-0 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
