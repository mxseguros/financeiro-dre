'use client'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { brl, brlSinal, pct } from './formato'
import { MetaChip } from './MetaChip'
import type { Linha, LinhaConta, LinhaValores } from './tipos'

/** Conta sem previsto e sem realizado no recorte — some com "ocultar zeradas". */
export function ehZerada(l: LinhaValores): boolean {
  return !l.previsto && !l.realizado && !l.acumulado
}

function Celulas({ l }: { l: LinhaValores }) {
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{brl(l.previsto)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{brl(l.realizado)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{brlSinal(l.desvio)}</td>
      <td className="px-3 py-2 text-right"><MetaChip pctMeta={l.pct_meta} sentido={l.sentido} /></td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{pct(l.av)}</td>
    </>
  )
}

export function DreTable({ linhas, abertos, alternar, ocultarZeradas }: {
  linhas: Linha[]
  abertos: Set<string>
  alternar: (codigo: string) => void
  ocultarZeradas: boolean
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-gray-500">
            {['Conta', 'Previsto', 'Realizado', 'Desvio R$', '% Meta', 'AV %'].map((h, i) => (
              <th key={h} className={cn('border-b border-gray-100 px-3 py-2 font-semibold', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => {
            if (l.tipo === 'secao') {
              return (
                <tr key={`s${l.codigo}`}>
                  <td colSpan={6} className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    {l.codigo} - {l.nome}
                  </td>
                </tr>
              )
            }
            if (l.tipo === 'resultado') {
              return (
                <tr key={`r${l.codigo}`} className="bg-blue-50/60 font-bold text-navy">
                  <td className="px-3 py-2">{l.codigo} - {l.nome}</td>
                  <Celulas l={l} />
                </tr>
              )
            }
            const aberto = abertos.has(l.codigo)
            const contas = l.contas.filter((c: LinhaConta) => !(ocultarZeradas && ehZerada(c)))
            return (
              <Fragment key={`g${l.codigo}`}>
                <tr className="bg-gray-50 font-semibold text-gray-800">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => alternar(l.codigo)} aria-expanded={aberto}
                      className="focus-ring inline-flex items-center gap-1.5 rounded text-left">
                      <span className={cn('inline-block w-3 text-gray-400 transition-transform', !aberto && '-rotate-90')} aria-hidden="true">▾</span>
                      {l.codigo} - {l.nome}
                      {contas.length > 0 && <span className="text-[11px] font-normal text-gray-400">({contas.length})</span>}
                    </button>
                  </td>
                  <Celulas l={l} />
                </tr>
                {aberto && contas.map(c => (
                  <tr key={c.codigo} className="text-gray-600 [&>td]:border-b [&>td]:border-gray-100">
                    <td className="py-1.5 pl-9 pr-3">
                      {c.nome}{!c.ativo && <span className="ml-1.5 text-[10px] text-gray-400">(inativa)</span>}
                    </td>
                    <Celulas l={c} />
                  </tr>
                ))}
                {aberto && contas.length === 0 && (
                  <tr><td colSpan={6} className="py-1.5 pl-9 text-xs text-gray-400">Nenhuma conta com valor neste período.</td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
