'use client'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Feedback de ação. A regra do app:
 *
 * - Erro/sucesso de **ação** (salvar, excluir, aprovar) → toast.
 * - Erro de **estado da tela** (falha ao carregar a lista, com "Tentar novamente")
 *   → banner inline no lugar do conteúdo, não toast. O usuário precisa do erro
 *   ancorado ao que falhou, e o retry mora ali.
 * - Erro dentro de formulário → permanece no modal, junto do campo.
 * - 401 → nada. `lib/api.ts` já encerra a sessão e redireciona para /login.
 */
export type ToastTipo = 'sucesso' | 'erro' | 'info'

interface Toast { id: number; tipo: ToastTipo; mensagem: string }

interface ToastCtx {
  toast: (mensagem: string, tipo?: ToastTipo) => void
  sucesso: (mensagem: string) => void
  erro: (mensagem: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const DURACAO_MS = 5000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const proximoId = useRef(0)

  const remover = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((mensagem: string, tipo: ToastTipo = 'info') => {
    const id = proximoId.current++
    setToasts(prev => [...prev, { id, tipo, mensagem }])
    setTimeout(() => remover(id), DURACAO_MS)
  }, [remover])

  const valor = useMemo<ToastCtx>(() => ({
    toast,
    sucesso: (m: string) => toast(m, 'sucesso'),
    erro:    (m: string) => toast(m, 'erro'),
  }), [toast])

  return (
    <Ctx.Provider value={valor}>
      {children}
      {/* Erros interrompem (assertive); sucesso e info aguardam a fala corrente. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
        aria-live="polite"
      >
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onClose={() => remover(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

const estilos: Record<ToastTipo, string> = {
  sucesso: 'border-green-200 bg-green-50 text-green-800',
  erro:    'border-red-200 bg-red-50 text-red-700',
  info:    'border-gray-200 bg-white text-gray-700',
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div
      role={toast.tipo === 'erro' ? 'alert' : 'status'}
      aria-live={toast.tipo === 'erro' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg',
        estilos[toast.tipo],
      )}
    >
      <span className="flex-1">{toast.mensagem}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        className="focus-ring -mr-1 shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>.')
  return ctx
}
