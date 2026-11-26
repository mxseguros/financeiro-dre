'use client'
import { forwardRef, useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

const Olho = ({ aberto }: { aberto: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {!aberto && <line x1="3" y1="3" x2="21" y2="21" />}
  </svg>
)

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  invalido?: boolean
}

/**
 * Campo de senha com o botão Mostrar/Ocultar dentro (redesenho UX, fase 2).
 * 48 px no celular e 44 px no desktop; borda vermelha quando `invalido`.
 */
export const CampoSenha = forwardRef<HTMLInputElement, Props>(function CampoSenha({ invalido, className, ...props }, ref) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className={cn(
      'flex h-12 items-center overflow-hidden rounded-lg border bg-white focus-within:ring-2 focus-within:ring-sel md:h-11',
      invalido ? 'border-2 border-red-700' : 'border-gray-300',
      className,
    )}>
      <input
        ref={ref}
        type={visivel ? 'text' : 'password'}
        aria-invalid={invalido || undefined}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-3.5 text-base text-slate-900 outline-none md:text-[15px]"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisivel(v => !v)}
        aria-pressed={visivel}
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        className="focus-ring flex h-full w-12 shrink-0 items-center justify-center border-l border-gray-200 bg-gray-50 text-slate-600 hover:text-slate-900 md:w-11"
      >
        <Olho aberto={!visivel} />
      </button>
    </div>
  )
})

export const CAMPO_TEXTO =
  'block h-12 w-full rounded-lg border bg-white px-3.5 text-base text-slate-900 placeholder-slate-400 outline-none focus:ring-2 focus:ring-sel md:h-11 md:text-[15px]'

/** Mensagem de erro de campo: ícone + texto (não só cor), lida pelo leitor de tela. */
export function ErroCampo({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] text-red-800">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="mt-px h-4 w-4 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" />
      </svg>
      {children}
    </p>
  )
}

/**
 * Logo MX das telas de acesso. O PNG é um quadrado de 1080 px com a marca numa
 * faixa no meio: o contêiner de 44 px recorta só a faixa.
 */
export function LogoAcesso() {
  return (
    <div className="mb-8 flex md:justify-center">
      <div className="relative -ml-[26px] h-11 w-[200px] overflow-hidden md:ml-0">
        <Image src="/logo_navy.png" alt="MX Corretora de Seguros" fill sizes="200px" priority className="object-cover" />
      </div>
    </div>
  )
}

/** Moldura das telas de acesso: logo acima e cartão centralizado (400 px) no desktop; tela cheia branca no celular. */
export function MolduraAcesso({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white md:items-center md:justify-center md:bg-canvas">
      <main className="flex w-full flex-1 flex-col px-5 pb-7 pt-12 md:max-w-[400px] md:flex-none md:px-0 md:py-10">
        {children}
      </main>
      <p className="pb-6 text-center text-[13px] text-slate-600">© {new Date().getFullYear()} MX Corretora de Seguros</p>
    </div>
  )
}
