'use client'
import { createContext, useCallback, useContext, useState } from 'react'
import { mesAtual } from '@/lib/utils'

/**
 * Período selecionado, compartilhado por todas as telas do dashboard.
 *
 * Regra (pedido de 29/09/2026): ao entrar no sistema começa no mês atual;
 * depois que o usuário escolhe, a escolha acompanha a navegação entre telas
 * até uma nova seleção. Por isso o estado vive no layout do dashboard (que não
 * desmonta ao trocar de página) e é espelhado no sessionStorage, para
 * sobreviver a um F5 — mas não a um novo login nem a uma aba nova.
 *
 * Desde 22/10/2026 o filtro tem modo Dia | Mês | Ano | Período, e TODOS
 * filtram pela Data de Pagamento/Recebimento (`base=pagamento` na API); o que
 * ainda está em aberto entra pelo vencimento. A DRE e as Metas não usam esta
 * base: seguem por competência.
 * Meses em 'YYYY-MM', dia em 'YYYY-MM-DD', ano em 'YYYY'. A DRE continua lendo
 * `mesInicio`, que acompanha o dia/ano escolhidos.
 */
export const CHAVE_PERIODO = 'dre.periodo'
const CHAVE_V2 = 'dre.periodo.v2'

export type ModoPeriodo = 'dia' | 'mes' | 'ano' | 'periodo'

interface Estado {
  modo: ModoPeriodo
  dia: string
  ano: string
  mesInicio: string
  mesFim: string
  de: string          // modo Período: YYYY-MM-DD
  ate: string
}

interface PeriodoValor extends Estado {
  definirModo: (m: ModoPeriodo) => void
  definirDia: (dia: string) => void
  definirAno: (ano: string) => void
  definirPeriodo: (inicio: string, fim: string) => void
  definirMes: (mes: string) => void
  definirIntervalo: (de: string, ate: string) => void
}

const PeriodoContext = createContext<PeriodoValor | null>(null)

/** Maior intervalo do modo Período (a API recusa mais de 365 dias). */
export const MAX_DIAS = 365

/** 'YYYY-MM-DD' + n dias, sem fuso (meio-dia evita virada por horário de verão). */
export function somarDias(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ehMes = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}$/.test(v)
const ehDia = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const ehAno = (v: unknown): v is string => typeof v === 'string' && /^\d{4}$/.test(v)

function padrao(): Estado {
  const mes = mesAtual()[0].slice(0, 7)
  const d = new Date()
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { modo: 'mes', dia, ano: mes.slice(0, 4), mesInicio: mes, mesFim: mes, de: `${mes}-01`, ate: dia }
}

function inicial(): Estado {
  const base = padrao()
  try {
    const v2 = JSON.parse(window.sessionStorage.getItem(CHAVE_V2) ?? 'null')
    if (v2 && ['dia', 'mes', 'ano', 'periodo'].includes(v2.modo) && ehMes(v2.mesInicio) && ehMes(v2.mesFim)) {
      const intervaloOk = ehDia(v2.de) && ehDia(v2.ate)
      return {
        modo: v2.modo === 'periodo' && !intervaloOk ? 'mes' : v2.modo,
        dia: ehDia(v2.dia) ? v2.dia : base.dia,
        ano: ehAno(v2.ano) ? v2.ano : base.ano,
        mesInicio: v2.mesInicio,
        mesFim: v2.mesFim,
        de: intervaloOk ? v2.de : base.de,
        ate: intervaloOk ? v2.ate : base.ate,
      }
    }
    // Formato antigo (só meses), anterior a 22/10/2026.
    const v1 = JSON.parse(window.sessionStorage.getItem(CHAVE_PERIODO) ?? 'null')
    if (Array.isArray(v1) && ehMes(v1[0]) && ehMes(v1[1])) return { ...base, mesInicio: v1[0], mesFim: v1[1] }
  } catch { /* sem storage (aba privada, SSR): segue no mês atual */ }
  return base
}

export function limparPeriodoSalvo() {
  try {
    window.sessionStorage.removeItem(CHAVE_PERIODO)
    window.sessionStorage.removeItem(CHAVE_V2)
  } catch { /* idem */ }
}

export function PeriodoProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>(inicial)

  const atualizar = useCallback((mudar: (e: Estado) => Estado) => {
    setEstado(prev => {
      const novo = mudar(prev)
      try { window.sessionStorage.setItem(CHAVE_V2, JSON.stringify(novo)) } catch { /* idem */ }
      return novo
    })
  }, [])

  const definirModo = useCallback((modo: ModoPeriodo) => atualizar(e => ({ ...e, modo })), [atualizar])

  // Escolher um dia leva o mês junto (a DRE e o Mês continuam coerentes).
  const definirDia = useCallback((dia: string) => {
    if (!ehDia(dia)) return
    atualizar(e => ({ ...e, modo: 'dia', dia, ano: dia.slice(0, 4), mesInicio: dia.slice(0, 7), mesFim: dia.slice(0, 7) }))
  }, [atualizar])

  // Escolher um ano mantém o mês, trocando só o ano.
  const definirAno = useCallback((ano: string) => {
    if (!ehAno(ano)) return
    atualizar(e => ({ ...e, modo: 'ano', ano, mesInicio: `${ano}-${e.mesInicio.slice(5, 7)}`, mesFim: `${ano}-${e.mesFim.slice(5, 7)}` }))
  }, [atualizar])

  // Usado pelo modo Mês e pela DRE: não troca o modo — a DRE lê só o mês e
  // não deve tirar o usuário de Dia/Ano nas outras telas.
  const definirPeriodo = useCallback((inicio: string, fim: string) => {
    if (!ehMes(inicio) || !ehMes(fim)) return  // input limpo pelo usuário: mantém o anterior
    atualizar(e => ({ ...e, mesInicio: inicio, mesFim: fim }))
  }, [atualizar])

  const definirMes = useCallback((mes: string) => definirPeriodo(mes, mes), [definirPeriodo])

  // Período livre: datas em ordem e no máximo 12 meses (limite da API). O mês
  // acompanha o início, para a DRE e o modo Mês continuarem coerentes.
  const definirIntervalo = useCallback((de: string, ate: string) => {
    if (!ehDia(de) || !ehDia(ate)) return
    let [a, b] = de <= ate ? [de, ate] : [ate, de]
    const limite = somarDias(a, MAX_DIAS)
    if (b > limite) b = limite
    atualizar(e => ({ ...e, modo: 'periodo', de: a, ate: b, mesInicio: a.slice(0, 7), mesFim: b.slice(0, 7) }))
  }, [atualizar])

  return (
    <PeriodoContext.Provider value={{ ...estado, definirModo, definirDia, definirAno, definirPeriodo, definirMes, definirIntervalo }}>
      {children}
    </PeriodoContext.Provider>
  )
}

export function usePeriodo(): PeriodoValor {
  const ctx = useContext(PeriodoContext)
  if (!ctx) throw new Error('usePeriodo precisa estar dentro de <PeriodoProvider>')
  return ctx
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (m: string) => `${MES_CURTO[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`
const ultimoDia = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate()

export interface FiltroPeriodo {
  inicio: string                  // YYYY-MM-DD
  fim: string                     // YYYY-MM-DD
  base: 'pagamento'
  rotulo: string                  // ex.: "20/10/2026", "01/10/2026 a 22/10/2026", "out/2026", "2026"
  qs: string                      // "inicio=…&fim=…&base=…"
}

/**
 * Converte o período escolhido em datas para a API.
 * `intervaloMeses`: a tela usa De/Até (Lançamentos); nas demais o modo Mês é
 * um mês só (`mesInicio`).
 */
export function filtroDoPeriodo(p: Estado, intervaloMeses = false): FiltroPeriodo {
  let inicio: string, fim: string, rotulo: string
  const base: FiltroPeriodo['base'] = 'pagamento'
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
  if (p.modo === 'dia') {
    inicio = fim = p.dia
    rotulo = br(p.dia)
  } else if (p.modo === 'periodo') {
    inicio = p.de
    fim = p.ate
    rotulo = p.de === p.ate ? br(p.de) : `${br(p.de)} a ${br(p.ate)}`
  } else if (p.modo === 'ano') {
    inicio = `${p.ano}-01-01`
    fim = `${p.ano}-12-31`
    rotulo = p.ano
  } else {
    const mFim = intervaloMeses ? p.mesFim : p.mesInicio
    inicio = `${p.mesInicio}-01`
    fim = `${mFim}-${String(ultimoDia(mFim)).padStart(2, '0')}`
    rotulo = mFim === p.mesInicio ? rotuloMes(p.mesInicio) : `${rotuloMes(p.mesInicio)} a ${rotuloMes(mFim)}`
  }
  return { inicio, fim, base, rotulo, qs: `inicio=${inicio}&fim=${fim}&base=${base}` }
}
