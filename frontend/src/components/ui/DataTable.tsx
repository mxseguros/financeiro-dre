'use client'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'
import { Skeleton } from './Skeleton'

export type Alinhamento = 'left' | 'right' | 'center'

/**
 * Papel da coluna na renderização mobile:
 * - `title` — linha principal do card (uma por coluna set)
 * - `value` — destaque à direita do título (tipicamente o valor monetário)
 * - `meta`  — linha secundária, prefixada pelo label
 * - `hidden`— não aparece no card
 * - `acoes` — bloco de ações, fixado no rodapé do card
 */
export type PapelMobile = 'title' | 'value' | 'meta' | 'hidden' | 'acoes'

export interface Column<T> {
  key: string
  label: string
  align?: Alinhamento
  /** Habilita o clique de ordenação no cabeçalho. */
  sortable?: boolean
  mobile?: PapelMobile
  /** Largura da coluna no desktop (classe Tailwind). */
  className?: string
  render: (item: T) => React.ReactNode
}

export interface OrdemTabela {
  campo: string
  dir: 'asc' | 'desc'
}

interface DataTableProps<T> {
  columns: Column<T>[]
  items: T[]
  rowKey: (item: T) => string
  loading?: boolean
  ordem?: OrdemTabela
  onOrdenar?: (campo: string) => void
  /** Linha de totais no rodapé da tabela (desktop). */
  footer?: React.ReactNode
  vazio?: { titulo: string; descricao?: string }
  className?: string
}

const alinhar: Record<Alinhamento, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

/**
 * Tabela responsiva a partir de UMA definição de colunas: renderiza `<table>` a
 * partir de `sm` e uma lista de cards abaixo disso. É o que substitui o padrão
 * atual de escrever cada linha duas vezes (bloco `sm:hidden` + bloco `hidden sm:block`).
 */
export function DataTable<T>({
  columns, items, rowKey, loading, ordem, onOrdenar, footer, vazio, className,
}: DataTableProps<T>) {
  if (loading) return <Skeleton variant="table" className={className} />

  if (items.length === 0) {
    return <EmptyState titulo={vazio?.titulo ?? 'Nenhum registro no período'} descricao={vazio?.descricao} />
  }

  const seta = (campo: string) =>
    ordem?.campo === campo ? (ordem.dir === 'asc' ? ' ↑' : ' ↓') : ''

  const colTitulo = columns.find(c => c.mobile === 'title')
  const colValor  = columns.find(c => c.mobile === 'value')
  const colsMeta  = columns.filter(c => c.mobile === 'meta')
  const colAcoes  = columns.find(c => c.mobile === 'acoes')

  return (
    <div className={className}>
      {/* Mobile — cards */}
      <ul className="space-y-2 sm:hidden">
        {items.map(item => (
          <li key={rowKey(item)} className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 text-sm font-medium text-gray-800">{colTitulo?.render(item)}</div>
              {colValor && <div className="shrink-0 text-sm font-semibold tabular-nums">{colValor.render(item)}</div>}
            </div>
            {colsMeta.length > 0 && (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {colsMeta.map(c => (
                  <div key={c.key} className="flex gap-1">
                    <dt className="shrink-0 text-gray-400">{c.label}:</dt>
                    <dd className="min-w-0 truncate text-gray-600">{c.render(item)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {colAcoes && (
              <div className="mt-2 flex justify-end gap-1 border-t border-gray-50 pt-2">{colAcoes.render(item)}</div>
            )}
          </li>
        ))}
      </ul>

      {/* Desktop — tabela */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] text-gray-500">
              {columns.map(c => (
                <th key={c.key} scope="col" className={cn('py-2 font-medium', alinhar[c.align ?? 'left'], c.className)}>
                  {c.sortable && onOrdenar ? (
                    <button
                      type="button"
                      onClick={() => onOrdenar(c.key)}
                      aria-sort={ordem?.campo === c.key ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="focus-ring rounded hover:text-gray-700"
                    >
                      {c.label}{seta(c.key)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={rowKey(item)} className="border-t border-gray-50 hover:bg-gray-50">
                {columns.map(c => (
                  <td key={c.key} className={cn('py-2', alinhar[c.align ?? 'left'], c.className)}>
                    {c.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t-2 border-gray-100 font-semibold text-navy">{footer}</tfoot>}
        </table>
      </div>
    </div>
  )
}
