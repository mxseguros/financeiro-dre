import { cn } from '@/lib/utils'

/** Estado vazio padrão — substitui os `<td colSpan>` com "Nenhum X no período". */
export function EmptyState({ titulo, descricao, icone, acao, className }: {
  titulo: string
  descricao?: string
  icone?: React.ReactNode
  acao?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-12 text-center', className)}>
      {icone && <div className="text-gray-300" aria-hidden="true">{icone}</div>}
      <p className="text-sm font-medium text-gray-500">{titulo}</p>
      {descricao && <p className="max-w-sm text-xs text-gray-400">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  )
}
