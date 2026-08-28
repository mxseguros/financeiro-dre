'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { fmtBRL, fmtData, mesAtual } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { ShareButton } from '@/components/ui/ShareButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { DashboardResponse } from '@/types'
import type { CentroCusto, DespesasResp, ReceitasResp } from './lancamentos/_components/shared'

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function nomeMes(inicio: string) {
  const d = new Date(inicio + 'T12:00:00')
  return `${MESES[d.getMonth()]} De ${d.getFullYear()}`
}

interface CardKPIProps {
  label: string
  valor: number | null | undefined
  sub?: string
  iconBg: string
  icon: React.ReactNode
}

function CardKPI({ label, valor, sub, iconBg, icon }: CardKPIProps) {
  return (
    <div className="flex items-start justify-between rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="mt-2 text-xl font-semibold text-navy">
          {valor != null ? fmtBRL(valor) : '—'}
        </p>
        {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </div>
    </div>
  )
}

interface BancoResumoItem { banco_id: string; banco_nome: string; receitas: number; despesas: number; saldo: number }
interface DashboardPorBancoResponse { periodo: { inicio: string; fim: string }; bancos: BancoResumoItem[] }
interface DespesasPorClassificacaoResponse {
  periodo: { inicio: string; fim: string }
  fixas: number; variaveis: number; nao_operacionais: number; impostos: number; nao_classificadas: number; total: number
}
interface LancamentoResumoItem {
  id: string; descricao: string; tipo_nome: string | null; valor: number; data: string | null
  status?: string | null
  natureza?: 'despesa' | 'receita' | null   // só no bloco por centro de custo
}
interface LancamentosDiaMesResponse { dia: LancamentoResumoItem[]; mes: LancamentoResumoItem[] }
interface CentroCustoResumo extends LancamentosDiaMesResponse {
  centro_nome: string; total_despesas: number; total_receitas: number
}

// Centro de custo com bloco próprio na Visão Geral. É o NOME cadastrado: o
// código correspondente não é derivável dele (Socorro está como 'guincho'),
// então resolvemos pela tabela de centros antes de filtrar os lançamentos.
const CENTRO_DESTAQUE = 'Socorro'

// Quantas linhas o bloco lista por seção — mesmo teto das demais listas.
const LIMITE_LISTA = 8

/** Hoje em ISO (YYYY-MM-DD) no fuso do navegador. */
function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Monta o bloco do centro de custo a partir das listas de Lançamentos.
 *
 * Os totais vêm do `soma_total` de cada resposta, que o backend calcula sobre o
 * período inteiro — não sobre as linhas exibidas aqui.
 */
function montarBlocoCentro(
  centroNome: string,
  despesas: DespesasResp,
  receitas: ReceitasResp,
): CentroCustoResumo {
  const hoje = hojeISO()
  const dia10 = (v: string | null | undefined) => v?.slice(0, 10) ?? null

  const itensDesp: LancamentoResumoItem[] = despesas.items.map(d => ({
    id: d.id, descricao: d.descricao, tipo_nome: d.tipo_nome, valor: d.valor,
    data: d.data_vencimento ?? d.paga_em ?? d.competencia,
    natureza: 'despesa',
  }))
  const itensRec: LancamentoResumoItem[] = receitas.items.map(r => ({
    id: r.id, descricao: r.descricao, tipo_nome: r.tipo_nome, valor: r.valor,
    data: r.data_vencimento ?? r.recebido_em ?? r.competencia,
    natureza: 'receita',
  }))

  // "Hoje" = vence, liquida ou foi lançado hoje — mesmo critério das outras
  // listas. Diferença: aqui só enxerga o período selecionado, porque é dele que
  // as duas listas vêm. Num mês passado, "Hoje" fica naturalmente vazio.
  const ehDeHoje = (venc: string | null, liq: string | null | undefined, criado: string | null | undefined) =>
    venc === hoje || dia10(liq) === hoje || dia10(criado) === hoje

  const idsDia = new Set<string>([
    ...despesas.items.filter(d => ehDeHoje(d.data_vencimento, d.paga_em, d.criado_em)).map(d => d.id),
    ...receitas.items.filter(r => ehDeHoje(r.data_vencimento, r.recebido_em, r.criado_em)).map(r => r.id),
  ])

  const porDataDesc = (a: LancamentoResumoItem, b: LancamentoResumoItem) => (b.data ?? '').localeCompare(a.data ?? '')
  const todos = [...itensDesp, ...itensRec].sort(porDataDesc)

  return {
    centro_nome: centroNome,
    total_despesas: despesas.soma_total,
    total_receitas: receitas.soma_total,
    dia: todos.filter(i => idsDia.has(i.id)).slice(0, LIMITE_LISTA),
    mes: todos.slice(0, LIMITE_LISTA),
  }
}

/** Busca despesas e receitas do centro em destaque, resolvendo nome → código. */
async function buscarCentro(inicio: string, fim: string, token: string): Promise<CentroCustoResumo> {
  const alvo = CENTRO_DESTAQUE.trim().toLowerCase()
  const centros = await api.get<CentroCusto[]>('/configuracoes/centros-custo', token)
  const centro = centros.find(c => c.nome.trim().toLowerCase() === alvo || c.codigo.trim().toLowerCase() === alvo)
  if (!centro) throw new Error(`Centro de custo "${CENTRO_DESTAQUE}" não está cadastrado`)

  const filtro = `inicio=${inicio}&fim=${fim}&centro_custo=${encodeURIComponent(centro.codigo)}`
  const [despesas, receitas] = await Promise.all([
    api.get<DespesasResp>(`/lancamentos/despesas?${filtro}`, token),
    api.get<ReceitasResp>(`/lancamentos/receitas?${filtro}`, token),
  ])
  return montarBlocoCentro(centro.nome, despesas, receitas)
}

function ListaDiaMes({ titulo, subtitulo, dados, cor, header, resumo }: {
  titulo: string
  subtitulo?: string
  dados: LancamentosDiaMesResponse | null
  cor: 'red' | 'green' | 'indigo'
  header?: React.ReactNode
  resumo?: React.ReactNode
}) {
  const corPadrao = cor === 'red' ? 'text-red-500' : cor === 'green' ? 'text-green-600' : 'text-indigo-600'
  // Numa lista que mistura despesa e receita (bloco por centro de custo), a cor
  // do valor precisa vir do item, não do bloco.
  const corValor = (item: LancamentoResumoItem) =>
    item.natureza === 'despesa' ? 'text-red-500'
      : item.natureza === 'receita' ? 'text-green-600'
      : corPadrao

  // A descrição é o que distingue um lançamento do outro — 15 salários do mesmo
  // subitem são 15 pessoas diferentes. Antes esta lista mostrava só o nome do
  // subitem, então linhas distintas apareciam como repetições.
  // O subitem vira apoio, em segunda linha: inline ele quebraria no mobile.
  const linhaItem = (item: LancamentoResumoItem, comData: boolean) => {
    const principal = item.descricao?.trim() || item.tipo_nome || '—'
    const subitem = item.tipo_nome && item.tipo_nome !== principal ? item.tipo_nome : null
    // Na lista mista, o rótulo da natureza vem antes do subitem: só a cor do
    // valor deixaria dúvida sobre o que é entrada e o que é saída.
    const detalhe = [
      item.natureza === 'despesa' ? 'Despesa' : item.natureza === 'receita' ? 'Receita' : null,
      subitem,
    ].filter(Boolean).join(' · ')
    return (
      <li key={item.id} className="flex items-start justify-between gap-2 text-xs">
        <div className="min-w-0 flex-1">
          <p className="truncate text-gray-700">{principal}</p>
          {detalhe && <p className="truncate text-[10px] leading-tight text-gray-400">{detalhe}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pl-2 text-right">
          {/* Badge compacto: nesta lista densa o tamanho padrão rouba largura
              da descrição no mobile. */}
          {item.status && <StatusBadge status={item.status} className="px-1.5 py-0 text-[10px]" />}
          {item.valor > 0 && <span className={`font-medium tabular-nums ${corValor(item)}`}>{fmtBRL(item.valor)}</span>}
          {comData && item.data && <span className="text-gray-400">{fmtData(item.data)}</span>}
        </div>
      </li>
    )
  }

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy">{titulo}</p>
          {subtitulo && <p className="text-[10px] uppercase tracking-wide text-gray-400">{subtitulo}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {header}
          <Link href="/dashboard/lancamentos" className="text-xs font-medium text-blue-500 hover:underline">
            Ver todas →
          </Link>
        </div>
      </div>
      {resumo}
      {/* dados === null é "ainda carregando" (renderização incremental) —
          diferente de lista vazia, que aí sim diz "nenhum lançamento". */}
      {!dados ? (
        <div className="space-y-2">
          {['w-2/3', 'w-1/2', 'w-3/5'].map(w => (
            <div key={w} className={`h-3 animate-pulse rounded bg-gray-100 ${w}`} />
          ))}
        </div>
      ) : (
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">Hoje</p>
          {dados.dia.length > 0 ? (
            <ul className="space-y-1.5">{dados.dia.map(item => linhaItem(item, false))}</ul>
          ) : <p className="text-xs text-gray-400">Nenhum lançamento hoje</p>}
        </div>
        <div className="border-t border-gray-100 pt-3">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">No período</p>
          {dados.mes.length > 0 ? (
            <ul className="space-y-1.5">{dados.mes.map(item => linhaItem(item, true))}</ul>
          ) : <p className="text-xs text-gray-400">Nenhum lançamento no período</p>}
        </div>
      </div>
      )}
    </div>
  )
}

const IconTrendUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-blue-600">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
  </svg>
)
const IconDollar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-green-600">
    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
)
const IconTarget = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-purple-500">
    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
  </svg>
)
const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

export default function DashboardPage() {
  const { token } = useAuth()
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [porBanco, setPorBanco] = useState<DashboardPorBancoResponse | null>(null)
  const [porClassificacao, setPorClassificacao] = useState<DespesasPorClassificacaoResponse | null>(null)
  const [despesasDiaMes, setDespesasDiaMes] = useState<LancamentosDiaMesResponse | null>(null)
  const [receitasDiaMes, setReceitasDiaMes] = useState<LancamentosDiaMesResponse | null>(null)
  const [ordensDiaMes, setOrdensDiaMes] = useState<LancamentosDiaMesResponse | null>(null)
  const [centroDiaMes, setCentroDiaMes] = useState<CentroCustoResumo | null>(null)
  const [erroCentro, setErroCentro] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [mes, setMes] = useState(mesAtual()[0].slice(0, 7)) // YYYY-MM

  const buscar = useCallback(() => {
    if (!token) return
    setErro(null)
    setErroCentro(null)
    // Zera tudo: cada bloco volta ao skeleton e reaparece quando SEU dado
    // chega. Antes era um Promise.all — a página inteira esperava o endpoint
    // mais lento (o /dashboard, que custava 4-5s) para mostrar qualquer número.
    setData(null); setPorBanco(null); setPorClassificacao(null)
    setDespesasDiaMes(null); setReceitasDiaMes(null); setOrdensDiaMes(null)
    setCentroDiaMes(null)
    const [y, m] = mes.split('-')
    const ultimoDia = new Date(Number(y), Number(m), 0).getDate()
    const inicio = `${y}-${m}-01`
    const fim = `${y}-${m}-${String(ultimoDia).padStart(2, '0')}`
    const q = `inicio=${inicio}&fim=${fim}`
    // Só o /dashboard (KPIs) derruba a página com mensagem de erro; os blocos
    // acessórios falham em silêncio e simplesmente não aparecem.
    api.get<DashboardResponse>(`/dashboard?${q}`, token)
      .then(setData)
      .catch((e: Error) => setErro(e.message))
    api.get<DashboardPorBancoResponse>(`/dashboard/por-banco?${q}`, token)
      .then(setPorBanco).catch(() => setPorBanco(null))
    api.get<DespesasPorClassificacaoResponse>(`/dashboard/despesas-por-classificacao?${q}`, token)
      .then(setPorClassificacao).catch(() => setPorClassificacao(null))
    api.get<LancamentosDiaMesResponse>(`/dashboard/despesas-dia-mes?${q}`, token)
      .then(setDespesasDiaMes).catch(() => setDespesasDiaMes(null))
    api.get<LancamentosDiaMesResponse>(`/dashboard/receitas-dia-mes?${q}`, token)
      .then(setReceitasDiaMes).catch(() => setReceitasDiaMes(null))
    api.get<LancamentosDiaMesResponse>(`/dashboard/ordens-compra-dia-mes?${q}`, token)
      .then(setOrdensDiaMes).catch(() => setOrdensDiaMes(null))
    // Bloco do centro de custo: acessório, com mensagem própria de erro.
    buscarCentro(inicio, fim, token)
      .then(setCentroDiaMes)
      .catch((e: unknown) => { setCentroDiaMes(null); setErroCentro(e instanceof Error ? e.message : 'Falha ao carregar') })
  }, [token, mes])

  useEffect(() => { buscar() }, [buscar])

  const d = data?.dre
  const periodo = data ? nomeMes(data.periodo.inicio) : ''

  const totalReceitaBancos = porBanco?.bancos.reduce((acc, b) => acc + b.receitas, 0) ?? 0
  const totalDespesaBancos = porBanco?.bancos.reduce((acc, b) => acc + b.despesas, 0) ?? 0
  const totalSaldoBancos   = totalReceitaBancos - totalDespesaBancos
  // Box do Sicredi oculto na Visão Geral a pedido — valores/cálculos do Total continuam somando todos os bancos
  const bancosExibidos = porBanco?.bancos.filter(b => b.banco_nome.toLowerCase() !== 'sicredi') ?? []

  // ── Dados para o botão Share de cada seção (reflete a lista do período exibida) ──
  // Mesmo critério da lista: a descrição identifica, o subitem contextualiza.
  const nomeShare = (i: LancamentoResumoItem) => {
    const principal = i.descricao?.trim() || i.tipo_nome || '—'
    return i.tipo_nome && i.tipo_nome !== principal ? `${principal} (${i.tipo_nome})` : principal
  }
  const itensDespShare = (despesasDiaMes?.mes ?? []).map(i => ({ nome: nomeShare(i), valor: i.valor, data: i.data }))
  const somaDespShare = itensDespShare.reduce((s, i) => s + (Number(i.valor) || 0), 0)
  const itensRecShare = (receitasDiaMes?.mes ?? []).map(i => ({ nome: nomeShare(i), valor: i.valor, data: i.data }))
  const somaRecShare = itensRecShare.reduce((s, i) => s + (Number(i.valor) || 0), 0)
  const itensOrdShare = (ordensDiaMes?.mes ?? []).map(i => ({ nome: i.tipo_nome ? `${i.tipo_nome} — ${i.descricao}` : i.descricao, valor: i.valor, data: i.data, status: i.status }))
  const pendOrdShare = itensOrdShare.filter(i => i.status === 'pendente').length
  const totalOrdShare = `${itensOrdShare.length} ordem(ns)${pendOrdShare ? `, ${pendOrdShare} pendente(s)` : ''}`

  const centroNome = centroDiaMes?.centro_nome ?? CENTRO_DESTAQUE
  const centroSaldo = (centroDiaMes?.total_receitas ?? 0) - (centroDiaMes?.total_despesas ?? 0)
  // O compartilhamento é texto puro: sem a cor do valor, a natureza precisa vir escrita.
  const itensCentroShare = (centroDiaMes?.mes ?? []).map(i => ({
    nome: `${i.natureza === 'receita' ? 'Receita' : 'Despesa'} — ${nomeShare(i)}`,
    valor: i.valor,
    data: i.data,
  }))
  // Mesmos três totais do card, para o compartilhamento não sair só com a lista.
  const resumoCentroShare = [
    { rotulo: 'Despesas', valor: fmtBRL(centroDiaMes?.total_despesas ?? 0), cor: '#ef4444' },
    { rotulo: 'Receitas', valor: fmtBRL(centroDiaMes?.total_receitas ?? 0), cor: '#16a34a' },
    { rotulo: 'Saldo',    valor: fmtBRL(centroSaldo), cor: centroSaldo >= 0 ? '#16a34a' : '#ef4444' },
  ]
  const totalCentroShare = `${itensCentroShare.length} lançamento(s) no período`

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy md:text-2xl">Visão Geral</h1>
          {periodo && (
            <p className="mt-0.5 text-sm text-gray-500">{periodo}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-sm focus:border-navy focus-ring focus:outline-none"
          />
          <button
            onClick={buscar}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
          >
            <IconRefresh /> Atualizar
          </button>
        </div>
      </div>

      {erro ? (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{erro}</div>
      ) : (
        <>
          {/* Cada seção renderiza assim que o SEU endpoint responde — o KPI
              (endpoint mais pesado) não segura mais os demais blocos. */}
          {d ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <CardKPI
                  label="Receita Bruta"
                  valor={d.receita_bruta}
                  sub="Competência"
                  iconBg="bg-blue-50"
                  icon={<IconTrendUp />}
                />
                <CardKPI
                  label="Receita Líquida"
                  valor={d.receita_liquida}
                  iconBg="bg-green-50"
                  icon={<IconDollar />}
                />
                <CardKPI
                  label="EBITDA"
                  valor={d.ebitda}
                  iconBg="bg-purple-50"
                  icon={<IconTarget />}
                />
              </div>

              <p className="text-xs text-gray-400">
                Campos exibidos conforme seu perfil de acesso. &quot;—&quot; indica informação não disponível para seu perfil.
              </p>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} variant="card" />
              ))}
            </div>
          )}

          {/* Receita/Despesa por banco */}
          {porBanco && porBanco.bancos.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">Por Banco</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {bancosExibidos.map(b => (
                  <div key={b.banco_id} className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                    <p className="text-sm font-medium text-gray-500">{b.banco_nome}</p>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Receita</span>
                        <span className="font-medium tabular-nums text-green-600">{fmtBRL(b.receitas)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Despesas</span>
                        <span className="font-medium tabular-nums text-red-500">{fmtBRL(b.despesas)}</span>
                      </div>
                      <div className="flex justify-between border-t border-gray-100 pt-1">
                        <span className="text-gray-500">Saldo</span>
                        <span className={`font-semibold tabular-nums ${b.saldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtBRL(b.saldo)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {porBanco.bancos.length > 1 && (
                  <div className="rounded-2xl bg-navy p-4 shadow-sm sm:p-5">
                    <p className="text-sm font-medium text-blue-100">Total (todos os bancos)</p>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-200">Receita</span>
                        <span className="font-medium tabular-nums text-white">{fmtBRL(totalReceitaBancos)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-200">Despesas</span>
                        <span className="font-medium tabular-nums text-white">{fmtBRL(totalDespesaBancos)}</span>
                      </div>
                      <div className="flex justify-between border-t border-white/20 pt-1">
                        <span className="text-blue-100">Saldo</span>
                        <span className="font-semibold tabular-nums text-white">{fmtBRL(totalSaldoBancos)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Despesas Fixas vs. Variáveis */}
          {porClassificacao && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-600">Despesas Fixas vs. Variáveis</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <CardKPI label="Fixas" valor={porClassificacao.fixas} iconBg="bg-blue-50" icon={<IconTarget />} />
                <CardKPI label="Variáveis" valor={porClassificacao.variaveis} iconBg="bg-amber-50" icon={<IconTrendUp />} />
                {porClassificacao.nao_operacionais > 0 && (
                  <CardKPI label="Não Operacionais" valor={porClassificacao.nao_operacionais} iconBg="bg-gray-100" icon={<IconDollar />} />
                )}
                {porClassificacao.impostos > 0 && (
                  <CardKPI label="Impostos" valor={porClassificacao.impostos} iconBg="bg-red-50" icon={<IconDollar />} />
                )}
                {porClassificacao.nao_classificadas > 0 && (
                  <CardKPI label="Não Classificadas" valor={porClassificacao.nao_classificadas} iconBg="bg-gray-100" icon={<IconDollar />} />
                )}
              </div>
            </div>
          )}

          {/* Listas diária/mensal: despesas, receitas, ordens de compra e o centro de custo em destaque */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ListaDiaMes titulo="Despesas" dados={despesasDiaMes} cor="red"
              header={<ShareButton titulo="Despesas" periodoLabel={periodo} itens={itensDespShare}
                totalTexto={`Total exibido: ${fmtBRL(somaDespShare)} (${itensDespShare.length} itens)`} emoji="💸" />} />
            <ListaDiaMes titulo="Receitas" dados={receitasDiaMes} cor="green"
              header={<ShareButton titulo="Receitas" periodoLabel={periodo} itens={itensRecShare}
                totalTexto={`Total exibido: ${fmtBRL(somaRecShare)} (${itensRecShare.length} itens)`} emoji="💰" />} />
            <ListaDiaMes titulo="Ordens de Compra" dados={ordensDiaMes} cor="indigo"
              header={<ShareButton titulo="Ordens de Compra" periodoLabel={periodo} itens={itensOrdShare}
                totalTexto={totalOrdShare} emoji="📋" />} />
            {/* Bloco do centro de custo em destaque — despesas e receitas na mesma lista */}
            <ListaDiaMes titulo={centroNome} subtitulo="Centro de custo" dados={centroDiaMes} cor="indigo"
              header={<ShareButton titulo={`${centroNome} — Despesas e Receitas`} periodoLabel={periodo}
                itens={itensCentroShare} resumo={resumoCentroShare} totalTexto={totalCentroShare} emoji="🏢" />}
              resumo={erroCentro ? (
                <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  Não foi possível carregar este bloco: {erroCentro}
                </p>
              ) : (
                <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Despesas</p>
                    <p className="font-semibold tabular-nums text-red-500">{fmtBRL(centroDiaMes?.total_despesas ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Receitas</p>
                    <p className="font-semibold tabular-nums text-green-600">{fmtBRL(centroDiaMes?.total_receitas ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Saldo</p>
                    <p className={`font-semibold tabular-nums ${centroSaldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtBRL(centroSaldo)}</p>
                  </div>
                </div>
              )} />
          </div>

          {/* Alertas */}
          {data?.alertas && data.alertas.length > 0 && (
            <div className="space-y-2">
              {data.alertas.map((a, i) => (
                <div key={i} className={`rounded-xl px-4 py-3 text-sm ${
                  a.severidade === 'critico' ? 'bg-red-50 text-red-700' :
                  a.severidade === 'aviso'   ? 'bg-amber-50 text-amber-700' :
                                               'bg-blue-50 text-blue-700'
                }`}>
                  {a.mensagem}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
