import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtBRL(valor: number | string | null | undefined): string {
  if (valor == null || valor === '') return '—'
  const n = typeof valor === 'number' ? valor : Number(valor)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

/** Formata data ISO (YYYY-MM-DD) como dd/mm/aaaa. */
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export function fmtPct(valor: number | null | undefined): string {
  if (valor == null) return '—'
  return `${valor.toFixed(1).replace('.', ',')}%`
}

export function primeiroUltimoDia(ano: number, mes: number): [string, string] {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`
  const fim = new Date(ano, mes, 0)
  const fimStr = `${ano}-${String(mes).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`
  return [inicio, fimStr]
}

export function mesAnterior(): [string, string] {
  const hoje = new Date()
  const ano = hoje.getMonth() === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear()
  const mes = hoje.getMonth() === 0 ? 12 : hoje.getMonth()
  return primeiroUltimoDia(ano, mes)
}

export function mesAtual(): [string, string] {
  const hoje = new Date()
  return primeiroUltimoDia(hoje.getFullYear(), hoje.getMonth() + 1)
}

/**
 * Período de mesma duração (em meses) imediatamente anterior ao informado.
 * jul/26 → jun/26; jan–mar → out–dez do ano anterior.
 */
export function periodoAnterior(inicio: string, fim: string): [string, string] {
  const [yi, mi] = inicio.slice(0, 7).split('-').map(Number)
  const [yf, mf] = fim.slice(0, 7).split('-').map(Number)
  const meses = (yf - yi) * 12 + (mf - mi) + 1

  // Base 0 evita o caso de mês 0/13 ao voltar N meses.
  const idxFim = yi * 12 + (mi - 1) - 1
  const idxIni = idxFim - (meses - 1)
  const [anoIni, mesIni] = [Math.floor(idxIni / 12), (idxIni % 12) + 1]
  const [anoFim, mesFim] = [Math.floor(idxFim / 12), (idxFim % 12) + 1]

  return [primeiroUltimoDia(anoIni, mesIni)[0], primeiroUltimoDia(anoFim, mesFim)[1]]
}

export interface Variacao { abs: number | null; pct: number | null }

/**
 * Variação absoluta e percentual entre dois valores.
 *
 * `pct` é `null` quando a base é zero ou quando algum lado não veio — o perfil
 * `comercial` recebe `null` em várias linhas do DRE. A UI renderiza "—" nesses
 * casos; nunca `NaN%` nem `∞%`.
 */
export function variacao(atual: number | null | undefined, anterior: number | null | undefined): Variacao {
  if (atual == null || anterior == null || !Number.isFinite(atual) || !Number.isFinite(anterior)) {
    return { abs: null, pct: null }
  }
  const abs = atual - anterior
  return { abs, pct: anterior === 0 ? null : (abs / Math.abs(anterior)) * 100 }
}

/** Formata uma variação percentual com sinal: `+12,3%` / `−8,1%` / `—`. */
export function fmtDelta(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const sinal = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${sinal}${Math.abs(pct).toFixed(1).replace('.', ',')}%`
}
