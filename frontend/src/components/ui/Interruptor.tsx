'use client'
import { cn } from '@/lib/utils'

/**
 * Interruptor (liga/desliga) com rótulo e explicação — `role="switch"`,
 * 44 px de área de toque (redesenho UX, fase 7).
 */
export function Interruptor({ ligado, onChange, rotulo, dica, disabled, id }: {
  ligado: boolean
  onChange: (v: boolean) => void
  rotulo: string
  dica?: string
  disabled?: boolean
  id: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className={cn('min-w-0', disabled && 'opacity-60')}>
        <span className="block text-sm font-semibold text-slate-800">{rotulo}</span>
        {dica && <span id={`${id}-dica`} className="block text-[13px] text-slate-600">{dica}</span>}
      </label>
      <button id={id} type="button" role="switch" aria-checked={ligado} aria-describedby={dica ? `${id}-dica` : undefined}
        disabled={disabled} onClick={() => onChange(!ligado)}
        className="focus-ring flex h-11 w-14 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50">
        <span className={cn('relative block h-7 w-12 rounded-full transition-colors', ligado ? 'bg-navy' : 'bg-slate-300')}>
          <span className={cn('absolute left-0 top-0.5 block h-6 w-6 rounded-full bg-white shadow transition-transform', ligado ? 'translate-x-[22px]' : 'translate-x-0.5')} />
        </span>
        <span className="sr-only">{ligado ? 'ligado' : 'desligado'}</span>
      </button>
    </div>
  )
}
