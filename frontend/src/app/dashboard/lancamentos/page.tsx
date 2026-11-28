'use client'
import { useContagemAnexos } from '@/components/anexos/CampoAnexos'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { api } from '@/lib/api'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { useTopBar } from '@/contexts/TopBarContext'
import { EVENTO_NOVO, MenuNovo, type TipoNovo } from '@/components/layout/MenuNovo'
import { filtrosExport } from '@/components/exportar/dados'
import { FILTRO_CAMPO } from '@/components/ui/filtros'
import { fmtBRL } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { Tabs } from '@/components/ui/Tabs'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { permissaoPagamentos } from '@/types'
import { ModalDespesa } from './_components/ModalDespesa'
import { ModalReceita } from './_components/ModalReceita'
import { ModalOrdemCompra } from './_components/ModalOrdemCompra'
import { ModalImportarExtrato } from './_components/ModalImportarExtrato'
import { DialogExcluirGrupo } from './_components/DialogExcluirGrupo'
import {
  type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Despesa, type DespesasResp,
  type Receita, type ReceitasResp, type OrdemCompra, type OrdensCompraResp, podeExcluirLancamento,
  type Classificacao } from './_components/shared'
import { opcoesCentroFiltro } from '@/lib/centros'
import { hojeISO } from './_components/situacao'
import { type Vinculado } from './_components/Emprestimo'
import { BarraSituacao, OPCOES_DESPESA, OPCOES_RECEITA, type SituacaoDespesa, type SituacaoReceita } from './_components/BarraSituacao'
import {
  BarraLote, CartaoResumo, CartoesDespesas, CartoesOrdens, CartoesReceitas, ChipSelect, DialogMarcar,
  TabelaDespesas, TabelaOrdens, TabelaReceitas, botaoLote, botaoLotePrimario, qtd, selecionavelReceita,
} from './_components/Listas'

interface DialogGrupo { id: string; grupo: 'parcelamento' | 'recorrencia'; total?: number }

// Campos ordenáveis. 'registro' = data de criação (último registrado primeiro)
type OrdemCampo = 'registro' | 'competencia' | 'vencimento' | 'pagamento' | 'valor'

// ── Página principal ───────────────────────────────────────────
export default function LancamentosPage() {
  const { token } = useAuth()
  const { role, userId, permissions } = useUser()
  const router = useRouter()
  const podeRemessa = permissaoPagamentos(permissions, role, 'remessa')
  const podeAprovar = role === 'admin' || role === 'gestor'
  // Periodo compartilhado entre telas (ver contexts/PeriodoContext.tsx).
  const periodo = usePeriodo()
  const { mesInicio } = periodo
  // Dia | Mês (De/Até) | Ano | Período — todos pela Data de Pagamento (em aberto, pelo vencimento).
  const filtro = filtroDoPeriodo(periodo, true)
  const [filtroBanco, setFiltroBanco] = useState('')
  const [filtroCentro, setFiltroCentro] = useState('')
  const [aba, setAba] = useState<'despesas' | 'receitas' | 'ordens'>('despesas')
  // Status de aprovação: só na aba Ordens de compra. Despesas e Receitas usam
  // a Situação (28/11/2026), que já inclui "Aguardando aprovação" e "Rejeitada".
  const [filtroStatus, setFiltroStatus] = useState('')
  const [situacaoDesp, setSituacaoDesp] = useState<SituacaoDespesa | ''>('')
  const [situacaoRec, setSituacaoRec] = useState<SituacaoReceita | ''>('')
  // Filtro "Tipo" (22/10/2026): Categoria e, opcionalmente, Subitem.
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroSubitem, setFiltroSubitem] = useState('')
  // Redesenho UX (fase 3): filtros à vista, em chips de 44 px.
  const situacaoAba = aba === 'despesas' ? situacaoDesp : aba === 'receitas' ? situacaoRec : ''
  const filtrosAtivos = [filtroCategoria, filtroBanco, filtroCentro, aba === 'ordens' ? filtroStatus : '', situacaoAba].filter(Boolean).length
  function limparFiltros() {
    setFiltroCategoria(''); setFiltroSubitem(''); setFiltroBanco(''); setFiltroCentro(''); setFiltroStatus('')
    setSituacaoDesp(''); setSituacaoRec('')
  }
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<{ campo: OrdemCampo; dir: 'asc' | 'desc' }>({ campo: 'registro', dir: 'desc' })
  const [despesas, setDespesas] = useState<DespesasResp | null>(null)
  const [receitas, setReceitas] = useState<ReceitasResp | null>(null)
  const anexosDesp = useContagemAnexos(token, 'despesa', useMemo(() => despesas?.items.map(d => d.id), [despesas]))
  const anexosRec = useContagemAnexos(token, 'receita',
    useMemo(() => receitas?.items.filter(r => r.origem === 'manual').map(r => r.id), [receitas]))
  const [ordens, setOrdens] = useState<OrdensCompraResp | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [tipos, setTipos]   = useState<TipoLancamento[]>([])
  const [bancos, setBancos] = useState<Banco[]>([])
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [classificacoes, setClassificacoes] = useState<Classificacao[]>([])
  useEffect(() => {
    if (!token) return
    api.get<Classificacao[]>('/configuracoes/classificacoes', token).then(setClassificacoes).catch(() => { /* usa a lista padrão */ })
  }, [token])
  const [loadingDespesas, setLoadingDespesas] = useState(true)
  const [loadingReceitas, setLoadingReceitas] = useState(true)
  const [loadingOrdens, setLoadingOrdens] = useState(true)
  const [modalDespesa, setModalDespesa] = useState(false)
  const [modalReceita, setModalReceita] = useState(false)
  const [modalOrdem, setModalOrdem] = useState(false)
  const [modalImportar, setModalImportar] = useState(false)
  const [editandoDespesa, setEditandoDespesa] = useState<Despesa | null>(null)
  const [editandoReceita, setEditandoReceita]  = useState<Receita | null>(null)
  const [editandoOrdem, setEditandoOrdem] = useState<OrdemCompra | null>(null)
  // Exclusão simples (sem grupo): confirmação em diálogo. O Excluir fica no rodapé da modal.
  const [confirmando, setConfirmando] = useState<{ tipo: 'despesa' | 'receita' | 'ordem'; id: string; nome: string } | null>(null)
  const [deletando, setDeletando] = useState(false)
  // Empréstimo vinculado (0053): ao excluir, pergunta se leva o outro lado junto.
  const [vinculoExcl, setVinculoExcl] = useState<{ info: Vinculado; marcar: boolean } | null>(null)
  useEffect(() => {
    setVinculoExcl(null)
    if (!token || !confirmando || confirmando.tipo === 'ordem') return
    let vivo = true
    api.get<{ vinculado: Vinculado | null }>(`/lancamentos/vinculo/${confirmando.tipo === 'despesa' ? 'despesas' : 'receitas'}/${confirmando.id}`, token)
      .then(r => { if (vivo && r.vinculado) setVinculoExcl({ info: r.vinculado, marcar: true }) })
      .catch(() => {})
    return () => { vivo = false }
  }, [token, confirmando])
  // Seleção em lote (despesas e receitas da aba aberta).
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [marcando, setMarcando] = useState<{ ids: string[] } | null>(null)
  const [salvandoLote, setSalvandoLote] = useState(false)
  // Erro de AÇÃO (excluir) vai para toast; `erroLista` — erro de estado da tela,
  // com "Tentar novamente" — continua sendo banner no lugar do conteúdo.
  const toast = useToast()
  // Dialog para exclusão de parcelas/ocorrências futuras (parcelamento ou recorrência)
  const [dialogParcelas, setDialogParcelas] = useState<DialogGrupo | null>(null)
  const [dialogReceita, setDialogReceita] = useState<Receita | null>(null)

  // Ação principal na barra do topo: "+ Novo ▾" (redesenho UX, fase 1).
  const abrirNovo = useCallback((t: TipoNovo) => {
    if (t === 'despesa') { setAba('despesas'); setModalDespesa(true) }
    else if (t === 'receita') { setAba('receitas'); setModalReceita(true) }
    else if (t === 'ordem') { setAba('ordens'); setModalOrdem(true) }
    else setModalImportar(true)
  }, [])
  useTopBar({ acao: <MenuNovo onEscolher={abrirNovo} /> }, [abrirNovo])

  // "+ Lançar" da barra do celular: chega como ?novo=… (vindo de outra tela)
  // ou como evento (já nesta tela).
  useEffect(() => {
    const tipo = new URLSearchParams(window.location.search).get('novo')
    if (tipo === 'despesa' || tipo === 'receita' || tipo === 'ordem') {
      abrirNovo(tipo)
      window.history.replaceState(null, '', window.location.pathname)
    }
    const ouvir = (e: Event) => abrirNovo((e as CustomEvent<TipoNovo>).detail)
    window.addEventListener(EVENTO_NOVO, ouvir)
    return () => window.removeEventListener(EVENTO_NOVO, ouvir)
  }, [abrirNovo])

  // A busca vai para o servidor; sem o debounce seria uma requisição por tecla.
  const [buscaDebounced, setBuscaDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 350)
    return () => clearTimeout(t)
  }, [busca])

  const filtrosQuery = useCallback(() => {
    const params = new URLSearchParams({ inicio: filtro.inicio, fim: filtro.fim, base: filtro.base })
    if (filtroSubitem) params.set('tipo_lancamento_id', filtroSubitem)
    else if (filtroCategoria) params.set('categoria_id', filtroCategoria)
    if (filtroBanco)  params.set('banco_id', filtroBanco)
    if (filtroCentro) params.set('centro_custo', filtroCentro)
    if (buscaDebounced) params.set('q', buscaDebounced)
    params.set('ordenar_por', ordem.campo)
    params.set('ordem', ordem.dir)
    return params.toString()
  }, [filtro.inicio, filtro.fim, filtro.base, filtroBanco, filtroCentro, filtroCategoria, filtroSubitem, buscaDebounced, ordem])
  // O Exportar da barra do topo leva os filtros desta tela (fase 8).
  useEffect(() => {
    filtrosExport.lancamentos = filtrosQuery()
    return () => { filtrosExport.lancamentos = '' }
  }, [filtrosQuery])

  // Paginação server-side: busca em blocos de 200 em vez de baixar o período
  // inteiro de uma vez (com anos de recorrências, seriam milhares de linhas).
  const TAM_PAGINA_SRV = 200
  const qsDespesas = useCallback(
    () => `${filtrosQuery()}${situacaoDesp ? `&situacao=${situacaoDesp}` : ''}`, [filtrosQuery, situacaoDesp])
  const buscarDespesas = useCallback(() => {
    if (!token) return
    setLoadingDespesas(true)
    api.get<DespesasResp>(`/lancamentos/despesas?${qsDespesas()}&limit=${TAM_PAGINA_SRV}&offset=0`, token)
      .then(d => { setDespesas(d); setErroLista(null) })
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar lançamentos.'))
      .finally(() => setLoadingDespesas(false))
  }, [token, qsDespesas])

  const [carregandoMais, setCarregandoMais] = useState(false)
  function carregarMaisDespesas() {
    if (!token || !despesas) return
    setCarregandoMais(true)
    api.get<DespesasResp>(`/lancamentos/despesas?${qsDespesas()}&limit=${TAM_PAGINA_SRV}&offset=${despesas.items.length}`, token)
      .then(d => setDespesas(prev => prev ? { ...d, items: [...prev.items, ...d.items] } : d))
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar lançamentos.'))
      .finally(() => setCarregandoMais(false))
  }

  const buscarReceitas = useCallback(() => {
    if (!token) return
    setLoadingReceitas(true)
    const sit = situacaoRec ? `&situacao=${situacaoRec}` : ''
    api.get<ReceitasResp>(`/lancamentos/receitas?${filtrosQuery()}${sit}`, token)
      .then(r => { setReceitas(r); setErroLista(null) })
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar lançamentos.'))
      .finally(() => setLoadingReceitas(false))
  }, [token, filtrosQuery, situacaoRec])

  // Ordens de compra: filtradas só por período (banco/centro não se aplicam)
  const buscarOrdens = useCallback(() => {
    if (!token) return
    setLoadingOrdens(true)
    const { inicio, fim } = filtro
    const st = filtroStatus ? `&status=${filtroStatus}` : ''
    api.get<OrdensCompraResp>(`/ordens-compra?inicio=${inicio}&fim=${fim}${st}`, token)
      .then(o => { setOrdens(o); setErroLista(null) })
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar ordens de compra.'))
      .finally(() => setLoadingOrdens(false))
  }, [token, filtro.inicio, filtro.fim, filtroStatus])

  useEffect(() => { buscarDespesas() }, [buscarDespesas])
  useEffect(() => { buscarReceitas() }, [buscarReceitas])
  useEffect(() => { buscarOrdens() }, [buscarOrdens])

  useEffect(() => {
    if (!token) return
    Promise.all([
      api.get<Categoria[]>('/configuracoes/categorias', token),
      api.get<TipoLancamento[]>('/configuracoes/tipos', token),
      api.get<Banco[]>('/configuracoes/bancos', token),
      api.get<CentroCusto[]>('/configuracoes/centros-custo', token),
    ]).then(([c, t, b, cc]) => { setCategorias(c); setTipos(t); setBancos(b); setCentros(cc) })
      .catch(e => setErroLista(e instanceof Error
        ? `Falha ao carregar categorias, tipos e bancos: ${e.message}`
        : 'Falha ao carregar categorias, tipos e bancos.'))
  }, [token])


  // Despesas e receitas são buscadas e ordenadas pelo servidor — o que chega já
  // vem filtrado e na ordem certa, sobre o período inteiro e não só sobre a
  // página carregada. Ordens de compra continuam client-side (a API não expõe
  // busca para elas e o volume é pequeno).
  const termo = buscaDebounced.toLowerCase()
  const vazioDescricao = termo
    ? `Nenhum resultado para "${buscaDebounced}" neste período.`
    : undefined
  const despesasVisiveis = despesas?.items ?? []
  const receitasVisiveis = receitas?.items ?? []
  const ordensVisiveis = useMemo(() => {
    let items = ordens?.items ?? []
    if (termo) items = items.filter(o =>
      o.assunto.toLowerCase().includes(termo) ||
      o.descricao.toLowerCase().includes(termo) ||
      o.solicitante.toLowerCase().includes(termo))
    const mult = ordem.dir === 'asc' ? 1 : -1
    return [...items].sort((a, b) => {
      if (ordem.campo === 'valor') return (Number(a.valor ?? 0) - Number(b.valor ?? 0)) * mult
      const ka = ordem.campo === 'registro' ? (a.criado_em ?? a.data_solicitacao) : a.data_solicitacao
      const kb = ordem.campo === 'registro' ? (b.criado_em ?? b.data_solicitacao) : b.data_solicitacao
      return (ka ?? '').localeCompare(kb ?? '') * mult
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordens, termo, ordem])
  const somaOrdensVisiveis = ordensVisiveis.reduce((acc, o) => acc + Number(o.valor ?? 0), 0)

  // Exibição em blocos de 20, somando a cada clique em "Exibir Mais", tanto em
  // despesas quanto em receitas. Em despesas o servidor continua entregando
  // blocos de 200 (TAM_PAGINA_SRV): quando o limite visível ultrapassa o que já
  // foi baixado, o próximo bloco é buscado no mesmo clique. Manter o bloco do
  // servidor grande preserva o alcance da busca e da ordenação, que são
  // client-side — baixar de 20 em 20 reduziria esse alcance em 10x.
  const TAM_PAGINA = 20
  const [visLimite, setVisLimite] = useState(TAM_PAGINA)
  useEffect(() => { setVisLimite(TAM_PAGINA) }, [aba, termo, ordem, filtroBanco, filtroCentro, filtroStatus, situacaoDesp, situacaoRec, filtroCategoria, filtroSubitem, filtro.qs])

  // Filtro de Categoria só lista as categorias da aba aberta (há nomes repetidos
  // entre despesa e receita, ex.: "Empréstimo"). Ao trocar de aba, a categoria
  // da outra natureza é limpa — senão a lista nova voltaria vazia.
  const naturezaAba = aba === 'receitas' ? 'receita' : 'despesa'
  useEffect(() => {
    const cat = categorias.find(c => c.id === filtroCategoria)
    if (cat && cat.natureza !== naturezaAba) { setFiltroCategoria(''); setFiltroSubitem('') }
  }, [naturezaAba, filtroCategoria, categorias])
  const despesasPagina = despesasVisiveis.slice(0, visLimite)
  const receitasPagina = receitasVisiveis.slice(0, visLimite)
  const temMais = aba === 'despesas'
    ? (despesasPagina.length < despesasVisiveis.length ||
       (despesas ? despesas.items.length < despesas.total : false))
    : aba === 'receitas'
    ? receitasVisiveis.length > visLimite
    : false
  // `total` do servidor já considera a busca, então vale com ou sem termo.
  const restantes = aba === 'despesas'
    ? (despesas ? despesas.total - despesasPagina.length : 0)
    : aba === 'receitas'
    ? receitasVisiveis.length - visLimite
    : 0

  function exibirMais() {
    if (aba === 'receitas') { setVisLimite(l => l + TAM_PAGINA); return }
    const novoLimite = visLimite + TAM_PAGINA
    setVisLimite(novoLimite)
    // Só vai ao servidor quando o novo limite passa do que já está em memória
    if (despesas && novoLimite > despesas.items.length && despesas.items.length < despesas.total) {
      carregarMaisDespesas()
    }
  }

  function alternarOrdem(campo: OrdemCampo) {
    setOrdem(o => o.campo === campo ? { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'desc' })
  }
  function abrirDialogExclusao(d: Despesa) {
    if (d.parcela_total && d.parcela_total > 1) {
      setDialogParcelas({ id: d.id, grupo: 'parcelamento', total: d.parcela_total })
    } else if (d.recorrente) {
      setDialogParcelas({ id: d.id, grupo: 'recorrencia' })
    } else {
      setConfirmando({ tipo: 'despesa', id: d.id, nome: d.descricao })
    }
  }

  async function deletarDespesa(id: string, excluirFuturas = false, comVinculado = false) {
    if (!token) return
    setDeletando(true)
    try {
      const params: Record<string, string> = {}
      if (excluirFuturas) params.excluir_futuras = 'true'
      if (comVinculado) params.com_vinculado = 'true'
      await api.delete(`/lancamentos/despesas/${id}`, token, Object.keys(params).length ? params : undefined)
      if (comVinculado) buscarReceitas()
      setDespesas(prev => {
        if (!prev) return prev
        const despesaExcluida = prev.items.find(d => d.id === id)
        const ehParcelamento = !!(despesaExcluida?.parcela_total && despesaExcluida.parcela_total > 1)
        const ehRecorrencia  = !!despesaExcluida?.recorrente && !ehParcelamento
        // Se excluiu futuras, remove da lista todas as parcelas/ocorrências futuras do mesmo grupo
        const items = excluirFuturas && despesaExcluida && (ehParcelamento || ehRecorrencia)
          ? prev.items.filter(d => {
              if (d.id === id) return false
              if (d.tipo_lancamento_id !== despesaExcluida.tipo_lancamento_id) return true
              if (d.descricao !== despesaExcluida.descricao) return true
              if (ehParcelamento) {
                return !(
                  d.parcela_total === despesaExcluida.parcela_total &&
                  (despesaExcluida.parcela_atual == null || (d.parcela_atual ?? 0) > (despesaExcluida.parcela_atual ?? 0))
                )
              }
              return !(d.recorrente && !d.parcela_total && d.competencia > despesaExcluida.competencia)
            })
          : prev.items.filter(d => d.id !== id)
        const soma_total = items.reduce((acc, d) => acc + Number(d.valor), 0)
        // `total` é o total do PERÍODO no servidor, não o tamanho da página:
        // decrementa pelo que saiu, senão "Mostrar mais" some após uma exclusão.
        const total = Math.max(0, prev.total - (prev.items.length - items.length))
        return { ...prev, items, total, soma_total }
      })
      setConfirmando(null)
      setDialogParcelas(null)
      toast.sucesso(excluirFuturas ? 'Despesa e ocorrências futuras excluídas.' : 'Despesa excluída.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir despesa.')
      setConfirmando(null)
      setDialogParcelas(null)
    } finally {
      setDeletando(false)
    }
  }

  // Receita recorrente (repetir_ate) cria linhas irmãs sem marcador de grupo;
  // detecta irmãs futuras entre as receitas carregadas para oferecer o dialog.
  function abrirDialogExclusaoReceita(r: Receita) {
    const temIrmaFutura = r.origem === 'manual' && (receitas?.items ?? []).some(o =>
      o.id !== r.id && o.origem === 'manual' &&
      o.descricao === r.descricao &&
      o.tipo_lancamento_id === r.tipo_lancamento_id &&
      o.competencia > r.competencia
    )
    if (temIrmaFutura) {
      setDialogReceita(r)
    } else {
      setConfirmando({ tipo: 'receita', id: r.id, nome: r.descricao })
    }
  }

  async function deletarReceita(id: string, excluirFuturas = false, comVinculado = false) {
    if (!token) return
    setDeletando(true)
    try {
      const params: Record<string, string> = {}
      if (excluirFuturas) params.excluir_futuras = 'true'
      if (comVinculado) params.com_vinculado = 'true'
      await api.delete(`/lancamentos/receitas/${id}`, token, Object.keys(params).length ? params : undefined)
      if (comVinculado) buscarDespesas()
      setReceitas(prev => {
        if (!prev) return prev
        const excluida = prev.items.find(r => r.id === id)
        const items = excluirFuturas && excluida
          ? prev.items.filter(r =>
              r.id !== id && !(
                r.origem === 'manual' &&
                r.descricao === excluida.descricao &&
                r.tipo_lancamento_id === excluida.tipo_lancamento_id &&
                r.competencia > excluida.competencia
              ))
          : prev.items.filter(r => r.id !== id)
        // Receita "só DRE" fica fora do total, como no servidor.
        const soma_total = items.reduce((acc, r) => acc + (r.somente_dre ? 0 : Number(r.valor)), 0)
        const total = Math.max(0, prev.total - (prev.items.length - items.length))
        return { ...prev, items, total, soma_total }
      })
      setConfirmando(null)
      setDialogReceita(null)
      toast.sucesso(excluirFuturas ? 'Receita e ocorrências futuras excluídas.' : 'Receita excluída.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir receita.')
      setConfirmando(null)
      setDialogReceita(null)
    } finally {
      setDeletando(false)
    }
  }

  // Ordem de compra não tem parcelamento/recorrência — exclusão simples (só admin/gestor)
  async function deletarOrdem(id: string) {
    if (!token) return
    setDeletando(true)
    try {
      await api.delete(`/ordens-compra/${id}`, token)
      setOrdens(prev => {
        if (!prev) return prev
        const items = prev.items.filter(o => o.id !== id)
        const soma_total = items.reduce((acc, o) => acc + Number(o.valor ?? 0), 0)
        const total = Math.max(0, prev.total - (prev.items.length - items.length))
        return { ...prev, items, total, soma_total }
      })
      setConfirmando(null)
      toast.sucesso('Ordem de compra excluída.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir ordem de compra.')
      setConfirmando(null)
    } finally {
      setDeletando(false)
    }
  }

  // ── Categoria › Subitem ────────────────────────────────────
  const nomeCategoria = useMemo(() => new Map(categorias.map(c => [c.id, c.nome.trim()])), [categorias])
  const tipoPorId = useMemo(() => new Map(tipos.map(t => [t.id, t])), [tipos])
  const catSub = useCallback((tipoId: string | null, tipoNome: string | null) => {
    const t = tipoId ? tipoPorId.get(tipoId) : undefined
    const cat = t?.categoria_id ? nomeCategoria.get(t.categoria_id) : undefined
    const sub = t?.nome ?? tipoNome
    return cat && sub ? `${cat} › ${sub}` : (sub ?? cat ?? 'Sem subitem')
  }, [tipoPorId, nomeCategoria])

  // ── Seleção em lote ────────────────────────────────────────
  useEffect(() => { setSel(new Set()) }, [aba, filtrosQuery])
  const alternarSel = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const listaAba: (Despesa | Receita)[] = aba === 'despesas' ? despesasPagina : aba === 'receitas' ? receitasPagina : []
  const selecionados = listaAba.filter(i => sel.has(i.id))
  const totalSel = selecionados.reduce((acc, i) => acc + Number(i.valor), 0)
  const despesasParaPagar = (selecionados as Despesa[]).filter(d => !d.paga_em && !d.agregado && d.status !== 'rejeitada')
  const despesasParaRemessa = (selecionados as Despesa[]).filter(d => !d.paga_em && !d.agregado && d.status === 'aprovada')
  const receitasParaReceber = (selecionados as Receita[]).filter(selecionavelReceita)

  async function confirmarMarcacao(data: string) {
    if (!token || !marcando) return
    setSalvandoLote(true)
    const ehReceita = aba === 'receitas'
    const rota = ehReceita ? '/lancamentos/receitas' : '/lancamentos/despesas'
    const corpo = ehReceita ? { recebido_em: data } : { paga_em: data }
    const r = await Promise.allSettled(marcando.ids.map(id => api.patch(`${rota}/${id}`, token, corpo)))
    const falhas = r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')
    const ok = r.length - falhas.length
    setSalvandoLote(false)
    setMarcando(null)
    setSel(new Set())
    if (ok) toast.sucesso(`${qtd(ok, ehReceita ? 'receita marcada' : 'despesa marcada', ehReceita ? 'receitas marcadas' : 'despesas marcadas')} como ${ehReceita ? 'recebida' : 'paga'}${ok > 1 ? 's' : ''}.`)
    if (falhas.length) {
      const motivo = falhas[0].reason instanceof Error ? falhas[0].reason.message : ''
      toast.erro(`${qtd(falhas.length, 'não mudou', 'não mudaram')}${motivo ? `: ${motivo}` : '.'}`)
    }
    if (ehReceita) buscarReceitas(); else buscarDespesas()
  }

  function incluirNaRemessa() {
    const ids = despesasParaRemessa.map(d => d.id)
    if (!ids.length) return
    router.push(`/dashboard/lancamentos/pagamentos?incluir=${ids.join(',')}`)
  }

  // Empréstimo vinculado: troca o modal aberto pelo do outro lado.
  function abrirVinculado(tipo: 'despesa' | 'receita', item: Despesa | Receita) {
    setModalDespesa(false); setModalReceita(false)
    if (tipo === 'despesa') { setEditandoReceita(null); setAba('despesas'); setEditandoDespesa(item as Despesa) }
    else { setEditandoDespesa(null); setAba('receitas'); setEditandoReceita(item as Receita) }
  }

  // ── Excluir pela modal ─────────────────────────────────────
  function excluirDespesaDaModal(d: Despesa) { setEditandoDespesa(null); abrirDialogExclusao(d) }
  function excluirReceitaDaModal(r: Receita) { setEditandoReceita(null); abrirDialogExclusaoReceita(r) }
  function excluirOrdemDaModal(o: OrdemCompra) { setEditandoOrdem(null); setConfirmando({ tipo: 'ordem', id: o.id, nome: o.assunto }) }

  // ── Resumo da aba ──────────────────────────────────────────
  const hoje = hojeISO()
  const resumoReceitas = useMemo(() => {
    const r = { recebida: [0, 0], aReceber: [0, 0], atrasada: [0, 0] }
    for (const x of receitas?.items ?? []) {
      if (x.somente_dre) continue
      const k = x.recebido_em ? 'recebida' : (x.data_vencimento && x.data_vencimento.slice(0, 10) < hoje ? 'atrasada' : 'aReceber')
      r[k][0] += Number(x.valor); r[k][1] += 1
    }
    return r
  }, [receitas, hoje])
  const ordensPorStatus = useMemo(() => {
    const r: Record<string, [number, number]> = { pendente: [0, 0], aprovada: [0, 0], rejeitada: [0, 0] }
    for (const o of ordens?.items ?? []) { const k = r[o.status]; if (k) { k[0] += Number(o.valor ?? 0); k[1] += 1 } }
    return r
  }, [ordens])

  const ordenacao = { ativo: ordem.campo, dir: ordem.dir, alternar: alternarOrdem }
  const carregandoAba = aba === 'despesas' ? loadingDespesas : aba === 'receitas' ? loadingReceitas : loadingOrdens
  const totalAba = aba === 'despesas' ? (despesas?.total ?? 0) : aba === 'receitas' ? receitasVisiveis.length : ordensVisiveis.length
  const exibidosAba = aba === 'despesas' ? despesasPagina.length : aba === 'receitas' ? receitasPagina.length : ordensVisiveis.length
  const somaAba = aba === 'despesas' ? Number(despesas?.soma_total ?? 0) : aba === 'receitas' ? Number(receitas?.soma_total ?? 0) : somaOrdensVisiveis

  return (
    <>
      {(modalDespesa || editandoDespesa) && token && (
        <ModalDespesa
          token={token} categorias={categorias} tipos={tipos} bancos={bancos} centros={centros}
          despesa={editandoDespesa ?? undefined}
          mesDefault={mesInicio}
          onClose={() => { setModalDespesa(false); setEditandoDespesa(null) }}
          onSaved={() => { buscarDespesas(); buscarReceitas() }}
          classificacoes={classificacoes}
          onExcluir={editandoDespesa && podeExcluirLancamento(editandoDespesa, role, userId)
            ? () => excluirDespesaDaModal(editandoDespesa) : undefined}
          onAbrirVinculado={abrirVinculado}
        />
      )}
      {(modalReceita || editandoReceita) && token && (
        <ModalReceita
          token={token} categorias={categorias} tipos={tipos} bancos={bancos} centros={centros}
          classificacoes={classificacoes}
          receita={editandoReceita ?? undefined}
          mesDefault={mesInicio}
          onClose={() => { setModalReceita(false); setEditandoReceita(null) }}
          onSaved={() => { buscarReceitas(); buscarDespesas() }}
          onExcluir={editandoReceita ? () => excluirReceitaDaModal(editandoReceita) : undefined}
          onAbrirVinculado={abrirVinculado}
        />
      )}
      {(modalOrdem || editandoOrdem) && token && (
        <ModalOrdemCompra
          token={token}
          ordem={editandoOrdem ?? undefined}
          centros={centros}
          onClose={() => { setModalOrdem(false); setEditandoOrdem(null) }}
          onSaved={buscarOrdens}
          onExcluir={editandoOrdem && podeExcluirLancamento(editandoOrdem, role, userId)
            ? () => excluirOrdemDaModal(editandoOrdem) : undefined}
        />
      )}
      {modalImportar && token && (
        <ModalImportarExtrato
          token={token} bancos={bancos} centros={centros} tipos={tipos} categorias={categorias}
          onClose={() => setModalImportar(false)}
          onImported={() => { buscarDespesas(); buscarReceitas() }}
        />
      )}

      <ConfirmDialog
        open={!!confirmando}
        titulo={confirmando?.tipo === 'ordem' ? 'Excluir ordem de compra' : confirmando?.tipo === 'receita' ? 'Excluir receita' : 'Excluir despesa'}
        mensagem={<>Excluir <strong>{confirmando?.nome}</strong>? Esta ação não pode ser desfeita.</>}
        loading={deletando}
        onCancelar={() => setConfirmando(null)}
        onConfirmar={() => {
          if (!confirmando) return
          const comVinculado = !!vinculoExcl?.marcar
          if (confirmando.tipo === 'despesa') deletarDespesa(confirmando.id, false, comVinculado)
          else if (confirmando.tipo === 'receita') deletarReceita(confirmando.id, false, comVinculado)
          else deletarOrdem(confirmando.id)
        }}
      >
        {vinculoExcl && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
            <input type="checkbox" checked={vinculoExcl.marcar}
              onChange={e => setVinculoExcl(v => v && { ...v, marcar: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
            <span>
              Excluir também a {vinculoExcl.info.tipo} vinculada <strong>&quot;{vinculoExcl.info.descricao}&quot;</strong> ({fmtBRL(vinculoExcl.info.valor)}).
              {!vinculoExcl.marcar && <span className="block text-xs text-indigo-700">Ela fica no sistema, sem vínculo.</span>}
            </span>
          </label>
        )}
      </ConfirmDialog>

      {/* Dialog: excluir parcelas/ocorrências futuras de despesa */}
      <DialogExcluirGrupo
        open={!!dialogParcelas}
        titulo="Excluir lançamento"
        labelSomenteEsta={dialogParcelas?.grupo === 'parcelamento' ? 'Só esta parcela' : 'Só esta ocorrência'}
        mensagem={dialogParcelas?.grupo === 'parcelamento'
          ? <>Esta despesa faz parte de um grupo de <strong>{dialogParcelas.total} parcelas</strong>. Deseja excluir também as parcelas futuras?</>
          : <>Esta despesa é <strong>recorrente</strong>. Deseja excluir também as ocorrências dos meses futuros?</>}
        excluindo={deletando}
        onCancelar={() => { setDialogParcelas(null); setConfirmando(null) }}
        onExcluir={(futuras) => dialogParcelas && deletarDespesa(dialogParcelas.id, futuras)}
      />

      {/* Dialog: excluir ocorrências futuras de receita recorrente */}
      <DialogExcluirGrupo
        open={!!dialogReceita}
        titulo="Excluir receita"
        labelSomenteEsta="Só esta ocorrência"
        mensagem={<>Esta receita é <strong>recorrente</strong>. Deseja excluir também as ocorrências dos meses futuros?</>}
        excluindo={deletando}
        onCancelar={() => setDialogReceita(null)}
        onExcluir={(futuras) => dialogReceita && deletarReceita(dialogReceita.id, futuras)}
      />

      {marcando && (
        <DialogMarcar key={marcando.ids.join()} open n={marcando.ids.length} receita={aba === 'receitas'} loading={salvandoLote}
          onCancelar={() => setMarcando(null)} onConfirmar={confirmarMarcacao} />
      )}

      <div className="space-y-4">
        <Tabs
          idPrefix="lanc"
          variante="pagina"
          ativa={aba}
          onChange={setAba}
          items={[
            { key: 'despesas' as const, label: 'Despesas', contador: despesas?.total ?? null },
            { key: 'receitas' as const, label: 'Receitas', contador: receitas?.total ?? null },
            { key: 'ordens'   as const, label: 'Ordens de compra', labelCurto: 'Ordens', contador: ordens?.total ?? null },
          ]}
        />

        {/* Resumo da aba aberta (sem repetir os totais das outras abas) */}
        <div data-tour="resumo" className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
          {carregandoAba ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />) : aba === 'despesas' ? (
            <>
              <CartaoResumo titulo="Total no período" valor={Number(despesas?.soma_total ?? 0)} sub={qtd(despesas?.total ?? 0, 'despesa', 'despesas')} />
              <CartaoResumo titulo="Pagas" valor={Number(despesas?.soma_paga ?? 0)} sub={qtd(despesas?.qtd_paga ?? 0, 'despesa', 'despesas')} />
              <CartaoResumo titulo="A pagar" valor={Number(despesas?.soma_a_pagar ?? 0)} sub={qtd(despesas?.qtd_a_pagar ?? 0, 'despesa', 'despesas')} />
              <CartaoResumo titulo="Vencidas" valor={Number(despesas?.soma_vencida ?? 0)} sub={qtd(despesas?.qtd_vencida ?? 0, 'despesa', 'despesas')}
                tom={(despesas?.qtd_vencida ?? 0) > 0 ? 'alerta' : 'neutro'} />
            </>
          ) : aba === 'receitas' ? (
            <>
              <CartaoResumo titulo="Total no período" valor={Number(receitas?.soma_total ?? 0)} corValor="text-green-700"
                sub={qtd(receitas?.total ?? 0, 'receita', 'receitas')} />
              <CartaoResumo titulo="Recebidas" valor={resumoReceitas.recebida[0]} sub={qtd(resumoReceitas.recebida[1], 'receita', 'receitas')} tom="positivo" />
              <CartaoResumo titulo="A receber" valor={resumoReceitas.aReceber[0]} sub={qtd(resumoReceitas.aReceber[1], 'receita', 'receitas')} />
              <CartaoResumo titulo="Atrasadas" valor={resumoReceitas.atrasada[0]} sub={qtd(resumoReceitas.atrasada[1], 'receita', 'receitas')}
                tom={resumoReceitas.atrasada[1] > 0 ? 'alerta' : 'neutro'} />
            </>
          ) : (
            <>
              <CartaoResumo titulo="Total no período" valor={Number(ordens?.soma_total ?? 0)} sub={qtd(ordens?.total ?? 0, 'ordem', 'ordens')} />
              <CartaoResumo titulo="Aguardando aprovação" valor={ordensPorStatus.pendente[0]} sub={qtd(ordensPorStatus.pendente[1], 'ordem', 'ordens')} />
              <CartaoResumo titulo="Aprovadas" valor={ordensPorStatus.aprovada[0]} sub={qtd(ordensPorStatus.aprovada[1], 'ordem', 'ordens')} />
              <CartaoResumo titulo="Rejeitadas" valor={ordensPorStatus.rejeitada[0]} sub={qtd(ordensPorStatus.rejeitada[1], 'ordem', 'ordens')} />
            </>
          )}
        </div>

        {/* Pendentes de aprovação — só para quem aprova */}
        {podeAprovar && aba === 'despesas' && (despesas?.total_pendentes ?? 0) > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
            <p className="text-sm text-amber-900">
              <strong>{qtd(despesas!.total_pendentes, 'despesa aguarda', 'despesas aguardam')}</strong> aprovação neste período.
            </p>
            <Link href="/dashboard/lancamentos/aprovacoes"
              className="focus-ring inline-flex h-11 items-center rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100">
              Ver aprovações
            </Link>
          </div>
        )}

        {erroLista && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{erroLista}</span>
            <button
              onClick={() => { setErroLista(null); buscarDespesas(); buscarReceitas(); buscarOrdens() }}
              className="focus-ring h-11 shrink-0 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-800 hover:bg-red-100">
              Tentar novamente
            </button>
          </div>
        )}

        <section data-tour="tabela" id={`lanc-painel-${aba}`} aria-labelledby={`lanc-${aba}`}
          className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {/* Filtros à vista: busca + chips (no celular, linha que rola de lado) */}
          <div data-tour="filtros" className="flex flex-col gap-2 border-b border-gray-200 px-3 py-3 md:flex-row md:flex-wrap md:items-center md:px-4">
            <label className="relative block md:w-72">
              <span className="sr-only">Buscar</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
              <input type="search" value={busca} onChange={e => setBusca(e.target.value)}
                placeholder={aba === 'ordens' ? 'Buscar ordem ou quem pediu' : 'Buscar descrição'}
                className={`${FILTRO_CAMPO} w-full pl-9`} />
            </label>
            <div className="-mx-3 flex items-center gap-2 overflow-x-auto px-3 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:p-0">
              {aba !== 'ordens' && (
                <>
                  <ChipSelect rotulo="Categoria" valor={filtroCategoria} onChange={v => { setFiltroCategoria(v); setFiltroSubitem('') }}
                    opcoes={categorias.filter(c => c.natureza === naturezaAba && c.ativo).map(c => ({ valor: c.id, texto: c.nome.trim() }))} />
                  <ChipSelect rotulo="Subitem" valor={filtroSubitem} onChange={setFiltroSubitem} disabled={!filtroCategoria} vazio="Subitem"
                    opcoes={tipos.filter(t => t.categoria_id === filtroCategoria).map(t => ({ valor: t.id, texto: t.nome }))} />
                  <ChipSelect rotulo="Banco" valor={filtroBanco} onChange={setFiltroBanco}
                    opcoes={bancos.map(b => ({ valor: b.id, texto: b.nome }))} />
                  <ChipSelect rotulo="Centro" valor={filtroCentro} onChange={setFiltroCentro} opcoes={opcoesCentroFiltro(centros)} />
                </>
              )}
              {aba === 'ordens' && (
                <ChipSelect rotulo="Status" valor={filtroStatus} onChange={setFiltroStatus}
                  opcoes={[{ valor: 'pendente', texto: 'Aguardando aprovação' }, { valor: 'aprovada', texto: 'Aprovada' }, { valor: 'rejeitada', texto: 'Rejeitada' }]} />
              )}
              {filtrosAtivos > 0 && (
                <button type="button" onClick={limparFiltros}
                  className="focus-ring h-12 shrink-0 whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-sel hover:underline md:h-11">
                  Limpar filtros
                </button>
              )}
            </div>
            {aba === 'despesas' && (
              <div className="md:basis-full">
                <BarraSituacao opcoes={OPCOES_DESPESA} valor={situacaoDesp} onChange={setSituacaoDesp}
                  contagem={despesas?.contagem_situacao} />
              </div>
            )}
            {aba === 'receitas' && (
              <div className="md:basis-full">
                <BarraSituacao opcoes={OPCOES_RECEITA} valor={situacaoRec} onChange={setSituacaoRec}
                  contagem={receitas?.contagem_situacao} />
              </div>
            )}
          </div>

          {aba === 'despesas' && (
            <BarraLote n={selecionados.length} total={totalSel} onLimpar={() => setSel(new Set())}>
              <button type="button" className={botaoLote} disabled={!despesasParaPagar.length}
                onClick={() => setMarcando({ ids: despesasParaPagar.map(d => d.id) })}>
                Marcar como paga{despesasParaPagar.length !== selecionados.length && despesasParaPagar.length ? ` (${despesasParaPagar.length})` : ''}
              </button>
              {podeRemessa && (
                <button type="button" className={botaoLotePrimario} disabled={!despesasParaRemessa.length} onClick={incluirNaRemessa}
                  title="Leva as despesas aprovadas e em aberto para a tela Pagamentos, já escolhidas">
                  Incluir na remessa{despesasParaRemessa.length !== selecionados.length && despesasParaRemessa.length ? ` (${despesasParaRemessa.length})` : ''}
                </button>
              )}
            </BarraLote>
          )}
          {aba === 'receitas' && (
            <BarraLote n={selecionados.length} total={totalSel} onLimpar={() => setSel(new Set())}>
              <button type="button" className={botaoLotePrimario} disabled={!receitasParaReceber.length}
                onClick={() => setMarcando({ ids: receitasParaReceber.map(r => r.id) })}>
                Marcar como recebida
              </button>
            </BarraLote>
          )}

          {carregandoAba ? (
            <div className="p-5"><Skeleton variant="table" /></div>
          ) : aba === 'despesas' ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <TabelaDespesas itens={despesasPagina} centros={centros} catSub={catSub} anexos={anexosDesp}
                  sel={sel} onSel={alternarSel} onSelTodos={ids => setSel(new Set(ids))} onAbrir={setEditandoDespesa}
                  ord={ordenacao} campoVenc="vencimento" campoValor="valor"
                  vazio={{ titulo: 'Nenhuma despesa no período', descricao: vazioDescricao }} />
              </div>
              <div className="md:hidden">
                <CartoesDespesas itens={despesasPagina} centros={centros} catSub={catSub} anexos={anexosDesp}
                  sel={sel} onSel={alternarSel} onSelTodos={ids => setSel(new Set(ids))} onAbrir={setEditandoDespesa}
                  onMarcar={d => setMarcando({ ids: [d.id] })} ord={ordenacao}
                  vazio={{ titulo: 'Nenhuma despesa no período', descricao: vazioDescricao }} />
              </div>
            </>
          ) : aba === 'receitas' ? (
            <>
              <div className="hidden overflow-x-auto md:block">
                <TabelaReceitas itens={receitasPagina} centros={centros} catSub={catSub} anexos={anexosRec}
                  sel={sel} onSel={alternarSel} onSelTodos={ids => setSel(new Set(ids))} onAbrir={setEditandoReceita}
                  ord={ordenacao} campoReceb="pagamento" campoValor="valor"
                  vazio={{ titulo: 'Nenhuma receita no período', descricao: vazioDescricao }} />
              </div>
              <div className="md:hidden">
                <CartoesReceitas itens={receitasPagina} centros={centros} catSub={catSub} anexos={anexosRec}
                  sel={sel} onSel={alternarSel} onSelTodos={ids => setSel(new Set(ids))} onAbrir={setEditandoReceita}
                  onMarcar={r => setMarcando({ ids: [r.id] })} ord={ordenacao}
                  vazio={{ titulo: 'Nenhuma receita no período', descricao: vazioDescricao }} />
              </div>
            </>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <TabelaOrdens itens={ordensVisiveis} centros={centros} onAbrir={setEditandoOrdem}
                  ord={ordenacao} campoData="competencia" campoValor="valor"
                  vazio={{ titulo: 'Nenhuma ordem de compra no período', descricao: vazioDescricao }} />
              </div>
              <div className="md:hidden">
                <CartoesOrdens itens={ordensVisiveis} centros={centros} onAbrir={setEditandoOrdem}
                  vazio={{ titulo: 'Nenhuma ordem de compra no período', descricao: vazioDescricao }} />
              </div>
            </>
          )}

          {/* Rodapé: quanto aparece, total filtrado e "Exibir mais" (blocos de 20) */}
          {!carregandoAba && totalAba > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-slate-600">
              <span>
                Mostrando {exibidosAba} de {totalAba}{filtrosAtivos || buscaDebounced ? ' com o filtro' : ''} · Total
                {' '}<b className={`tabular-nums ${aba === 'receitas' ? 'text-green-700' : 'text-slate-900'}`}>{fmtBRL(somaAba)}</b>
              </span>
              {temMais && (
                <button type="button" disabled={carregandoMais} onClick={exibirMais}
                  className="focus-ring h-11 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-gray-50 disabled:opacity-50">
                  {carregandoMais ? 'Carregando…' : `Exibir mais (${restantes} restantes)`}
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
