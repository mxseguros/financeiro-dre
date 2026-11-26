'use client'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { brl, pct } from './formato'
import { ehZerada } from './DreTable'
import { MESES, type Linha, type LinhaValores } from './tipos'

/** Visão 12 meses: realizado por mês; previsto no tooltip da célula (plano §6.1). */
function Serie({ l, mesRef, rotulo }: { l: LinhaValores; mesRef: number; rotulo: string }) {
  return (
    <>
      {(l.por_mes ?? []).map(p => (
        <td key={p.mes} title={`${rotulo} · ${MESES[p.mes - 1]}: previsto ${brl(p.previsto)}`}
          className={cn('px-2.5 py-2 text-right tabular-nums', p.mes === mesRef && 'bg-sel-bg',
            p.realizado == null && 'text-slate-400')}>
          {brl(p.realizado)}
        </td>
      ))}
      <td className="px-2.5 py-2 text-right tabular-nums">{brl(l.media_mensal)}</td>
      <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{brl(l.acumulado)}</td>
      <td className="px-2.5 py-2 text-right tabular-nums text-slate-600">{pct(l.av)}</td>
    </>
  )
}

// Primeira coluna fixa: o fundo precisa ser opaco, senão os números passam por trás.
const fixa = 'sticky left-0 z-10 min-w-[220px] max-w-[260px] truncate'

export function DreMatrix({ linhas, mesRef, abertos, alternar, ocultarZeradas }: {
  linhas: Linha[]
  mesRef: number
  abertos: Set<string>
  alternar: (codigo: string) => void
  ocultarZeradas: boolean
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="bg-slate-50 text-[13px] text-slate-600">
            <th className={cn(fixa, 'border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-left font-semibold')}>Conta</th>
            {MESES.map((m, i) => (
              <th key={m} className={cn('border-b border-gray-100 px-2.5 py-2 text-right font-semibold', i + 1 === mesRef && 'bg-sel-bg text-sel-text')}>{m}</th>
            ))}
            {['Média', 'Acumulado', 'AV %'].map(h => (
              <th key={h} className="border-b border-gray-100 px-2.5 py-2 text-right font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => {
            if (l.tipo === 'secao') {
              return (
                <tr key={`s${l.codigo}`}>
                  <td className={cn(fixa, 'bg-white px-3 pb-1 pt-4 text-[13px] font-bold uppercase tracking-wide text-slate-600')}>
                    {l.codigo} · {l.nome}
                  </td>
                  <td colSpan={15} />
                </tr>
              )
            }
            if (l.tipo === 'resultado') {
              return (
                <tr key={`r${l.codigo}`} className="bg-slate-50 font-bold text-slate-900">
                  <td className={cn(fixa, 'bg-slate-50 px-3 py-2.5')} title={l.nome}>{l.codigo} · {l.nome}</td>
                  <Serie l={l} mesRef={mesRef} rotulo={l.nome} />
                </tr>
              )
            }
            const aberto = abertos.has(l.codigo)
            const contas = l.contas.filter(c => !(ocultarZeradas && ehZerada(c)))
            return (
              <Fragment key={`g${l.codigo}`}>
                <tr className="bg-gray-50 font-semibold text-gray-800">
                  <td className={cn(fixa, 'bg-gray-50 px-3 py-2')}>
                    <button type="button" onClick={() => alternar(l.codigo)} aria-expanded={aberto} title={l.nome}
                      className="focus-ring inline-flex min-h-11 max-w-full items-center gap-1.5 truncate rounded text-left">
                      <span className={cn('inline-block w-3 text-gray-400 transition-transform', !aberto && '-rotate-90')} aria-hidden="true">▾</span>
                      <span className="truncate">{l.codigo} · {l.nome}</span>
                    </button>
                  </td>
                  <Serie l={l} mesRef={mesRef} rotulo={l.nome} />
                </tr>
                {aberto && contas.map(c => (
                  <tr key={c.codigo} className="text-gray-600 [&>td]:border-b [&>td]:border-gray-100">
                    <td className={cn(fixa, 'bg-white py-1.5 pl-8 pr-3')} title={c.nome}>
                      {c.nome}
                    </td>
                    <Serie l={c} mesRef={mesRef} rotulo={c.nome} />
                  </tr>
                ))}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
