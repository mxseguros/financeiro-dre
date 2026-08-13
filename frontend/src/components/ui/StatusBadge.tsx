import { cn } from '@/lib/utils'

/**
 * Aparência única para o status de um lançamento.
 *
 * Substitui as duas versões divergentes que existiam (uma com borda em
 * `lancamentos/_components/shared.tsx`, outra sem em `dashboard/page.tsx`) —
 * o mesmo status precisa ter a mesma aparência em qualquer tela.
 */
const estilos: Record<string, string> = {
  pendente:  'bg-amber-50 text-amber-700 border-amber-200',
  aprovada:  'bg-green-50 text-green-700 border-green-200',
  rejeitada: 'bg-red-50 text-red-600 border-red-200',
  excluida:  'bg-gray-100 text-gray-500 border-gray-200',
}

const rotulos: Record<string, string> = {
  pendente:  'Pendente',
  aprovada:  'Aprovada',
  rejeitada: 'Rejeitada',
  excluida:  'Excluída',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        estilos[status] ?? 'bg-gray-100 text-gray-500 border-gray-200',
        className,
      )}
    >
      {rotulos[status] ?? status}
    </span>
  )
}
