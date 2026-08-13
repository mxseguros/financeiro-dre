'use client'
import { forwardRef, useId } from 'react'
import { cn } from '@/lib/utils'

export type ControlSize = 'sm' | 'md'

/**
 * Classe canônica dos controles de formulário do app.
 *
 * `md` (px-3 py-2, ~40px) é o padrão — alvo de toque confortável no mobile.
 * `sm` (px-2.5 py-1.5) existe para formulários densos, como os modais de
 * lançamento, que já rodam em `max-h-[92vh]` com scroll.
 */
export function controlCls(size: ControlSize = 'md', invalid?: boolean) {
  return cn(
    'w-full rounded-lg border bg-white text-sm text-gray-800 placeholder:text-gray-400',
    'focus-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400',
    size === 'sm' ? 'px-2.5 py-1.5' : 'px-3 py-2',
    invalid ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-navy',
  )
}

interface FieldProps {
  label: string
  /** Marca o label com `*` e não é repassado aos controles — quem exige é o input. */
  required?: boolean
  /** Texto auxiliar abaixo do controle. Some quando há erro. */
  hint?: string
  /** Mensagem de erro. Liga `aria-invalid`/`aria-describedby` no controle. */
  error?: string
  className?: string
  /** Recebe os atributos de acessibilidade já resolvidos. */
  children: (props: {
    id: string
    'aria-invalid': boolean | undefined
    'aria-describedby': string | undefined
  }) => React.ReactNode
}

/**
 * Wrapper de campo: label associado por `htmlFor`, hint e mensagem de erro
 * anunciada por leitor de tela.
 *
 * ```tsx
 * <Field label="Descrição" required error={erros.descricao}>
 *   {(p) => <Input {...p} value={form.descricao} onChange={…} required />}
 * </Field>
 * ```
 */
export function Field({ label, required, hint, error, className, children }: FieldProps) {
  const id = useId()
  const msgId = `${id}-msg`
  const temMsg = !!(error || hint)

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-0.5 block text-xs font-medium text-gray-500">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-500">*</span>}
        {required && <span className="sr-only"> (obrigatório)</span>}
      </label>

      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': temMsg ? msgId : undefined,
      })}

      {error ? (
        <p id={msgId} role="alert" className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p id={msgId} className="mt-1 text-xs text-gray-400">{hint}</p>
      ) : null}
    </div>
  )
}

// `size` é atributo HTML nativo (numérico) em input/select — omitido para que a
// prop de densidade do design system não colida com ele.
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: ControlSize }
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', className, ...props }, ref,
) {
  return <input ref={ref} className={cn(controlCls(size, props['aria-invalid'] === true), className)} {...props} />
})

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: ControlSize }
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', className, ...props }, ref,
) {
  return <select ref={ref} className={cn(controlCls(size, props['aria-invalid'] === true), className)} {...props} />
})

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: ControlSize }
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = 'md', className, ...props }, ref,
) {
  return <textarea ref={ref} className={cn(controlCls(size, props['aria-invalid'] === true), className)} {...props} />
})
