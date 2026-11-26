'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { useTopBarValor } from '@/contexts/TopBarContext'
import { Icon, metaDaRota } from './navegacao'

/**
 * Barra do topo (redesenho UX, fase 1 — spec §2.2): título e subtítulo da
 * tela, seletor de período global, Exportar e a ação principal registrada
 * pela página (`useTopBar`). No celular vira cabeçalho simples, com o período
 * abaixo do título.
 */
export function TopBar() {
  const pathname = usePathname()
  const meta = metaDaRota(pathname)
  const { acao, subtitulo } = useTopBarValor()

  return (
    <header className="relative z-20 shrink-0 md:sticky md:top-0 border-b border-gray-200 bg-white">
      {/* Celular: grade com título e ação na 1ª linha e o período na 2ª.
          Desktop: tudo numa linha. A ação é renderizada uma vez só (o tour
          procura o primeiro data-tour da página). */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:flex md:min-h-[76px] md:justify-between md:gap-4 md:px-8">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold leading-tight text-navy">{meta.titulo}</h1>
          {(subtitulo || meta.subtitulo) && (
            <p className="mt-0.5 truncate text-[13px] text-slate-600 md:text-sm">{subtitulo || meta.subtitulo}</p>
          )}
        </div>

        {(meta.periodo || meta.exportar || acao) && (
          <div className="contents md:flex md:flex-nowrap md:items-center md:justify-end md:gap-2">
            {meta.periodo && <SeletorPeriodo intervaloMeses={meta.periodo === 'intervalo'} className="col-span-2 row-start-2 md:flex-nowrap" />}
            {meta.exportar && (
              <Link href="/dashboard/exports" data-tour="exportar"
                className="focus-ring hidden h-11 items-center gap-2 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-gray-50 md:inline-flex">
                <span className="text-slate-500 [&>svg]:h-4 [&>svg]:w-4">{Icon.download}</span>
                Exportar
              </Link>
            )}
            {acao && <div className="col-start-2 row-start-1">{acao}</div>}
          </div>
        )}
      </div>
    </header>
  )
}
