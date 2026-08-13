'use client'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md'

const variants: Record<ButtonVariant, string> = {
  primary:   'bg-navy text-white hover:bg-navy-light',
  secondary: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  danger:    'bg-red-600 text-white hover:bg-red-700',
  ghost:     'text-gray-600 hover:bg-gray-100',
  link:      'text-navy underline-offset-2 hover:underline',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-5 py-2 text-sm',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Exibe spinner, desabilita o botão e anuncia `aria-busy`. */
  loading?: boolean
  /** Tom destrutivo para as variantes `ghost` e `link`. */
  tone?: 'default' | 'danger'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', tone = 'default', loading, disabled, className, children, ...props },
  ref,
) {
  const tonal =
    tone === 'danger' && (variant === 'ghost' || variant === 'link')
      ? 'text-red-600 hover:text-red-700'
      : null

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'focus-ring inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        variant === 'link' ? 'px-0 py-0' : sizes[size],
        tonal,
        className,
      )}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
})

/** Spinner circular. Padrão único de loading para ações (o Skeleton cobre a carga inicial). */
export function Spinner({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dim = size === 'sm' ? 'h-3.5 w-3.5 border-2' : size === 'lg' ? 'h-10 w-10 border-4' : 'h-5 w-5 border-2'
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn('inline-block shrink-0 animate-spin rounded-full border-current border-t-transparent', dim, className)}
    />
  )
}
