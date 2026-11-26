'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { MAX_DIAS, somarDias, usePeriodo, type ModoPeriodo } from '@/contexts/PeriodoContext'
import { FILTRO_CAMPO, FILTRO_GRUPO, SeletorMes, filtroSegmento } from './filtros'

const ANO_ATUAL = new Date().getFullYear()
const ANOS = Array.from({ length: 6 }, (_, i) => String(ANO_ATUAL - 3 + i))

const MODOS: [ModoPeriodo, string, string][] = [
  ['dia', 'Dia', 'Pela data de pagamento (em aberto, pelo vencimento)'],
  ['mes', 'Mês', 'Pela data de pagamento (em aberto, pelo vencimento)'],
  ['ano', 'Ano', 'Pela data de pagamento (em aberto, pelo vencimento), de janeiro a dezembro'],
  ['periodo', 'Período', 'De uma data até outra — pela data de pagamento (em aberto, pelo vencimento)'],
]

// Padrão único dos filtros (components/ui/filtros.tsx): 44px (48px no celular), fonte 14px.
const campoCls = FILTRO_CAMPO

const hojeISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const ultimoDiaMes = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()

/** Atalhos do modo Período: [rótulo, () => [de, até]]. */
function atalhos(): [string, () => [string, string]][] {
  const hoje = hojeISO()
  const [y, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))]
  const mm = (n: number) => String(n).padStart(2, '0')
  const [ya, ma] = m === 1 ? [y - 1, 12] : [y, m - 1]
  return [
    ['Hoje', () => [hoje, hoje]],
    ['Últimos 7 dias', () => [somarDias(hoje, -6), hoje]],
    ['Últimos 30 dias', () => [somarDias(hoje, -29), hoje]],
    ['Este mês', () => [`${y}-${mm(m)}-01`, `${y}-${mm(m)}-${ultimoDiaMes(y, m)}`]],
    ['Mês passado', () => [`${ya}-${mm(ma)}-01`, `${ya}-${mm(ma)}-${ultimoDiaMes(ya, ma)}`]],
    ['Este ano', () => [`${y}-01-01`, `${y}-12-31`]],
  ]
}

/**
 * Período livre num botão compacto: mostra "01/10/2026 – 22/10/2026" e abre um
 * painel com De/Até e atalhos. Só aplica no "Aplicar" (ou num atalho), para
 * não recarregar a tela a cada dígito digitado.
 */
function IntervaloDatas() {
  const p = usePeriodo()
  const [aberto, setAberto] = useState(false)
  const [de, setDe] = useState(p.de)
  const [ate, setAte] = useState(p.ate)
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => { if (aberto) { setDe(p.de); setAte(p.ate) } }, [aberto, p.de, p.ate])

  // Fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc, true) }
  }, [aberto])

  const [a, b] = de <= ate ? [de, ate] : [ate, de]
  const longoDemais = !!a && !!b && b > somarDias(a, MAX_DIAS)
  const valido = !!de && !!ate && !longoDemais

  function aplicar(d1 = de, d2 = ate) {
    p.definirIntervalo(d1, d2)
    setAberto(false)
  }

  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={() => setAberto(v => !v)} aria-expanded={aberto} aria-haspopup="dialog"
        className={cn(campoCls, 'inline-flex items-center gap-1.5 font-medium tabular-nums')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-gray-500" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        {p.de === p.ate ? br(p.de) : `${br(p.de)} – ${br(p.ate)}`}
      </button>

      {aberto && (
        <div role="dialog" aria-label="Escolher período"
          className="absolute right-0 z-30 mt-1 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[13px] font-medium text-slate-600">
              De
              <input type="date" value={de} onChange={e => setDe(e.target.value)} className={cn(campoCls, 'mt-0.5 w-full px-2')} />
            </label>
            <label className="text-[13px] font-medium text-slate-600">
              Até
              <input type="date" value={ate} min={de || undefined} onChange={e => setAte(e.target.value)} className={cn(campoCls, 'mt-0.5 w-full px-2')} />
            </label>
          </div>
          {longoDemais && <p className="mt-1.5 text-[13px] text-red-700">O período pode ter no máximo 12 meses.</p>}

          <div className="mt-2.5 flex flex-wrap gap-1">
            {atalhos().map(([rotulo, fn]) => (
              <button key={rotulo} type="button" onClick={() => { const [d1, d2] = fn(); aplicar(d1, d2) }}
                className="focus-ring h-10 rounded-lg bg-gray-100 px-3 text-[13px] text-slate-700 hover:bg-gray-200">
                {rotulo}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2.5">
            <span className="text-[13px] leading-tight text-slate-600">Pela data de pagamento;<br />em aberto, pelo vencimento</span>
            <button type="button" disabled={!valido} onClick={() => aplicar()}
              className="focus-ring h-11 rounded-lg bg-navy px-4 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50">
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 'YYYY-MM' + n meses. */
function somarMeses(mes: string, n: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

const setaCls = 'focus-ring inline-flex h-12 w-12 md:h-11 md:w-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-lg text-slate-700 shadow-sm hover:bg-gray-50'

/**
 * Filtro de período Dia | Mês | Ano | Período, ligado ao PeriodoContext (o
 * mesmo período em todas as telas). `intervaloMeses` mostra De/Até no modo Mês.
 * Desde o redesenho (25/11/2026) fica na barra do topo; no modo Mês simples
 * tem setas ‹ › para o mês anterior e o seguinte.
 */
export function SeletorPeriodo({ intervaloMeses = false, className }: { intervaloMeses?: boolean; className?: string }) {
  const p = usePeriodo()

  return (
    <div data-tour="periodo" className={cn('flex flex-wrap items-center gap-2 text-sm text-slate-600', className)}>
      <div role="group" aria-label="Filtrar por" className={FILTRO_GRUPO}>
        {MODOS.map(([m, rotulo, dica]) => (
          <button key={m} type="button" title={dica} aria-pressed={p.modo === m}
            onClick={() => p.definirModo(m)}
            className={filtroSegmento(p.modo === m)}>
            {rotulo}
          </button>
        ))}
      </div>

      {p.modo === 'dia' && (
        <input type="date" aria-label="Dia" value={p.dia} onChange={e => p.definirDia(e.target.value)} className={cn(campoCls, 'w-[8.25rem]')} />
      )}

      {p.modo === 'mes' && (intervaloMeses ? (
        <>
          <span className="shrink-0">De</span>
          <SeletorMes rotulo="Mês inicial" valor={p.mesInicio}
            onChange={v => p.definirPeriodo(v, v > p.mesFim ? v : p.mesFim)} />
          <span className="shrink-0">até</span>
          <SeletorMes rotulo="Mês final" valor={p.mesFim} min={p.mesInicio}
            onChange={v => p.definirPeriodo(p.mesInicio, v < p.mesInicio ? p.mesInicio : v)} />
        </>
      ) : (
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Mês anterior" onClick={() => p.definirMes(somarMeses(p.mesInicio, -1))} className={setaCls}>‹</button>
          <SeletorMes rotulo="Mês" valor={p.mesInicio} onChange={p.definirMes} />
          <button type="button" aria-label="Próximo mês" onClick={() => p.definirMes(somarMeses(p.mesInicio, 1))} className={setaCls}>›</button>
        </div>
      ))}

      {p.modo === 'ano' && (
        <select aria-label="Ano" value={p.ano} onChange={e => p.definirAno(e.target.value)} className={campoCls}>
          {(ANOS.includes(p.ano) ? ANOS : [p.ano, ...ANOS]).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      {p.modo === 'periodo' && <IntervaloDatas />}
    </div>
  )
}
