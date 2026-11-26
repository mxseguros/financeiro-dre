'use client'
import { FILTRO_BOTAO } from '@/components/ui/filtros'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { useTopBar } from '@/contexts/TopBarContext'
import { cn, fmtBRL, fmtData } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { ShareButton } from '@/components/ui/ShareButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useUser } from '@/contexts/UserContext'
import { permissaoPagamentos } from '@/types'
import type { DashboardResponse } from '@/types'
import type { CentroCusto, DespesasResp, ReceitasResp } from './lancamentos/_components/shared'
import { ModalDetalheValor, ValorClicavel, type AbrirDetalhe, type PedidoDetalhe } from './_components/DetalheValor'
import {
  BarraClassificacao, ComoCalculado, ExtratoBanco, FaixaPagamentos, Secao, TabelaTotal,
  type FatiaClass, type LinhaTabela, type ResumoPagamentos,
} from './_components/VisaoGeral'

// Decimal do backend chega como string no JSON.
interface BancoResumoItem { banco_id: string; banco_nome: string; receitas: number | string; despesas: number | string; saldo: number | string; saldo_inicial?: number | string; saldo_anterior?: number | string }
interface DashboardPorBancoResponse { periodo: { inicio: string; fim: string }; bancos: BancoResumoItem[] }
interface EmprestimoLado { itens: { subitem: string; qtd: number; valor: number | string }[]; total: number | string }
/** Quadros Empréstimos (linhas = subitens) e Aplicações (linhas = bancos). */
interface QuadroReceitaDespesaResponse { receitas: EmprestimoLado; despesas: EmprestimoLado; saldo: number | string }
/** Empréstimos e Aplicações: um card por banco (23/10/2026), cada um com receitas e despesas por subitem. */
interface EmprestimosResponse extends QuadroReceitaDespesaResponse {
  bancos: (QuadroReceitaDespesaResponse & { banco: string; saldo_acumulado?: number | string })[]
}
interface DespesasPorClassificacaoResponse {
  periodo: { inicio: string; fim: string }
  fixas: number; variaveis: number; nao_operacionais: number; impostos: number; nao_classificadas: number; total: number
  outras?: { codigo: string; nome: string; valor: number | string }[]
}
interface LancamentoResumoItem {
  id: string; descricao: string; tipo_nome: string | null; valor: number; data: string | null
  status?: string | null
  natureza?: 'despesa' | 'receita' | null   // só no bloco por centro de custo
  agregado?: boolean   // "Total Salários Funcionários" (0046): soma, detalhe só Admin
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
    agregado: d.agregado,
  }))
  const itensRec: LancamentoResumoItem[] = receitas.items.map(r => ({
    id: r.id, descricao: r.descricao, tipo_nome: r.tipo_nome, valor: r.valor,
    data: r.data_vencimento ?? r.recebido_em ?? r.competencia,
    natureza: 'receita',
  }))

  // "Hoje" = mesmo critério das outras listas (regras de 19/10 e 09/11/2026):
  // despesa só se VENCE hoje e ainda não tem Data de Pagamento; receita se vence
  // ou foi recebida hoje. Aqui só enxerga o
  // período selecionado, porque é dele que as duas listas vêm. Num mês
  // passado, "Hoje" fica naturalmente vazio.
  const ehDeHoje = (venc: string | null, liq: string | null | undefined) =>
    venc === hoje || dia10(liq) === hoje

  const idsDia = new Set<string>([
    ...despesas.items.filter(d => d.data_vencimento === hoje && !d.paga_em).map(d => d.id),
    ...receitas.items.filter(r => ehDeHoje(r.data_vencimento, r.recebido_em)).map(r => r.id),
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
async function buscarCentro(inicio: string, fim: string, base: string, token: string): Promise<CentroCustoResumo> {
  const alvo = CENTRO_DESTAQUE.trim().toLowerCase()
  const centros = await api.get<CentroCusto[]>('/configuracoes/centros-custo', token)
  const centro = centros.find(c => c.nome.trim().toLowerCase() === alvo || c.codigo.trim().toLowerCase() === alvo)
  if (!centro) throw new Error(`Centro de custo "${CENTRO_DESTAQUE}" não está cadastrado`)

  const filtro = `inicio=${inicio}&fim=${fim}&base=${base}&centro_custo=${encodeURIComponent(centro.codigo)}`
  const [despesas, receitas] = await Promise.all([
    api.get<DespesasResp>(`/lancamentos/despesas?${filtro}`, token),
    api.get<ReceitasResp>(`/lancamentos/receitas?${filtro}`, token),
  ])
  return montarBlocoCentro(centro.nome, despesas, receitas)
}

type AbaMov = 'despesas' | 'receitas' | 'ordens' | 'centro'

/**
 * As 4 listas (Despesas, Receitas, Ordens e o centro em destaque) num card só,
 * com abas e o alternador Hoje / No período (redesenho UX, fase 4).
 * "Hoje" segue as regras de sempre (despesa: vence hoje e não paga; receita:
 * vence ou foi recebida hoje).
 */
function Movimentacoes({ listas, centroNome, topoCentro, compartilhar }: {
  listas: Record<AbaMov, LancamentosDiaMesResponse | null>
  centroNome: string
  topoCentro: React.ReactNode
  compartilhar: (aba: AbaMov) => React.ReactNode
}) {
  const [aba, setAba] = useState<AbaMov>('despesas')
  const [quando, setQuando] = useState<'dia' | 'mes'>('dia')
  const [todos, setTodos] = useState(false)
  useEffect(() => { setTodos(false) }, [aba, quando])
  const rotulos: Record<AbaMov, string> = { despesas: 'Despesas', receitas: 'Receitas', ordens: 'Ordens de compra', centro: `Centro ${centroNome}` }
  const dados = listas[aba]
  const lista = dados ? dados[quando] : null
  const exibidos = lista ? (todos || quando === 'dia' ? lista : lista.slice(0, LIMITE_LISTA)) : []
  const soma = (lista ?? []).reduce((s, i) => s + (Number(i.valor) || 0), 0)
  const corItem = (i: LancamentoResumoItem) =>
    (i.natureza ?? (aba === 'receitas' ? 'receita' : 'despesa')) === 'receita' ? 'text-green-700' : 'text-slate-900'

  return (
    <section aria-labelledby="mov-titulo" className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 md:px-5">
        <h2 id="mov-titulo" className="text-base font-bold text-slate-900">Movimentações</h2>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Quando" className="inline-flex h-12 overflow-hidden rounded-lg bg-white ring-1 ring-gray-300 md:h-11">
            {([['dia', 'Hoje'], ['mes', 'No período']] as const).map(([k, r]) => (
              <button key={k} type="button" aria-pressed={quando === k} onClick={() => setQuando(k)}
                className={cn('focus-ring px-3.5 text-sm font-medium', quando === k ? 'bg-navy text-white' : 'text-slate-700 hover:bg-gray-50')}>{r}</button>
            ))}
          </div>
          {compartilhar(aba)}
        </div>
      </div>
      <div role="tablist" aria-label="Tipo de movimentação" className="flex gap-2 overflow-x-auto px-4 py-3 md:px-5">
        {(Object.keys(rotulos) as AbaMov[]).map(k => {
          const n = listas[k]?.[quando]?.length
          const sel = aba === k
          return (
            <button key={k} type="button" role="tab" aria-selected={sel} onClick={() => setAba(k)}
              className={cn('focus-ring inline-flex h-12 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm md:h-11',
                sel ? 'bg-navy font-semibold text-white' : 'border border-gray-300 bg-white text-slate-700 hover:bg-gray-50')}>
              {rotulos[k]}
              {n != null && <span className={cn('rounded-full px-1.5 text-[13px] font-semibold tabular-nums', sel ? 'bg-white/20' : 'bg-slate-100 text-slate-700')}>{n}</span>}
            </button>
          )
        })}
      </div>
      {aba === 'centro' && topoCentro}
      {!lista ? (
        <div className="space-y-2 px-4 pb-4 md:px-5">{['w-2/3', 'w-1/2', 'w-3/5'].map(w => <Skeleton key={w} className={`h-5 ${w}`} />)}</div>
      ) : lista.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-slate-600 md:px-5">{quando === 'dia' ? 'Nenhum lançamento hoje.' : 'Nenhum lançamento no período.'}</p>
      ) : (
        <ul className="px-4 md:px-5">
          {exibidos.map(i => {
            const principal = i.descricao?.trim() || i.tipo_nome || '—'
            const detalhe = [i.natureza === 'despesa' ? 'Despesa' : i.natureza === 'receita' ? 'Receita' : null,
              i.tipo_nome && i.tipo_nome !== principal ? i.tipo_nome : null].filter(Boolean).join(' · ')
            return (
              <li key={i.id} className="flex min-h-[56px] items-center gap-3 border-t border-slate-100 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">
                    {i.agregado && <span aria-hidden className="mr-1" title="Detalhe por funcionário só para o Admin">🔒</span>}{principal}
                  </span>
                  {detalhe && <span className="block truncate text-[13px] text-slate-600">{detalhe}</span>}
                </span>
                {i.status && <StatusBadge status={i.status} className="hidden sm:inline-flex" />}
                <span className="flex shrink-0 flex-col items-end">
                  <span className={cn('font-semibold tabular-nums', corItem(i))}>{fmtBRL(i.valor)}</span>
                  {quando === 'mes' && i.data && <span className="text-[13px] text-slate-600">{fmtData(i.data)}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-4 py-2 text-sm text-slate-600 md:px-5">
        <span>
          {lista && lista.length > 0 && <>{quando === 'dia' ? 'Total de hoje' : 'Total listado'}: <b className="tabular-nums text-slate-900">{fmtBRL(soma)}</b> · {lista.length} {lista.length === 1 ? 'item' : 'itens'}</>}
        </span>
        <span className="flex items-center gap-1">
          {lista && quando === 'mes' && lista.length > LIMITE_LISTA && (
            <button type="button" onClick={() => setTodos(v => !v)}
              className="focus-ring h-12 rounded-lg px-2 font-semibold text-sel hover:underline md:h-11">
              {todos ? 'Ver menos' : `Ver mais (${lista.length - LIMITE_LISTA})`}
            </button>
          )}
          <Link href="/dashboard/lancamentos" className="focus-ring inline-flex h-12 items-center rounded-lg px-2 font-semibold text-sel hover:underline md:h-11">
            Ver todas em Lançamentos
          </Link>
        </span>
      </div>
    </section>
  )
}

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
  const [emprestimos, setEmprestimos] = useState<EmprestimosResponse | null>(null)
  const [aplicacoes, setAplicacoes] = useState<EmprestimosResponse | null>(null)
  const [despesasDiaMes, setDespesasDiaMes] = useState<LancamentosDiaMesResponse | null>(null)
  const [receitasDiaMes, setReceitasDiaMes] = useState<LancamentosDiaMesResponse | null>(null)
  const [ordensDiaMes, setOrdensDiaMes] = useState<LancamentosDiaMesResponse | null>(null)
  const [centroDiaMes, setCentroDiaMes] = useState<CentroCustoResumo | null>(null)
  const [erroCentro, setErroCentro] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [resumoPag, setResumoPag] = useState<ResumoPagamentos | null>(null)
  // Periodo compartilhado entre telas (ver contexts/PeriodoContext.tsx).
  // Todos os modos filtram pela Data de Pagamento (em aberto, pelo vencimento).
  const filtro = filtroDoPeriodo(usePeriodo())
  const { permissions, role } = useUser()
  const [pedido, setPedido] = useState<PedidoDetalhe | null>(null)
  // A modal lista lançamentos um a um: só para quem tem acesso à tela de Lançamentos.
  const abrir: AbrirDetalhe | undefined = permissions?.lancamentos?.visualizar ? setPedido : undefined

  const buscar = useCallback(() => {
    if (!token) return
    setErro(null)
    setErroCentro(null)
    // Zera tudo: cada bloco volta ao skeleton e reaparece quando SEU dado
    // chega. Antes era um Promise.all — a página inteira esperava o endpoint
    // mais lento (o /dashboard, que custava 4-5s) para mostrar qualquer número.
    setData(null); setPorBanco(null); setPorClassificacao(null); setEmprestimos(null); setAplicacoes(null)
    setDespesasDiaMes(null); setReceitasDiaMes(null); setOrdensDiaMes(null)
    setCentroDiaMes(null)
    const q = filtro.qs
    // Só o /dashboard (KPIs) derruba a página com mensagem de erro; os blocos
    // acessórios falham em silêncio e simplesmente não aparecem.
    api.get<DashboardResponse>(`/dashboard?${q}`, token)
      .then(setData)
      .catch((e: Error) => setErro(e.message))
    api.get<DashboardPorBancoResponse>(`/dashboard/por-banco?${q}`, token)
      .then(setPorBanco).catch(() => setPorBanco(null))
    api.get<DespesasPorClassificacaoResponse>(`/dashboard/despesas-por-classificacao?${q}`, token)
      .then(setPorClassificacao).catch(() => setPorClassificacao(null))
    api.get<EmprestimosResponse>(`/dashboard/emprestimos?${q}`, token)
      .then(setEmprestimos).catch(() => setEmprestimos(null))
    api.get<EmprestimosResponse>(`/dashboard/aplicacoes?${q}`, token)
      .then(setAplicacoes).catch(() => setAplicacoes(null))
    api.get<LancamentosDiaMesResponse>(`/dashboard/despesas-dia-mes?${q}`, token)
      .then(setDespesasDiaMes).catch(() => setDespesasDiaMes(null))
    api.get<LancamentosDiaMesResponse>(`/dashboard/receitas-dia-mes?${q}`, token)
      .then(setReceitasDiaMes).catch(() => setReceitasDiaMes(null))
    api.get<LancamentosDiaMesResponse>(`/dashboard/ordens-compra-dia-mes?${q}`, token)
      .then(setOrdensDiaMes).catch(() => setOrdensDiaMes(null))
    // Bloco do centro de custo: acessório, com mensagem própria de erro.
    buscarCentro(filtro.inicio, filtro.fim, filtro.base, token)
      .then(setCentroDiaMes)
      .catch((e: unknown) => { setCentroDiaMes(null); setErroCentro(e instanceof Error ? e.message : 'Falha ao carregar') })
  }, [token, filtro.qs, filtro.inicio, filtro.fim, filtro.base])

  useEffect(() => { buscar() }, [buscar])

  // Faixa de Pagamentos (CNAB): só para quem vê a tela Pagamentos.
  const vePagamentos = permissaoPagamentos(permissions, role, 'visualizar')
  useEffect(() => {
    if (!token || !vePagamentos) return
    api.get<ResumoPagamentos>('/pagamentos/resumo', token).then(setResumoPag).catch(() => setResumoPag(null))
  }, [token, vePagamentos, filtro.qs])

  // Boxes "Saldo do período <banco>" — juntam o card do banco, Empréstimos e Aplicações.
  const BANCOS_SALDO_PERIODO = ['Itaú', 'Santander']
  const saldosPeriodo = BANCOS_SALDO_PERIODO.flatMap(nome => {
    const card = porBanco?.bancos.find(b => b.banco_nome === nome)
    if (!card) return []
    const emp = emprestimos?.bancos.find(b => b.banco === nome)
    const apl = aplicacoes?.bancos.find(b => b.banco === nome)
    return [{
      banco: nome,
      saldoInicial: Number(card.saldo_inicial ?? 0) + Number(card.saldo_anterior ?? 0),
      emprestimo: emprestimos ? (emp ? Number(emp.saldo_acumulado ?? emp.saldo) : 0) : null,
      aplicacao: aplicacoes ? (apl ? Number(apl.saldo_acumulado ?? apl.saldo) : 0) : null,
      saldoBanco: Number(card.saldo),
    }]
  })
  const periodo = data ? filtro.rotulo : ''

  // Barra do topo: o período por extenso vira o subtítulo; Atualizar é a ação da tela.
  useTopBar({
    subtitulo: periodo || undefined,
    acao: (
      <button onClick={buscar} className={FILTRO_BOTAO}>
        <IconRefresh /> Atualizar
      </button>
    ),
  }, [periodo, buscar])

  // O backend serializa Decimal como string ("23311.18"): sem Number(), o `+`
  // concatena texto e o Total sai NaN — exibido como "—".
  const totalReceitaBancos = porBanco?.bancos.reduce((acc, b) => acc + Number(b.receitas), 0) ?? 0
  const totalDespesaBancos = porBanco?.bancos.reduce((acc, b) => acc + Number(b.despesas), 0) ?? 0
  const totalSaldoBancos   = totalReceitaBancos - totalDespesaBancos
  // Todos os bancos ativos, Sicredi incluído (voltou a pedido em 19/10/2026).
  const linhasPorBanco: LinhaTabela[] = (porBanco?.bancos ?? []).map((b): LinhaTabela => ({
    chave: b.banco_id, banco: b.banco_nome, valores: [
      { v: Number(b.receitas), verde: true, pedido: { titulo: `Por Banco ${b.banco_nome} · Receita`, params: { bloco: 'por_banco', banco: b.banco_nome, lado: 'receitas' } } },
      { v: Number(b.despesas), pedido: { titulo: `Por Banco ${b.banco_nome} · Despesas`, params: { bloco: 'por_banco', banco: b.banco_nome, lado: 'despesas' } } },
      { v: Number(b.saldo), verde: true, pedido: { titulo: `Por Banco ${b.banco_nome} · Saldo`, params: { bloco: 'por_banco', banco: b.banco_nome } } },
    ],
  }))
  const totalPorBanco: LinhaTabela = { chave: 'total', banco: 'Total', valores: [
    { v: totalReceitaBancos, verde: true, pedido: { titulo: 'Por Banco Total · Receita', params: { bloco: 'por_banco', lado: 'receitas' } } },
    { v: totalDespesaBancos, pedido: { titulo: 'Por Banco Total · Despesas', params: { bloco: 'por_banco', lado: 'despesas' } } },
    { v: totalSaldoBancos, verde: true, pedido: { titulo: 'Por Banco Total · Saldo', params: { bloco: 'por_banco' } } },
  ] }

  /** Empréstimos e Aplicações: entradas (receitas), saídas (despesas) e saldo acumulado, com total. */
  function linhasQuadro(dados: EmprestimosResponse, titulo: string, bloco: 'emprestimos' | 'aplicacoes'): [LinhaTabela[], LinhaTabela] {
    const linhas = dados.bancos.map((b): LinhaTabela => ({
      chave: b.banco, banco: b.banco, valores: [
        { v: Number(b.receitas.total), pedido: { titulo: `${titulo} ${b.banco} · Entradas`, params: { bloco, banco: b.banco, lado: 'receitas' } } },
        { v: Number(b.despesas.total), pedido: { titulo: `${titulo} ${b.banco} · Saídas`, params: { bloco, banco: b.banco, lado: 'despesas' } } },
        { v: Number(b.saldo_acumulado ?? b.saldo), pedido: { titulo: `${titulo} ${b.banco} · Saldo`, params: { bloco, banco: b.banco } } },
      ],
    }))
    const soma = (i: number) => linhas.reduce((a, l) => a + l.valores[i].v, 0)
    return [linhas, { chave: 'total', banco: 'Total', valores: [
      { v: soma(0), pedido: { titulo: `${titulo} · Entradas`, params: { bloco, lado: 'receitas' } } },
      { v: soma(1), pedido: { titulo: `${titulo} · Saídas`, params: { bloco, lado: 'despesas' } } },
      { v: soma(2), pedido: { titulo: `${titulo} · Saldo`, params: { bloco } } },
    ] }]
  }

  // Despesas por classificação: uma barra só (ordem e cores fixas; "Não classificadas" pede revisão).
  const fatias: FatiaClass[] = porClassificacao ? [
    { codigo: 'fixo', nome: 'Fixas', valor: Number(porClassificacao.fixas), cor: 'bg-sel-text' },
    { codigo: 'variavel', nome: 'Variáveis', valor: Number(porClassificacao.variaveis), cor: 'bg-blue-400' },
    { codigo: 'imposto', nome: 'Impostos', valor: Number(porClassificacao.impostos), cor: 'bg-amber-500' },
    { codigo: 'nao_operacional', nome: 'Não operacionais', valor: Number(porClassificacao.nao_operacionais), cor: 'bg-slate-500' },
    ...(porClassificacao.outras ?? []).map((o, i) => ({ codigo: o.codigo, nome: o.nome, valor: Number(o.valor), cor: ['bg-teal-500', 'bg-violet-400', 'bg-rose-300'][i % 3] })),
    { codigo: 'nao_classificada', nome: 'Não classificadas', valor: Number(porClassificacao.nao_classificadas), cor: 'bg-slate-300', revisar: true },
  ] : []

  // ── Compartilhar (por aba das Movimentações) ──
  // Mesmo critério da lista: a descrição identifica, o subitem contextualiza.
  const nomeShare = (i: LancamentoResumoItem) => {
    const principal = i.descricao?.trim() || i.tipo_nome || '—'
    return i.tipo_nome && i.tipo_nome !== principal ? `${principal} (${i.tipo_nome})` : principal
  }
  const hojeLabel = `Hoje, ${new Date().toLocaleDateString('pt-BR')}`
  // Despesas/Receitas: o box inteiro — Hoje + No período (o que a lista mostra).
  const secoesShare = (dados: LancamentosDiaMesResponse | null) => {
    const conv = (lista: LancamentosDiaMesResponse['dia'] | undefined) =>
      (lista ?? []).map(i => ({ nome: nomeShare(i), valor: i.valor, data: i.data }))
    const soma = (xs: { valor?: number | null }[]) => xs.reduce((s, i) => s + (Number(i.valor) || 0), 0)
    const hoje = conv(dados?.dia)
    const per = conv(dados?.mes)
    return [
      { titulo: hojeLabel, itens: hoje, vazio: 'Nenhum lançamento hoje',
        totalTexto: hoje.length ? `Total de hoje: ${fmtBRL(soma(hoje))} (${hoje.length} ${hoje.length === 1 ? 'item' : 'itens'})` : undefined },
      { titulo: `No período · ${filtro.rotulo}`, itens: per, vazio: 'Nenhum lançamento no período',
        totalTexto: per.length ? `Total do período: ${fmtBRL(soma(per))} (${per.length} ${per.length === 1 ? 'item' : 'itens'})` : undefined },
    ]
  }
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
  const resumoCentroShare = [
    { rotulo: 'Despesas', valor: fmtBRL(centroDiaMes?.total_despesas ?? 0), cor: '#ef4444' },
    { rotulo: 'Receitas', valor: fmtBRL(centroDiaMes?.total_receitas ?? 0), cor: '#16a34a' },
    { rotulo: 'Saldo',    valor: fmtBRL(centroSaldo), cor: centroSaldo >= 0 ? '#16a34a' : '#ef4444' },
  ]
  const totalCentroShare = `${itensCentroShare.length} lançamento(s) no período`

  const compartilhar = (aba: AbaMov) => aba === 'despesas'
    ? <ShareButton titulo="Despesas" periodoLabel={`${hojeLabel} · ${filtro.rotulo}`} itens={[]} secoes={secoesShare(despesasDiaMes)} emoji="💸" />
    : aba === 'receitas'
    ? <ShareButton titulo="Receitas" periodoLabel={`${hojeLabel} · ${filtro.rotulo}`} itens={[]} secoes={secoesShare(receitasDiaMes)} emoji="💰" />
    : aba === 'ordens'
    ? <ShareButton titulo="Ordens de Compra" periodoLabel={periodo} itens={itensOrdShare} totalTexto={totalOrdShare} emoji="📋" />
    : <ShareButton titulo={`${centroNome} — Despesas e Receitas`} periodoLabel={periodo}
        itens={itensCentroShare} resumo={resumoCentroShare} totalTexto={totalCentroShare} emoji="🏢" />

  const topoCentro = erroCentro ? (
    <p className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 md:mx-5">
      Não foi possível carregar este bloco: {erroCentro}
    </p>
  ) : (
    <div className="mx-4 mb-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm md:mx-5">
      {([['Despesas', centroDiaMes?.total_despesas ?? 0, 'despesas', 'text-slate-900'], ['Receitas', centroDiaMes?.total_receitas ?? 0, 'receitas', 'text-green-700'],
        ['Saldo', centroSaldo, '', centroSaldo < 0 ? 'text-red-700' : 'text-green-700']] as const).map(([rot, v, lado, cor]) => (
        <div key={rot}>
          <p className="text-[13px] text-slate-600">{rot}</p>
          <ValorClicavel valor={v} abrir={abrir} className={cn('inline-flex min-h-12 items-center md:min-h-0 font-semibold tabular-nums', cor)}
            pedido={{ titulo: `${centroNome} · ${rot}`, params: lado ? { bloco: 'centro', centro: centroNome, lado } : { bloco: 'centro', centro: centroNome } }} />
        </div>
      ))}
    </div>
  )

  const alertas = data?.alertas ?? []

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Alertas: faixa no topo */}
      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map((a, i) => (
            <div key={i} role="status" className={cn('flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
              a.severidade === 'info' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-300 bg-amber-50 text-amber-900')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" />
              </svg>
              <span className="flex-1">{a.mensagem}</span>
            </div>
          ))}
        </div>
      )}

      {erro ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{erro}</div>
      ) : (
        <>
          {/* Saldo do período por banco, lido como extrato */}
          <section aria-labelledby="saldos-titulo" data-tour="kpis" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="saldos-titulo" className="text-base font-bold text-slate-900">Saldo do período por banco</h2>
              <ComoCalculado />
            </div>
            {saldosPeriodo.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {saldosPeriodo.map(sp => <ExtratoBanco key={sp.banco} s={sp} abrir={abrir} />)}
              </div>
            ) : !porBanco ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Skeleton className="h-56 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>
            ) : <p className="text-sm text-slate-600">Sem saldos de Itaú e Santander no período.</p>}
          </section>

          {resumoPag?.habilitado && <FaixaPagamentos r={resumoPag} />}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {porClassificacao ? (
              <Secao titulo="Despesas por classificação" id="class-titulo"
                acao={<span className="text-sm font-semibold tabular-nums text-slate-900">{fmtBRL(porClassificacao.total)}</span>}>
                <BarraClassificacao fatias={fatias} total={Number(porClassificacao.total)} abrir={abrir} />
              </Secao>
            ) : <Skeleton className="h-64 rounded-2xl" />}

            {porBanco && porBanco.bancos.length > 0 ? (
              <Secao titulo="Por banco" id="porbanco-titulo" tour="por-banco"
                nota="Só o que já passou pelo banco no período, pela data de pagamento ou de recebimento. Despesas: só Fixas e Variáveis. Receitas: só a categoria Receitas de vendas.">
                <TabelaTotal colunas={['Receitas', 'Despesas', 'Saldo']} linhas={linhasPorBanco}
                  total={linhasPorBanco.length > 1 ? totalPorBanco : undefined} abrir={abrir} />
              </Secao>
            ) : !porBanco ? <Skeleton className="h-64 rounded-2xl" /> : null}
          </div>

          {((emprestimos && emprestimos.bancos.length > 0) || (aplicacoes && aplicacoes.bancos.length > 0)) && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {emprestimos && emprestimos.bancos.length > 0 && (() => {
                const [linhas, total] = linhasQuadro(emprestimos, 'Empréstimos', 'emprestimos')
                return (
                  <Secao titulo="Empréstimos" id="emp-titulo" tour="emprestimos"
                    nota="Categorias Empréstimo, por banco. Saldo acumulado desde outubro/2026; só lançamentos com data de pagamento ou recebimento.">
                    <TabelaTotal colunas={['Entradas', 'Saídas', 'Saldo acumulado']} linhas={linhas} total={linhas.length > 1 ? total : undefined} abrir={abrir} />
                  </Secao>
                )
              })()}
              {aplicacoes && aplicacoes.bancos.length > 0 && (() => {
                const [linhas, total] = linhasQuadro(aplicacoes, 'Aplicações', 'aplicacoes')
                return (
                  <Secao titulo="Aplicações" id="apl-titulo" tour="aplicacoes"
                    nota="Categoria Aplicações, por banco. Saldo acumulado desde outubro/2026; só lançamentos com data de pagamento ou recebimento.">
                    <TabelaTotal colunas={['Aplicado', 'Resgatado', 'Saldo acumulado']} linhas={linhas} total={linhas.length > 1 ? total : undefined} abrir={abrir} />
                  </Secao>
                )
              })()}
            </div>
          )}

          <Movimentacoes
            listas={{ despesas: despesasDiaMes, receitas: receitasDiaMes, ordens: ordensDiaMes, centro: centroDiaMes ?? (erroCentro ? { dia: [], mes: [] } : null) }}
            centroNome={centroNome} topoCentro={topoCentro} compartilhar={compartilhar} />
        </>
      )}

      {token && (
        <ModalDetalheValor
          token={token}
          qs={filtro.qs}
          periodo={filtro.rotulo}
          pedido={pedido}
          podeEditar={!!permissions?.lancamentos?.editar}
          onFechar={() => setPedido(null)}
          onAlterado={buscar}
        />
      )}
    </div>
  )
}
