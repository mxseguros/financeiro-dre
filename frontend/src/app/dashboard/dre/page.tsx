'use client'
import { FILTRO_BOTAO, FILTRO_GRUPO, SeletorMes, filtroSegmento } from '@/components/ui/filtros'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePeriodo } from '@/contexts/PeriodoContext'
import { useTopBar } from '@/contexts/TopBarContext'
import { Skeleton } from '@/components/ui/Skeleton'
import { DreKpis } from '@/components/dre/DreKpis'
import { DreTable } from '@/components/dre/DreTable'
import { DreMatrix } from '@/components/dre/DreMatrix'
import { ResultadoMensalChart } from '@/components/dre/ResultadoMensalChart'
import { AnaliseVertical } from '@/components/dre/AnaliseVertical'
import { PontoEquilibrio } from '@/components/dre/PontoEquilibrio'
import { brl } from '@/components/dre/formato'
import { MESES, MESES_LONGOS, type DreResposta, type Visao } from '@/components/dre/tipos'

const VISOES: [Visao, string, string][] = [['mes', 'Mês', 'Mês'], ['acumulado', 'Acumulado no ano', 'Acumulado'], ['anual', '12 meses', '12 meses']]
// Grupos que a pessoa fechou: lembrados na sessão (os demais abrem, regra de 22/10/2026).
const CHAVE_FECHADOS = 'dre.grupos.fechados'
const ANO_ATUAL = new Date().getFullYear()
const setaCls = 'focus-ring inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-lg text-slate-700 shadow-sm hover:bg-gray-50 md:h-11 md:w-11'
const ANOS = Array.from({ length: 6 }, (_, i) => ANO_ATUAL - 2 + i)

export default function DrePage() {
  const { token } = useAuth()
  // Mês de referência vem do período compartilhado entre telas.
  const { mesInicio, definirMes } = usePeriodo()
  const ano = Number(mesInicio.slice(0, 4))
  const mes = Number(mesInicio.slice(5, 7))
  const escolher = (a: number, m: number) => definirMes(`${a}-${String(m).padStart(2, '0')}`)
  const passarMes = (n: number) => {
    const t = ano * 12 + (mes - 1) + n
    escolher(Math.floor(t / 12), (t % 12) + 1)
  }

  const [visao, setVisao] = useState<Visao>('mes')
  const [dados, setDados] = useState<DreResposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  // Troca de visão instantânea ao voltar para um recorte já visto (meta < 300 ms).
  const cache = useRef(new Map<string, DreResposta>())

  const buscar = useCallback(() => {
    if (!token) return
    const chave = `${ano}-${mes}-${visao}`
    const emCache = cache.current.get(chave)
    if (emCache) { setDados(emCache); setCarregando(false); setErro(null); return }
    setCarregando(true)
    setErro(null)
    api.get<DreResposta>(`/dre/previsto-realizado?ano=${ano}&mes=${mes}&visao=${visao}`, token)
      .then(d => { cache.current.set(chave, d); setDados(d) })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [token, ano, mes, visao])

  useEffect(() => { buscar() }, [buscar])

  const todosGrupos = dados?.linhas.filter(l => l.tipo === 'grupo').map(l => l.codigo) ?? []
  const tudoAberto = todosGrupos.length > 0 && todosGrupos.every(c => abertos.has(c))
  // Grupos abertos por padrão (pedido de 22/10/2026); os que a pessoa fecha
  // ficam fechados enquanto a sessão durar (redesenho UX, fase 5).
  const lerFechados = () => {
    try { return new Set<string>(JSON.parse(window.sessionStorage.getItem(CHAVE_FECHADOS) ?? '[]')) } catch { return new Set<string>() }
  }
  const gravarFechados = (abertosAgora: Set<string>) => {
    try {
      window.sessionStorage.setItem(CHAVE_FECHADOS, JSON.stringify(todosGrupos.filter(c => !abertosAgora.has(c))))
    } catch { /* sem storage: só não lembra */ }
  }
  const definirAbertos = (n: Set<string>) => { setAbertos(n); gravarFechados(n) }
  const alternar = (codigo: string) => {
    const n = new Set(abertos)
    if (n.has(codigo)) n.delete(codigo); else n.add(codigo)
    definirAbertos(n)
  }
  const chaveGrupos = todosGrupos.join('|')
  useEffect(() => {
    if (!chaveGrupos) return
    const fechados = lerFechados()
    setAbertos(new Set(chaveGrupos.split('|').filter(c => !fechados.has(c))))
  }, [chaveGrupos, dados])

  const comReal = new Set(dados?.meses_com_realizado ?? [])
  const ultimo = dados?.ultimo_mes_realizado
  const recorte = visao === 'mes' ? `${MESES_LONGOS[mes - 1]} ${ano}`
    : visao === 'acumulado' ? `Jan–${MESES[mes - 1]} ${ano}` : `${ano}`

  const subtitulo = `Previsto x Realizado · ${ano}`
    + (dados ? (ultimo ? ` · realizado lançado até ${MESES_LONGOS[ultimo - 1].toLowerCase()}` : ' · sem realizado lançado') : '')
  useTopBar({ subtitulo }, [subtitulo])

  return (
    <div className="flex flex-col gap-4">
      {/* Controles: mês de referência com setas, visão e metas */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <span className="hidden text-[13px] font-semibold text-slate-700 md:inline">Mês de referência</span>
        <div data-tour="periodo" className="flex items-center gap-1">
          <button type="button" aria-label="Mês anterior" onClick={() => passarMes(-1)} className={setaCls}>‹</button>
          {/* Mês de referência (ano incluso) no padrão dos filtros: "Out 2026". */}
          <SeletorMes rotulo="Mês de referência" valor={`${ano}-${String(mes).padStart(2, '0')}`}
            onChange={m => escolher(Number(m.slice(0, 4)), Number(m.slice(5, 7)))}
            semDados={m => !!dados && Number(m.slice(0, 4)) === ano && !comReal.has(Number(m.slice(5, 7)))} />
          <button type="button" aria-label="Próximo mês" onClick={() => passarMes(1)} className={setaCls}>›</button>
        </div>
        <div data-tour="visao" role="group" aria-label="Visão" className={cn(FILTRO_GRUPO, 'w-full md:w-auto')}>
          {VISOES.map(([v, rotulo, curto]) => (
            <button key={v} type="button" onClick={() => setVisao(v)} aria-pressed={visao === v}
              className={cn(filtroSegmento(visao === v), 'flex-1 md:flex-none')}>
              <span className="md:hidden">{curto}</span><span className="hidden md:inline">{rotulo}</span>
            </button>
          ))}
        </div>
        <span className="hidden flex-1 md:block" />
        <Link data-tour="metas" href="/dashboard/dre/metas" className={cn(FILTRO_BOTAO, 'font-semibold text-slate-900')}>
          Editar metas (Previsto)
        </Link>
      </div>

      {erro && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{erro}</div>}

      {!erro && dados && (
        <>
          {(dados.pendentes.qtd > 0 || dados.nao_classificado.qtd > 0) && (
            <div className="flex flex-col gap-2.5 md:flex-row">
              {dados.pendentes.qtd > 0 && (
                <Link href="/dashboard/lancamentos/aprovacoes"
                  className="focus-ring flex min-h-12 flex-1 items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100 md:min-h-11">
                  <span><b>{dados.pendentes.qtd} lançamento{dados.pendentes.qtd > 1 ? 's' : ''}</b> do realizado aguarda{dados.pendentes.qtd > 1 ? 'm' : ''} aprovação ({brl(dados.pendentes.valor)})</span>
                  <span className="shrink-0 font-bold">Ver aprovações</span>
                </Link>
              )}
              {dados.nao_classificado.qtd > 0 && (
                <Link href="/dashboard/lancamentos"
                  className="focus-ring flex min-h-12 flex-1 items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 hover:bg-amber-100 md:min-h-11">
                  <span><b>{dados.nao_classificado.qtd} lançamento{dados.nao_classificado.qtd > 1 ? 's' : ''}</b> sem grupo na DRE ({brl(dados.nao_classificado.valor)}), fora dos totais</span>
                  <span className="shrink-0 font-bold">Classificar</span>
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {carregando && !dados ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="card" />)}
        </div>
      ) : dados && !erro ? (
        <div className={cn('flex flex-col gap-4 transition-opacity', carregando && 'opacity-60')}>
          <div data-tour="kpis"><DreKpis kpis={dados.kpis} /></div>

          <section data-tour="demonstrativo" className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-5">
              <h2 className="text-base font-bold text-slate-900">
                Demonstração de resultados · {recorte}
                {visao === 'anual' && <span className="ml-1 text-[13px] font-normal text-slate-600">passe o mouse numa célula para ver o previsto</span>}
              </h2>
              <button type="button" onClick={() => definirAbertos(tudoAberto ? new Set() : new Set(todosGrupos))}
                className={cn(FILTRO_BOTAO, 'font-semibold')}>
                {tudoAberto ? 'Fechar todos os grupos' : 'Abrir todos os grupos'}
              </button>
            </div>
            {visao === 'anual'
              ? <div className="px-4 pb-4 md:px-5"><DreMatrix linhas={dados.linhas} mesRef={mes} abertos={abertos} alternar={alternar} ocultarZeradas={false} /></div>
              : <DreTable linhas={dados.linhas} abertos={abertos} alternar={alternar} ocultarZeradas={false} />}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
            <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
              <h2 className="mb-2 text-base font-bold text-slate-900">
                Resultado líquido por mês <span className="ml-1 text-[13px] font-normal text-slate-600">realizado x meta</span>
              </h2>
              <ResultadoMensalChart mensal={dados.mensal} mesRef={mes} aoEscolherMes={m => escolher(ano, m)} />
            </section>
            <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
              <h2 className="mb-3 text-base font-bold text-slate-900">
                Para onde vai a receita <span className="ml-1 text-[13px] font-normal text-slate-600">{recorte}</span>
              </h2>
              <AnaliseVertical linhas={dados.linhas} />
              <h2 className="mb-3 mt-5 text-base font-bold text-slate-900">Ponto de equilíbrio</h2>
              <PontoEquilibrio pe={dados.ponto_equilibrio} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
