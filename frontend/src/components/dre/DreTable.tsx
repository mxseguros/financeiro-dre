'use client'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { brl, pct } from './formato'
import type { Linha, LinhaConta, LinhaValores } from './tipos'

/** Conta sem previsto e sem realizado no recorte — some com "ocultar zeradas". */
export function ehZerada(l: LinhaValores): boolean {
  return !l.previsto && !l.realizado && !l.acumulado
}

/**
 * Diferença contra o previsto, ESCRITA (redesenho UX, fase 5): "− R$ 3.460
 * pior" / "+ R$ 85 melhor". Melhor/pior seguem o sentido da linha (receita:
 * mais é melhor; despesa: menos é melhor). Abaixo de 0,5% da meta, neutro.
 */
export function Diferenca({ l, escuro }: { l: LinhaValores; escuro?: boolean }) {
  if (l.desvio == null) return <span className={escuro ? 'text-slate-400' : 'text-slate-500'}>—</span>
  const neutro = (l.pct_meta != null && Math.abs(l.pct_meta) < 0.005) || l.desvio === 0
  const bom = l.sentido === 'maior_melhor' ? l.desvio >= 0 : l.desvio <= 0
  const cor = neutro ? (escuro ? 'text-slate-300' : 'text-slate-600')
    : bom ? (escuro ? 'text-green-300' : 'text-green-800') : (escuro ? 'text-red-300' : 'text-red-800')
  const palavra = neutro ? 'na meta' : bom ? 'melhor' : 'pior'
  return (
    <span className={cn('whitespace-nowrap tabular-nums', cor)}>
      {l.desvio > 0 ? '+ ' : l.desvio < 0 ? '− ' : ''}{brl(Math.abs(l.desvio))}
      {' '}{palavra}
    </span>
  )
}

const th = 'px-3 py-2.5 text-[13px] font-semibold text-slate-600'

function Celulas({ l, forte, escuro }: { l: LinhaValores; forte?: boolean; escuro?: boolean }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums">{brl(l.previsto)}</td>
      <td className={cn('px-3 py-2.5 text-right tabular-nums', forte && 'font-bold')}>{brl(l.realizado)}</td>
      <td className="px-3 py-2.5 text-right"><Diferenca l={l} escuro={escuro} /></td>
      <td className="px-3 py-2.5 pr-4 text-right tabular-nums md:pr-5">{pct(l.av)}</td>
    </>
  )
}

/** Primeira coluna fixa ao rolar de lado; o fundo acompanha o da linha. */
const fixa = 'sticky left-0 z-[1]'

export function DreTable({ linhas, abertos, alternar, ocultarZeradas }: {
  linhas: Linha[]
  abertos: Set<string>
  alternar: (codigo: string) => void
  ocultarZeradas: boolean
}) {
  const ultimoResultado = [...linhas].reverse().find(l => l.tipo === 'resultado')?.codigo
  return (
    <>
      {/* Desktop: tabela */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th scope="col" className={cn(th, fixa, 'bg-slate-50 pl-4 text-left md:pl-5')}>Conta</th>
              {['Previsto', 'Realizado', 'Diferença', '% da receita'].map(h => (
                <th key={h} scope="col" className={cn(th, 'text-right last:pr-4 md:last:pr-5')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              if (l.tipo === 'secao') {
                return (
                  <tr key={`s${l.codigo}`}>
                    <td colSpan={5} className={cn(fixa, 'border-t border-slate-200 bg-white px-4 pb-1 pt-4 text-[13px] font-bold uppercase tracking-wide text-slate-600 md:px-5')}>
                      {l.codigo} · {l.nome}
                    </td>
                  </tr>
                )
              }
              if (l.tipo === 'resultado') {
                const final = l.codigo === ultimoResultado
                return (
                  <tr key={`r${l.codigo}`} className={cn('[&>td]:border-t', final ? 'bg-navy text-white [&>td]:border-navy' : 'bg-slate-50 font-semibold text-slate-900 [&>td]:border-slate-200')}>
                    <td className={cn(fixa, 'py-3 pl-4 pr-3 font-bold md:pl-5', final ? 'bg-navy' : 'bg-slate-50')}>= {l.nome}</td>
                    <Celulas l={l} forte escuro={final} />
                  </tr>
                )
              }
              const aberto = abertos.has(l.codigo)
              const contas = l.contas.filter((c: LinhaConta) => !(ocultarZeradas && ehZerada(c)))
              return (
                <Fragment key={`g${l.codigo}`}>
                  <tr className="font-semibold text-slate-900 [&>td]:border-t [&>td]:border-slate-200">
                    <td className={cn(fixa, 'bg-white py-1 pl-2 pr-3 md:pl-3')}>
                      <button type="button" onClick={() => alternar(l.codigo)} aria-expanded={aberto}
                        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-left hover:bg-slate-50">
                        <span className={cn('inline-block w-3 text-slate-500 transition-transform', !aberto && '-rotate-90')} aria-hidden="true">▾</span>
                        {l.codigo} · {l.nome}
                        {contas.length > 0 && <span className="text-[13px] font-normal text-slate-500">({contas.length})</span>}
                      </button>
                    </td>
                    <Celulas l={l} forte />
                  </tr>
                  {aberto && contas.map(c => (
                    <tr key={c.codigo} className="text-slate-700 [&>td]:border-t [&>td]:border-slate-100">
                      <td className={cn(fixa, 'bg-white py-2.5 pl-12 pr-3')}>
                        {c.nome}{!c.ativo && <span className="ml-1.5 text-[13px] text-slate-500">(inativa)</span>}
                      </td>
                      <Celulas l={c} />
                    </tr>
                  ))}
                  {aberto && contas.length === 0 && (
                    <tr><td colSpan={5} className="py-2 pl-12 text-[13px] text-slate-500">Nenhuma conta com valor neste período.</td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Celular: sanfona com Realizado e diferença */}
      <div className="md:hidden">
        {linhas.map(l => {
          if (l.tipo === 'secao') {
            return <p key={`s${l.codigo}`} className="border-t border-slate-200 px-4 pb-1 pt-4 text-[13px] font-bold uppercase tracking-wide text-slate-600">{l.nome}</p>
          }
          if (l.tipo === 'resultado') {
            const final = l.codigo === ultimoResultado
            return (
              <div key={`r${l.codigo}`} className={cn('flex min-h-[56px] items-center justify-between gap-3 border-t px-4',
                final ? 'border-navy bg-navy text-white' : 'border-slate-200 bg-slate-50')}>
                <span className="text-[15px] font-bold">= {l.nome}</span>
                <span className="flex flex-col items-end">
                  <span className={cn('font-bold tabular-nums', final && 'text-[17px]')}>{brl(l.realizado)}</span>
                  <span className="text-[13px]"><Diferenca l={l} escuro={final} /></span>
                </span>
              </div>
            )
          }
          const aberto = abertos.has(l.codigo)
          const contas = l.contas.filter((c: LinhaConta) => !(ocultarZeradas && ehZerada(c)))
          return (
            <Fragment key={`g${l.codigo}`}>
              <button type="button" onClick={() => alternar(l.codigo)} aria-expanded={aberto}
                className="focus-ring flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 text-left">
                <span className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                  <span className={cn('inline-block w-3 text-slate-500 transition-transform', !aberto && '-rotate-90')} aria-hidden="true">▾</span>
                  {l.nome}
                </span>
                <span className="flex flex-col items-end">
                  <span className="font-bold tabular-nums text-slate-900">{brl(l.realizado)}</span>
                  <span className="text-[13px]"><Diferenca l={l} /></span>
                </span>
              </button>
              {aberto && contas.map(c => (
                <div key={c.codigo} className="flex min-h-12 items-center justify-between gap-3 border-t border-slate-100 py-2 pl-10 pr-4 text-sm text-slate-700">
                  <span>{c.nome}</span>
                  <span className="tabular-nums">{brl(c.realizado)}</span>
                </div>
              ))}
            </Fragment>
          )
        })}
      </div>
    </>
  )
}
