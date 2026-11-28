'use client'
import { useState } from 'react'
import { cn, fmtBRL, fmtData } from '@/lib/utils'
import type { Classificacao } from './shared'
import { classificacoesDe } from './shared'

/**
 * Peças do novo layout dos modais de Despesa e Receita (canvas "Modal de
 * Despesa · MX DRE-IA", 28/11/2026): blocos numerados (o quê, quanto e quando,
 * onde, pagamento/recebimento), resumo lateral, checklist e rodapé fixo.
 * Despesa usa azul/marinho; receita, verde.
 */

export type Tema = 'despesa' | 'receita'

const TEMA = {
  despesa: {
    numero: 'bg-indigo-100 text-indigo-800',
    sel: 'border-2 border-blue-700 bg-blue-50 font-semibold text-blue-900',
    resumo: 'bg-slate-900', resumoSub: 'text-slate-300', resumoLinha: 'bg-slate-700', resumoValor: 'text-white',
    link: 'text-blue-700',
  },
  receita: {
    numero: 'bg-green-100 text-green-800',
    sel: 'border-2 border-green-600 bg-green-50 font-semibold text-green-900',
    resumo: 'bg-green-900', resumoSub: 'text-green-200', resumoLinha: 'bg-green-800', resumoValor: 'text-green-50',
    link: 'text-green-700',
  },
} as const

export const temaDe = (t: Tema) => TEMA[t]

/** Classe dos controles do novo layout: 44 px, cantos de 10 px. */
export function campoCls(invalido?: boolean, extra?: string) {
  return cn(
    'h-11 w-full rounded-[10px] border bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400',
    'focus-ring focus:outline-none disabled:cursor-not-allowed disabled:border-dashed disabled:bg-slate-100 disabled:text-slate-400',
    invalido ? 'border-red-400' : 'border-slate-300',
    extra,
  )
}

export function Secao({ n, titulo, tema, extra, children }: {
  n?: number; titulo: string; tema: Tema; extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {n != null && (
            <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', TEMA[tema].numero)}>{n}</span>
          )}
          <h3 className="text-[15px] font-semibold text-slate-900">{titulo}</h3>
        </div>
        {extra}
      </div>
      {children}
    </section>
  )
}

/** Rótulo + controle + erro/dica, com `htmlFor`. */
export function Campo({ id, rotulo, obrigatorio, erro, dica, desabilitado, className, children }: {
  id: string; rotulo: string; obrigatorio?: boolean; erro?: string; dica?: React.ReactNode
  desabilitado?: boolean; className?: string; children: React.ReactNode
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-[13px] font-semibold', desabilitado ? 'text-slate-400' : 'text-slate-700')}>
        {rotulo}{obrigatorio && <span aria-hidden="true"> *</span>}
        {obrigatorio && <span className="sr-only"> (obrigatório)</span>}
      </label>
      {children}
      {erro
        ? <span id={`${id}-erro`} role="alert" className="text-xs text-red-600">{erro}</span>
        : dica && <span className="text-xs text-slate-500">{dica}</span>}
    </div>
  )
}

/** Escolha única em botões (banco, forma…). */
export function EscolhaBotoes<T extends string>({ rotulo, opcoes, valor, onChange, tema, colunas = 2 }: {
  rotulo: string
  opcoes: { valor: T; texto: string; ponto?: string }[]
  valor: T
  onChange: (v: T) => void
  tema: Tema
  colunas?: 2 | 3 | 4
}) {
  const grade = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[colunas]
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-slate-700">{rotulo}</span>
      <div role="radiogroup" aria-label={rotulo} className={cn('grid gap-2', grade)}>
        {opcoes.map(o => {
          const ativo = o.valor === valor
          return (
            <button key={o.valor || 'vazio'} type="button" role="radio" aria-checked={ativo} onClick={() => onChange(o.valor)}
              className={cn('focus-ring flex h-11 min-w-0 items-center justify-center gap-2 rounded-[10px] px-2 text-sm transition-colors',
                ativo ? TEMA[tema].sel : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              {o.ponto && <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: o.ponto }} />}
              <span className="truncate">{o.texto}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Cor do quadradinho do banco (Itaú/Santander); os demais sem cor. */
export function corBanco(nome: string): string | undefined {
  const n = nome.toLowerCase()
  if (n.includes('ita')) return '#ec7000'
  if (n.includes('santander')) return '#cc0000'
  if (n.includes('sicredi')) return '#3fa110'
  return undefined
}

/** Nº de parcelas: − / campo digitável / +. */
export function ContadorParcelas({ id, valor, onChange, max, invalido }: {
  id: string; valor: string; onChange: (v: string) => void; max: number; invalido?: boolean
}) {
  const n = parseInt(valor) || 1
  const mudar = (d: number) => onChange(String(Math.min(max, Math.max(1, n + d))))
  return (
    <div className={cn('flex h-11 items-center overflow-hidden rounded-[10px] border bg-white', invalido ? 'border-red-400' : 'border-slate-300')}>
      <button type="button" aria-label="Diminuir parcelas" onClick={() => mudar(-1)} disabled={n <= 1}
        className="focus-ring h-11 w-11 shrink-0 border-r border-slate-200 bg-slate-50 text-lg text-slate-700 disabled:opacity-40">−</button>
      <input id={id} type="text" inputMode="numeric" value={valor} aria-label="Número de parcelas"
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onBlur={() => { if (!valor) onChange('1') }}
        className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-[15px] font-semibold tabular-nums text-slate-900 focus:outline-none" />
      <span aria-hidden="true" className="-ml-3 pr-3 text-[15px] font-semibold text-slate-900">x</span>
      <button type="button" aria-label="Aumentar parcelas" onClick={() => mudar(1)} disabled={n >= max}
        className="focus-ring h-11 w-11 shrink-0 border-l border-slate-200 bg-slate-50 text-lg text-slate-700 disabled:opacity-40">+</button>
    </div>
  )
}

/** Interruptor numa caixa com título e explicação. */
export function CaixaInterruptor({ id, titulo, dica, ligado, onChange, disabled, children }: {
  id: string; titulo: string; dica?: string; ligado: boolean; onChange: (v: boolean) => void
  disabled?: boolean; children?: React.ReactNode
}) {
  return (
    <div className="rounded-[10px] border border-slate-200">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <label htmlFor={id} className={cn('min-w-0 cursor-pointer', disabled && 'opacity-60')}>
          <span className="block text-sm font-semibold text-slate-900">{titulo}</span>
          {dica && <span className="block text-xs text-slate-500">{dica}</span>}
        </label>
        <button id={id} type="button" role="switch" aria-checked={ligado} disabled={disabled} onClick={() => onChange(!ligado)}
          className="focus-ring flex h-11 w-12 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50">
          <span className={cn('relative block h-[26px] w-11 rounded-full transition-colors', ligado ? 'bg-navy' : 'bg-slate-300')}>
            <span className={cn('absolute top-[3px] block h-5 w-5 rounded-full bg-white shadow transition-transform', ligado ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
          </span>
          <span className="sr-only">{ligado ? 'ligado' : 'desligado'}</span>
        </button>
      </div>
      {ligado && children && <div className="border-t border-slate-100 px-3.5 pb-3.5 pt-3">{children}</div>}
    </div>
  )
}

const COR_CLASSIF: Record<string, string> = {
  fixo: 'bg-sky-100 text-sky-800',
  variavel: 'bg-violet-100 text-violet-800',
  imposto: 'bg-amber-100 text-amber-900',
  nao_operacional: 'bg-slate-200 text-slate-700',
}

/**
 * Classificação do lançamento (0040): selo com a que veio do subitem e
 * "alterar" para trocar só neste lançamento (decisão de 28/11/2026).
 */
export function SeloClassificacao({ id, valor, padraoSubitem, onChange, classificacoes, natureza }: {
  id: string
  valor: string
  /** Classificação padrão do subitem escolhido. */
  padraoSubitem?: string | null
  onChange: (v: string) => void
  classificacoes?: Classificacao[]
  natureza: Tema
}) {
  const [editando, setEditando] = useState(false)
  const opcoes = classificacoesDe(classificacoes, natureza, valor)
  const atual = opcoes.find(c => c.codigo === valor)
  if (editando) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-[13px] font-semibold text-slate-700">Classificação</label>
        <select id={id} value={valor} autoFocus onChange={e => { onChange(e.target.value); setEditando(false) }}
          onBlur={() => setEditando(false)} className={campoCls(false, 'h-9 w-auto min-w-[160px]')}>
          <option value="">Sem classificação</option>
          {opcoes.map(c => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
        </select>
      </div>
    )
  }
  const herdada = !!valor && valor === padraoSubitem
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
      {atual
        ? <span className={cn('rounded-full px-2.5 py-0.5 font-semibold', COR_CLASSIF[atual.codigo] ?? 'bg-slate-100 text-slate-700')}>{atual.nome}</span>
        : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-600">Sem classificação</span>}
      <span>{!valor ? 'Aparece ao escolher o subitem.' : herdada ? 'Classificação do subitem.' : 'Definida neste lançamento.'}</span>
      <button type="button" onClick={() => setEditando(true)} className="focus-ring rounded px-1 font-semibold text-blue-700 hover:underline">
        alterar
      </button>
    </div>
  )
}

/** Cartão escuro do resumo (lateral no desktop). */
export function ResumoValor({ tema, rotulo, valor, sub, linhas }: {
  tema: Tema; rotulo: string; valor: number | null; sub: string; linhas: [string, string][]
}) {
  const t = TEMA[tema]
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl p-5 text-white', t.resumo)}>
      <span className={cn('text-xs font-semibold uppercase tracking-wider', t.resumoSub)}>{rotulo}</span>
      <span className={cn('text-[28px] font-bold leading-tight tabular-nums', t.resumoValor)}>{valor ? fmtBRL(valor) : 'R$ —'}</span>
      <span className={cn('text-[13px]', t.resumoSub)}>{sub}</span>
      <div className={cn('h-px', t.resumoLinha)} />
      <dl className="flex flex-col gap-2 text-[13px]">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className={t.resumoSub}>{k}</dt>
            <dd className="truncate text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Faixa do resumo no celular (o cartão lateral some). */
export function ResumoFaixa({ tema, rotulo, valor, detalhe }: { tema: Tema; rotulo: string; valor: number | null; detalhe: string }) {
  const t = TEMA[tema]
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-3 text-white lg:hidden', t.resumo)}>
      <div className="flex min-w-0 flex-col">
        <span className={cn('text-[11px] font-semibold uppercase tracking-wider', t.resumoSub)}>{rotulo}</span>
        <span className="text-xl font-bold tabular-nums">{valor ? fmtBRL(valor) : 'R$ —'}</span>
      </div>
      <span className={cn('text-right text-xs', t.resumoSub)}>{detalhe}</span>
    </div>
  )
}

export type EstadoItem = 'ok' | 'falta' | 'alerta' | 'opcional'

export function Checklist({ titulo, itens, rodape }: { titulo: string; itens: { texto: string; estado: EstadoItem }[]; rodape?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5">
      <span className="text-sm font-semibold text-slate-900">{titulo}</span>
      <ul className="flex flex-col gap-2.5 text-[13px]">
        {itens.map(i => (
          <li key={i.texto} className="flex items-center gap-2.5">
            <IconeEstado estado={i.estado} />
            <span className={cn(i.estado === 'alerta' && 'font-semibold text-amber-800', i.estado === 'opcional' && 'text-slate-500',
              i.estado === 'falta' && 'text-slate-700', i.estado === 'ok' && 'text-slate-800')}>
              {i.texto}
            </span>
            <span className="sr-only">{{ ok: '(ok)', falta: '(falta)', alerta: '(falta)', opcional: '(opcional)' }[i.estado]}</span>
          </li>
        ))}
      </ul>
      {rodape && <><div className="h-px bg-slate-200" /><div className="text-xs text-slate-500">{rodape}</div></>}
    </div>
  )
}

function IconeEstado({ estado }: { estado: EstadoItem }) {
  if (estado === 'ok') return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
  )
  if (estado === 'alerta') return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>
  )
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
  )
}

export function Historico({ criado, atualizado }: { criado?: string | null; atualizado?: string | null }) {
  if (!criado && !atualizado) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs text-slate-500">
      <span className="text-[13px] font-semibold text-slate-700">Histórico</span>
      {criado && <span>Criado em {fmtData(criado)}</span>}
      {atualizado && atualizado !== criado && <span>Última edição em {fmtData(atualizado)}</span>}
    </div>
  )
}

/** Ctrl/⌘ + Enter salva (o rodapé mostra a dica). */
export function atalhoSalvar(e: React.KeyboardEvent, salvar: () => void) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); salvar() }
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** '2026-11' → 'nov/2026'. */
export const mesAno = (m: string) => (m ? `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}` : '—')
