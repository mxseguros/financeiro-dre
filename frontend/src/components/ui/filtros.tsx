'use client'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Padrão único dos filtros de todas as telas (22/10/2026): mesma altura
 * (32px), fonte 12px, cantos, borda e sombra. Usar estas classes em vez de
 * montar estilo à mão em cada página.
 */
export const FILTRO_CAMPO =
  'h-8 rounded-md border border-gray-200 bg-white px-2.5 text-xs text-gray-700 shadow-sm focus-ring focus:outline-none disabled:bg-gray-50 disabled:text-gray-400'
export const FILTRO_BOTAO =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 focus-ring disabled:opacity-50'
export const FILTRO_GRUPO =
  'inline-flex h-8 items-center rounded-md border border-gray-200 bg-white p-0.5 shadow-sm'
export const filtroSegmento = (ativo: boolean) => cn(
  'h-full rounded px-2.5 text-xs font-medium transition-colors focus-ring',
  ativo ? 'bg-navy text-white' : 'text-gray-600 hover:bg-gray-50',
)
/** Filtro com valor escolhido: destaca a borda e o texto. */
export const filtroAtivo = (ativo: boolean) => (ativo ? 'border-navy font-medium text-navy' : '')

export const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
/** 'YYYY-MM' → 'Out 2026'. */
export const rotuloMesAbrev = (m: string) => `${MESES_ABREV[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`

/**
 * Seletor de mês compacto: o botão mostra "Out 2026" (o campo nativo do
 * navegador escrevia "outubro de 2026" e não cabia na linha). Abre uma grade
 * com os 12 meses e setas para o ano.
 *   valor: 'YYYY-MM' · min: meses anteriores ficam desabilitados ·
 *   semDados(mes): esmaece o mês (ex.: DRE sem realizado) sem impedir a escolha.
 */
export function SeletorMes({ valor, onChange, min, semDados, rotulo = 'Mês', className, dataTour }: {
  valor: string
  onChange: (mes: string) => void
  min?: string
  semDados?: (mes: string) => boolean
  rotulo?: string
  className?: string
  dataTour?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [ano, setAno] = useState(Number(valor.slice(0, 4)))
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => { if (aberto) setAno(Number(valor.slice(0, 4))) }, [aberto, valor])
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAberto(false) } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc, true) }
  }, [aberto])

  return (
    <div ref={caixa} className="relative" data-tour={dataTour}>
      <button type="button" aria-label={`${rotulo}: ${rotuloMesAbrev(valor)}`} aria-haspopup="dialog" aria-expanded={aberto}
        onClick={() => setAberto(v => !v)}
        className={cn(FILTRO_CAMPO, 'inline-flex min-w-[5.75rem] items-center justify-between gap-1.5 font-medium tabular-nums', className)}>
        {rotuloMesAbrev(valor)}
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-gray-400" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {aberto && (
        <div role="dialog" aria-label={`Escolher ${rotulo.toLowerCase()}`}
          className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-2.5 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setAno(a => a - 1)} aria-label="Ano anterior"
              className="rounded px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-100">‹</button>
            <span className="text-xs font-semibold text-navy">{ano}</span>
            <button type="button" onClick={() => setAno(a => a + 1)} aria-label="Próximo ano"
              className="rounded px-2 py-0.5 text-sm text-gray-500 hover:bg-gray-100">›</button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MESES_ABREV.map((nome, i) => {
              const m = `${ano}-${String(i + 1).padStart(2, '0')}`
              const escolhido = m === valor
              const bloqueado = !!min && m < min
              const vazio = semDados?.(m)
              return (
                <button key={m} type="button" disabled={bloqueado}
                  onClick={() => { onChange(m); setAberto(false) }}
                  title={vazio ? 'Sem lançamentos realizados' : undefined}
                  className={cn('rounded-md py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                    escolhido ? 'bg-navy font-semibold text-white' : vazio ? 'text-gray-400 hover:bg-gray-50' : 'text-gray-700 hover:bg-gray-100')}>
                  {nome}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
