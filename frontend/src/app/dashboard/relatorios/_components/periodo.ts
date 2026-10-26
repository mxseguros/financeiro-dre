import { somarDias, type FiltroPeriodo } from '@/contexts/PeriodoContext'
import type { PeriodoRel, PeriodoRelativo } from './pivot'

/**
 * Período de um relatório salvo. "Seguir o seletor" usa o mesmo filtro das
 * outras telas; um período relativo ("últimos 3 meses") se atualiza sozinho a
 * cada mês; "fixo" guarda as datas. Sempre pela Data de Pagamento, como as
 * demais telas operacionais.
 */
export const PERIODOS_RELATIVOS: [PeriodoRelativo, string][] = [
  ['mes_atual', 'Mês atual'],
  ['mes_anterior', 'Mês anterior'],
  ['ultimos_3', 'Últimos 3 meses'],
  ['ultimos_6', 'Últimos 6 meses'],
  ['ultimos_12', 'Últimos 12 meses'],
  ['ano_atual', 'Ano atual'],
  ['ano_anterior', 'Ano anterior'],
]

const mm = (n: number) => String(n).padStart(2, '0')
const ultimoDia = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Primeiro dia do mês `n` meses depois de (ano, mes); mes de 1 a 12. */
function mesDeslocado(ano: number, mes: number, n: number): [number, number] {
  const i = ano * 12 + (mes - 1) + n
  return [Math.floor(i / 12), (i % 12) + 1]
}

function intervaloMeses(ano: number, mes: number, voltar: number): [string, string] {
  const [ai, mi] = mesDeslocado(ano, mes, -voltar)
  return [`${ai}-${mm(mi)}-01`, `${ano}-${mm(mes)}-${ultimoDia(ano, mes)}`]
}

export function datasRelativas(rel: PeriodoRelativo, hoje = new Date()): [string, string] {
  const [y, m] = [hoje.getFullYear(), hoje.getMonth() + 1]
  switch (rel) {
    case 'mes_atual': return intervaloMeses(y, m, 0)
    case 'mes_anterior': { const [ya, ma] = mesDeslocado(y, m, -1); return intervaloMeses(ya, ma, 0) }
    case 'ultimos_3': return intervaloMeses(y, m, 2)
    case 'ultimos_6': return intervaloMeses(y, m, 5)
    case 'ultimos_12': return intervaloMeses(y, m, 11)
    case 'ano_atual': return [`${y}-01-01`, `${y}-12-31`]
    case 'ano_anterior': return [`${y - 1}-01-01`, `${y - 1}-12-31`]
  }
}

function rotuloIntervalo(inicio: string, fim: string): string {
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const mesesInteiros = inicio.endsWith('-01') && Number(fim.slice(8, 10)) === ultimoDia(Number(fim.slice(0, 4)), Number(fim.slice(5, 7)))
  if (!mesesInteiros) return inicio === fim ? br(inicio) : `${br(inicio)} a ${br(fim)}`
  const rot = (d: string) => `${MES[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`
  if (inicio.slice(5, 7) === '01' && fim.slice(5, 7) === '12' && inicio.slice(0, 4) === fim.slice(0, 4)) return inicio.slice(0, 4)
  return inicio.slice(0, 7) === fim.slice(0, 7) ? rot(inicio) : `${rot(inicio)} a ${rot(fim)}`
}

function filtro(inicio: string, fim: string, rotulo: string): FiltroPeriodo {
  return { inicio, fim, base: 'pagamento', rotulo, qs: `inicio=${inicio}&fim=${fim}&base=pagamento` }
}

/** Filtro de datas do relatório: o da tela, um relativo ou o fixo salvo. */
export function filtroDoRelatorio(p: PeriodoRel | undefined, daTela: FiltroPeriodo, hoje = new Date()): FiltroPeriodo {
  if (!p || p.modo === 'tela') return daTela
  if (p.modo === 'fixo') return filtro(p.inicio, p.fim, rotuloIntervalo(p.inicio, p.fim))
  const [i, f] = datasRelativas(p.rel, hoje)
  const nome = PERIODOS_RELATIVOS.find(r => r[0] === p.rel)?.[1] ?? ''
  return filtro(i, f, `${nome} (${rotuloIntervalo(i, f)})`)
}

/**
 * Período imediatamente anterior, de mesma duração. Meses inteiros voltam em
 * meses (out → set; jan–mar → out–dez); intervalos de dias voltam em dias.
 */
export function periodoAnterior(f: FiltroPeriodo): FiltroPeriodo {
  const [yi, mi] = [Number(f.inicio.slice(0, 4)), Number(f.inicio.slice(5, 7))]
  const [yf, mf] = [Number(f.fim.slice(0, 4)), Number(f.fim.slice(5, 7))]
  const mesesInteiros = f.inicio.endsWith('-01') && Number(f.fim.slice(8, 10)) === ultimoDia(yf, mf)
  let inicio: string, fim: string
  if (mesesInteiros) {
    const meses = (yf - yi) * 12 + (mf - mi) + 1
    const [ya, ma] = mesDeslocado(yi, mi, -meses)
    const [yb, mb] = mesDeslocado(yi, mi, -1)
    inicio = `${ya}-${mm(ma)}-01`
    fim = `${yb}-${mm(mb)}-${ultimoDia(yb, mb)}`
  } else {
    const dias = Math.round((new Date(f.fim + 'T12:00:00').getTime() - new Date(f.inicio + 'T12:00:00').getTime()) / 86_400_000) + 1
    fim = somarDias(f.inicio, -1)
    inicio = somarDias(fim, -(dias - 1))
  }
  return filtro(inicio, fim, rotuloIntervalo(inicio, fim))
}
