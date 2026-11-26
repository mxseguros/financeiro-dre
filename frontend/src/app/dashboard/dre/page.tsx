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

const VISOES: [Visao, string][] = [['mes', 'Mês'], ['acumulado', 'Acumulado'], ['anual', '12 meses']]
const ANO_ATUAL = new Date().getFullYear()
const ANOS = Array.from({ length: 6 }, (_, i) => ANO_ATUAL - 2 + i)

export default function DrePage() {
  const { token } = useAuth()
  // Mês de referência vem do período compartilhado entre telas.
  const { mesInicio, definirMes } = usePeriodo()
  const ano = Number(mesInicio.slice(0, 4))
  const mes = Number(mesInicio.slice(5, 7))
  const escolher = (a: number, m: number) => definirMes(`${a}-${String(m).padStart(2, '0')}`)

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

  const alternar = (codigo: string) => setAbertos(prev => {
    const n = new Set(prev)
    if (n.has(codigo)) n.delete(codigo); else n.add(codigo)
    return n
  })
  const todosGrupos = dados?.linhas.filter(l => l.tipo === 'grupo').map(l => l.codigo) ?? []
  const tudoAberto = todosGrupos.length > 0 && todosGrupos.every(c => abertos.has(c))
  // "Expandir todas" sempre ativo (pedido de 22/10/2026): a cada recorte
  // carregado os grupos abrem; o checkbox continua para recolher se quiser.
  const chaveGrupos = todosGrupos.join('|')
  useEffect(() => {
    if (chaveGrupos) setAbertos(new Set(chaveGrupos.split('|')))
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
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Mês de referência (ano incluso) no padrão dos filtros: "Out 2026". */}
          <SeletorMes dataTour="periodo" rotulo="Mês de referência" valor={`${ano}-${String(mes).padStart(2, '0')}`}
            onChange={m => escolher(Number(m.slice(0, 4)), Number(m.slice(5, 7)))}
            semDados={m => !!dados && Number(m.slice(0, 4)) === ano && !comReal.has(Number(m.slice(5, 7)))} />
          <div data-tour="visao" role="group" aria-label="Visão" className={FILTRO_GRUPO}>
            {VISOES.map(([v, rotulo]) => (
              <button key={v} type="button" onClick={() => setVisao(v)} aria-pressed={visao === v}
                className={filtroSegmento(visao === v)}>
                {rotulo}
              </button>
            ))}
          </div>
          <Link data-tour="metas" href="/dashboard/dre/metas" className={FILTRO_BOTAO}>
            Metas (Previsto)
          </Link>
        </div>
      </div>

      {erro && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{erro}</div>}

      {!erro && dados && (
        <>
          {dados.pendentes.qtd > 0 && (
            <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              <b>{dados.pendentes.qtd}</b> lançamento(s) do realizado ainda aguardam aprovação ({brl(dados.pendentes.valor)}).{' '}
              <Link href="/dashboard/lancamentos/aprovacoes" className="font-medium underline">Ver aprovações</Link>
            </p>
          )}
          {dados.nao_classificado.qtd > 0 && (
            <p className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-600">
              <b>{dados.nao_classificado.qtd}</b> lançamento(s) sem grupo na DRE ({brl(dados.nao_classificado.valor)}) — fora dos totais.{' '}
              <Link href="/dashboard/lancamentos" className="font-medium text-blue-600 underline">Classificar em Lançamentos</Link>
            </p>
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

          <section data-tour="demonstrativo" className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-navy">
                Demonstração de Resultados{' '}
                <span className="ml-1 text-xs font-normal text-gray-400">
                  {recorte}{visao === 'anual' && ' · passe o mouse numa célula para ver o previsto'}
                </span>
              </h2>
              <div className="flex flex-wrap gap-4 text-xs text-gray-600">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={tudoAberto}
                    onChange={e => setAbertos(e.target.checked ? new Set(todosGrupos) : new Set())} />
                  Expandir todas
                </label>
              </div>
            </div>
            {visao === 'anual'
              ? <DreMatrix linhas={dados.linhas} mesRef={mes} abertos={abertos} alternar={alternar} ocultarZeradas={false} />
              : <DreTable linhas={dados.linhas} abertos={abertos} alternar={alternar} ocultarZeradas={false} />}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
            <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="mb-2 text-sm font-semibold text-navy">
                Resultado líquido por mês <span className="ml-1 text-xs font-normal text-gray-400">realizado x meta</span>
              </h2>
              <ResultadoMensalChart mensal={dados.mensal} mesRef={mes} aoEscolherMes={m => escolher(ano, m)} />
            </section>
            <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="mb-3 text-sm font-semibold text-navy">
                Para onde vai a receita <span className="ml-1 text-xs font-normal text-gray-400">{recorte}</span>
              </h2>
              <AnaliseVertical linhas={dados.linhas} />
              <h2 className="mb-3 mt-5 text-sm font-semibold text-navy">Ponto de equilíbrio</h2>
              <PontoEquilibrio pe={dados.ponto_equilibrio} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
