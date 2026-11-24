'use client'
import { OpcoesCentro, nomeCentro } from '@/lib/centros'
import { MarcaAnexos, useContagemAnexos } from '@/components/anexos/CampoAnexos'
import { FILTRO_BOTAO, FILTRO_CAMPO } from '@/components/ui/filtros'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { api } from '@/lib/api'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { fmtBRL, fmtData } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { Tabs } from '@/components/ui/Tabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { ModalDespesa } from './_components/ModalDespesa'
import { ModalReceita } from './_components/ModalReceita'
import { ModalOrdemCompra } from './_components/ModalOrdemCompra'
import { ModalImportarExtrato } from './_components/ModalImportarExtrato'
import { DialogExcluirGrupo } from './_components/DialogExcluirGrupo'
import {
  Badge, StatusBadge, IconLapis, IconLixo, fmtCompetencia, tipoCor,
  type Categoria, type TipoLancamento, type Banco, type CentroCusto, type Despesa, type DespesasResp,
  type Receita, type ReceitasResp, type OrdemCompra, type OrdensCompraResp, podeExcluirLancamento,
  type Classificacao } from './_components/shared'

interface DialogGrupo { id: string; grupo: 'parcelamento' | 'recorrencia'; total?: number }

// Campos ordenáveis. 'registro' = data de criação (último registrado primeiro)
type OrdemCampo = 'registro' | 'competencia' | 'vencimento' | 'pagamento' | 'valor'

// ── Página principal ───────────────────────────────────────────
export default function LancamentosPage() {
  const { token } = useAuth()
  const { role, userId } = useUser()
  const podeAprovar = role === 'admin' || role === 'gestor'
  // Periodo compartilhado entre telas (ver contexts/PeriodoContext.tsx).
  const periodo = usePeriodo()
  const { mesInicio } = periodo
  // Dia | Mês (De/Até) | Ano | Período — todos pela Data de Pagamento (em aberto, pelo vencimento).
  const filtro = filtroDoPeriodo(periodo, true)
  const [filtroBanco, setFiltroBanco] = useState('')
  const [filtroCentro, setFiltroCentro] = useState('')
  // Vale para as três abas (despesas, receitas e ordens de compra).
  const [filtroStatus, setFiltroStatus] = useState('')
  // Filtro "Tipo" (22/10/2026): Categoria e, opcionalmente, Subitem.
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [filtroSubitem, setFiltroSubitem] = useState('')
  // Banco, centro, status e tipo ficam num painel que abre pelo ícone de filtro.
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const filtrosAtivos = [filtroCategoria, filtroBanco, filtroCentro, filtroStatus].filter(Boolean).length
  function limparFiltros() {
    setFiltroCategoria(''); setFiltroSubitem(''); setFiltroBanco(''); setFiltroCentro(''); setFiltroStatus('')
  }
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<{ campo: OrdemCampo; dir: 'asc' | 'desc' }>({ campo: 'registro', dir: 'desc' })
  const [aba, setAba] = useState<'despesas' | 'receitas' | 'ordens'>('despesas')
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
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [deletando, setDeletando] = useState(false)
  // Erro de AÇÃO (excluir) vai para toast; `erroLista` — erro de estado da tela,
  // com "Tentar novamente" — continua sendo banner no lugar do conteúdo.
  const toast = useToast()
  // Dialog para exclusão de parcelas/ocorrências futuras (parcelamento ou recorrência)
  const [dialogParcelas, setDialogParcelas] = useState<DialogGrupo | null>(null)
  const [dialogReceita, setDialogReceita] = useState<Receita | null>(null)

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
    if (filtroStatus) params.set('status', filtroStatus)
    if (buscaDebounced) params.set('q', buscaDebounced)
    params.set('ordenar_por', ordem.campo)
    params.set('ordem', ordem.dir)
    return params.toString()
  }, [filtro.inicio, filtro.fim, filtro.base, filtroBanco, filtroCentro, filtroStatus, filtroCategoria, filtroSubitem, buscaDebounced, ordem])

  // Paginação server-side: busca em blocos de 200 em vez de baixar o período
  // inteiro de uma vez (com anos de recorrências, seriam milhares de linhas).
  const TAM_PAGINA_SRV = 200
  const buscarDespesas = useCallback(() => {
    if (!token) return
    setLoadingDespesas(true)
    api.get<DespesasResp>(`/lancamentos/despesas?${filtrosQuery()}&limit=${TAM_PAGINA_SRV}&offset=0`, token)
      .then(d => { setDespesas(d); setErroLista(null) })
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar lançamentos.'))
      .finally(() => setLoadingDespesas(false))
  }, [token, filtrosQuery])

  const [carregandoMais, setCarregandoMais] = useState(false)
  function carregarMaisDespesas() {
    if (!token || !despesas) return
    setCarregandoMais(true)
    api.get<DespesasResp>(`/lancamentos/despesas?${filtrosQuery()}&limit=${TAM_PAGINA_SRV}&offset=${despesas.items.length}`, token)
      .then(d => setDespesas(prev => prev ? { ...d, items: [...prev.items, ...d.items] } : d))
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar lançamentos.'))
      .finally(() => setCarregandoMais(false))
  }

  const buscarReceitas = useCallback(() => {
    if (!token) return
    setLoadingReceitas(true)
    api.get<ReceitasResp>(`/lancamentos/receitas?${filtrosQuery()}`, token)
      .then(r => { setReceitas(r); setErroLista(null) })
      .catch(e => setErroLista(e instanceof Error ? e.message : 'Erro ao carregar lançamentos.'))
      .finally(() => setLoadingReceitas(false))
  }, [token, filtrosQuery])

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

  const totalDespesas = despesas?.soma_total ?? 0
  const totalReceitas = receitas?.soma_total ?? 0
  const saldo = totalReceitas - totalDespesas

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
  useEffect(() => { setVisLimite(TAM_PAGINA) }, [aba, termo, ordem, filtroBanco, filtroCentro, filtroStatus, filtroCategoria, filtroSubitem, filtro.qs])

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
  // Soma apenas das linhas na tela. O card do topo continua mostrando o total do
  // período inteiro (soma_total do servidor) — os dois números são diferentes de
  // propósito, por isso o rótulo aqui é "Total exibido".
  const somaDespesasExibidas = despesasPagina.reduce((acc, d) => acc + Number(d.valor), 0)
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
  const setaOrdem = (campo: OrdemCampo) =>
    ordem.campo === campo ? (ordem.dir === 'asc' ? ' ↑' : ' ↓') : ''

  /** Cabeçalho ordenável: o clique fica num <button>, não no <th>, para que a
   *  ordenação seja alcançável por teclado e anunciada via `aria-sort`. */
  function ThOrdenavel({ campo, children, alinhar = 'left' }: {
    campo: OrdemCampo
    children: React.ReactNode
    alinhar?: 'left' | 'right'
  }) {
    return (
      <th
        scope="col"
        aria-sort={ordem.campo === campo ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`px-4 py-2 ${alinhar === 'right' ? 'text-right' : ''}`}
      >
        <button type="button" onClick={() => alternarOrdem(campo)}
          className="focus-ring select-none rounded font-medium hover:text-gray-700">
          {children}{setaOrdem(campo)}
        </button>
      </th>
    )
  }

  function abrirDialogExclusao(d: Despesa) {
    if (d.parcela_total && d.parcela_total > 1) {
      setDialogParcelas({ id: d.id, grupo: 'parcelamento', total: d.parcela_total })
    } else if (d.recorrente) {
      setDialogParcelas({ id: d.id, grupo: 'recorrencia' })
    } else {
      setConfirmandoId(d.id)
    }
  }

  async function deletarDespesa(id: string, excluirFuturas = false) {
    if (!token) return
    setDeletando(true)
    try {
      const params = excluirFuturas ? { excluir_futuras: 'true' } : undefined
      await api.delete(`/lancamentos/despesas/${id}`, token, params)
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
      setConfirmandoId(null)
      setDialogParcelas(null)
      toast.sucesso(excluirFuturas ? 'Despesa e ocorrências futuras excluídas.' : 'Despesa excluída.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir despesa.')
      setConfirmandoId(null)
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
      setConfirmandoId(r.id)
    }
  }

  async function deletarReceita(id: string, excluirFuturas = false) {
    if (!token) return
    setDeletando(true)
    try {
      const params = excluirFuturas ? { excluir_futuras: 'true' } : undefined
      await api.delete(`/lancamentos/receitas/${id}`, token, params)
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
      setConfirmandoId(null)
      setDialogReceita(null)
      toast.sucesso(excluirFuturas ? 'Receita e ocorrências futuras excluídas.' : 'Receita excluída.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir receita.')
      setConfirmandoId(null)
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
      setConfirmandoId(null)
      toast.sucesso('Ordem de compra excluída.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir ordem de compra.')
      setConfirmandoId(null)
    } finally {
      setDeletando(false)
    }
  }

  return (
    <>
      {(modalDespesa || editandoDespesa) && token && (
        <ModalDespesa
          token={token} categorias={categorias} tipos={tipos} bancos={bancos} centros={centros}
          despesa={editandoDespesa ?? undefined}
          mesDefault={mesInicio}
          onClose={() => { setModalDespesa(false); setEditandoDespesa(null) }}
          onSaved={buscarDespesas}
          classificacoes={classificacoes}
        />
      )}
      {(modalReceita || editandoReceita) && token && (
        <ModalReceita
          token={token} categorias={categorias} tipos={tipos} bancos={bancos} centros={centros}
          classificacoes={classificacoes}
          receita={editandoReceita ?? undefined}
          mesDefault={mesInicio}
          onClose={() => { setModalReceita(false); setEditandoReceita(null) }}
          onSaved={buscarReceitas}
        />
      )}
      {(modalOrdem || editandoOrdem) && token && (
        <ModalOrdemCompra
          token={token}
          ordem={editandoOrdem ?? undefined}
          onClose={() => { setModalOrdem(false); setEditandoOrdem(null) }}
          onSaved={buscarOrdens}
        />
      )}
      {modalImportar && token && (
        <ModalImportarExtrato
          token={token} bancos={bancos} centros={centros} tipos={tipos} categorias={categorias}
          onClose={() => setModalImportar(false)}
          onImported={() => { buscarDespesas(); buscarReceitas() }}
        />
      )}

      {/* Dialog: excluir parcelas/ocorrências futuras de despesa */}
      <DialogExcluirGrupo
        open={!!dialogParcelas}
        titulo="Excluir lançamento"
        labelSomenteEsta={dialogParcelas?.grupo === 'parcelamento' ? 'Só esta parcela' : 'Só esta ocorrência'}
        mensagem={dialogParcelas?.grupo === 'parcelamento'
          ? <>Esta despesa faz parte de um grupo de <strong>{dialogParcelas.total} parcelas</strong>. Deseja excluir também as parcelas futuras?</>
          : <>Esta despesa é <strong>recorrente</strong>. Deseja excluir também as ocorrências dos meses futuros?</>}
        excluindo={deletando}
        onCancelar={() => { setDialogParcelas(null); setConfirmandoId(null) }}
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

      <div className="space-y-6">
        {/* Cabeçalho */}
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-lg font-bold text-navy md:text-xl">Lançamentos</h1>
            <p className="mt-0.5 text-xs text-gray-500">Despesas e receitas por centro de custo e banco</p>
          </div>
          {/* Filtros + ações numa linha só a partir de telas médias (fonte 11px). */}
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <SeletorPeriodo intervaloMeses className="lg:flex-nowrap" />
            <div data-tour="novos-lancamentos" className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:flex-nowrap">
              <button
                data-tour="importar"
                onClick={() => setModalImportar(true)}
                title="Importar extrato bancário"
                className="flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-gray-300 bg-white h-8 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:flex-none">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Importar
              </button>
              <button
                onClick={() => { setAba('despesas'); setModalDespesa(true) }}
                className="flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-red-600 h-8 px-3 text-xs font-medium text-white hover:bg-red-700 transition-colors sm:flex-none">
                + Despesa
              </button>
              <button
                onClick={() => { setAba('receitas'); setModalReceita(true) }}
                className="flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-green-600 h-8 px-3 text-xs font-medium text-white hover:bg-green-700 transition-colors sm:flex-none">
                + Receita
              </button>
              <button
                onClick={() => { setAba('ordens'); setModalOrdem(true) }}
                title="Nova Ordem de Compra"
                className="flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-md bg-navy h-8 px-3 text-xs font-medium text-white hover:bg-navy-light transition-colors sm:flex-none">
                + Ordem
              </button>
            </div>
          </div>
        </div>

        {/* Cards resumo */}
        <div data-tour="resumo" className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="rounded-2xl bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-center gap-2">
              <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 sm:flex">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-red-500">
                  <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>
                </svg>
              </div>
              <p className="text-[10px] font-medium text-gray-500 sm:text-xs">Total Despesas</p>
            </div>
            {loadingDespesas
              ? <Skeleton className="mt-1.5 h-4 w-full sm:h-5" />
              : <p className="mt-1 text-xs font-bold tabular-nums text-red-500 sm:text-base">{fmtBRL(totalDespesas)}</p>}
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-center gap-2">
              <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-green-50 sm:flex">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-green-500">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
                </svg>
              </div>
              <p className="text-[10px] font-medium text-gray-500 sm:text-xs">Total Receitas</p>
            </div>
            {loadingReceitas
              ? <Skeleton className="mt-1.5 h-4 w-full sm:h-5" />
              : <p className="mt-1 text-xs font-bold tabular-nums text-green-600 sm:text-base">{fmtBRL(totalReceitas)}</p>}
          </div>
          <div className="rounded-2xl bg-white p-3 shadow-sm sm:p-4">
            <div className="flex items-center gap-2">
              <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 sm:flex">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-blue-600">
                  <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <p className="text-[10px] font-medium text-gray-500 sm:text-xs">Saldo do Período</p>
            </div>
            {loadingDespesas || loadingReceitas
              ? <Skeleton className="mt-1.5 h-4 w-full sm:h-5" />
              : <p className={`mt-1 text-xs font-bold tabular-nums sm:text-base ${saldo >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmtBRL(saldo)}</p>}
          </div>
        </div>

        {/* Banner de pendentes — visível apenas para quem pode aprovar */}
        {podeAprovar && (despesas?.total_pendentes ?? 0) > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span><strong>{despesas!.total_pendentes}</strong> despesa{despesas!.total_pendentes > 1 ? 's' : ''} aguardando aprovação</span>
            </div>
            <Link href="/dashboard/lancamentos/aprovacoes"
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
              Ver Kanban →
            </Link>
          </div>
        )}

        {/* Erro ao carregar listas */}
        {erroLista && (
          <div className="flex items-center justify-between rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            <span>{erroLista}</span>
            <button
              onClick={() => { setErroLista(null); buscarDespesas(); buscarReceitas() }}
              className="ml-4 shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
              Tentar novamente
            </button>
          </div>
        )}

        {/* Tabela */}
        <div data-tour="tabela" className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <Tabs
              idPrefix="lanc"
              ativa={aba}
              onChange={setAba}
              className="border-b-0"
              items={[
                { key: 'despesas' as const, label: `Despesas${despesas ? ` (${despesas.total})` : ''}` },
                { key: 'receitas' as const, label: `Receitas${receitas ? ` (${receitas.total})` : ''}` },
                { key: 'ordens'   as const, label: `Ordens de Compra${ordens ? ` (${ordens.total})` : ''}` },
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar por descrição…"
                className={`${FILTRO_CAMPO} w-full sm:w-56`}
              />
              <button type="button" data-tour="filtros" onClick={() => setFiltrosAbertos(v => !v)}
                aria-expanded={filtrosAbertos} aria-controls="painel-filtros"
                className={`${FILTRO_BOTAO} ${filtrosAbertos || filtrosAtivos > 0 ? '!border-navy !text-navy' : ''}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Filtros
                {filtrosAtivos > 0 && (
                  <span className="rounded-full bg-navy px-1.5 text-[10px] font-semibold text-white">{filtrosAtivos}</span>
                )}
              </button>
            </div>
          </div>

          {filtrosAbertos && (
            <div id="painel-filtros" className="grid grid-cols-1 gap-2 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:grid-cols-3 sm:px-5 lg:grid-cols-5">
              <select value={filtroCategoria} onChange={e => { setFiltroCategoria(e.target.value); setFiltroSubitem('') }}
                aria-label="Categoria" className={`${FILTRO_CAMPO} w-full ${filtroCategoria ? '!border-navy font-medium !text-navy' : ''}`}>
                <option value="">{naturezaAba === 'receita' ? 'Todas as categorias de receita' : 'Todas as categorias de despesa'}</option>
                {categorias.filter(c => c.natureza === naturezaAba && c.ativo).map(c => <option key={c.id} value={c.id}>{c.nome.trim()}</option>)}
              </select>
              <select value={filtroSubitem} onChange={e => setFiltroSubitem(e.target.value)} disabled={!filtroCategoria}
                aria-label="Subitem" className={`${FILTRO_CAMPO} w-full ${filtroSubitem ? '!border-navy font-medium !text-navy' : ''}`}>
                <option value="">{filtroCategoria ? 'Todos os subitens' : 'Escolha a categoria primeiro'}</option>
                {tipos.filter(t => t.categoria_id === filtroCategoria).map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
              <select value={filtroBanco} onChange={e => setFiltroBanco(e.target.value)}
                aria-label="Banco" className={`${FILTRO_CAMPO} w-full ${filtroBanco ? '!border-navy font-medium !text-navy' : ''}`}>
                <option value="">Todos os bancos</option>
                {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
              </select>
              <select value={filtroCentro} onChange={e => setFiltroCentro(e.target.value)}
                aria-label="Centro de custo" className={`${FILTRO_CAMPO} w-full ${filtroCentro ? '!border-navy font-medium !text-navy' : ''}`}>
                <option value="">Todos os centros</option>
                <OpcoesCentro centros={centros} filtro />
              </select>
              <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                aria-label="Status" className={`${FILTRO_CAMPO} w-full ${filtroStatus ? '!border-navy font-medium !text-navy' : ''}`}>
                <option value="">Todos os status</option>
                <option value="pendente">Pendente</option>
                <option value="aprovada">Aprovada</option>
                <option value="rejeitada">Rejeitada</option>
              </select>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400 sm:col-span-3 lg:col-span-5">
                <span>Categoria e Subitem filtram despesas e receitas; não se aplicam a Ordens de Compra.</span>
                {filtrosAtivos > 0 && (
                  <button type="button" onClick={limparFiltros} className="font-medium text-navy hover:underline">Limpar filtros</button>
                )}
              </div>
            </div>
          )}

          {(aba === 'despesas' ? loadingDespesas : aba === 'receitas' ? loadingReceitas : loadingOrdens) ? (
            <div className="p-5"><Skeleton variant="table" /></div>
          ) : aba === 'despesas' ? (
            <>
              {/* Mobile: card list */}
              <div className="divide-y divide-gray-50 sm:hidden">
                {despesasVisiveis.length === 0 ? (
                  <EmptyState titulo="Nenhuma despesa no período" descricao={vazioDescricao} />
                ) : despesasPagina.map((d) => (
                  <div key={d.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-800">
                          {d.descricao}<MarcaAnexos n={anexosDesp[d.id]} />
                          {d.parcela_total && d.parcela_total > 1 && (
                            <span className="ml-2 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">parcela {d.parcela_atual}/{d.parcela_total}</span>
                          )}
                          {d.recorrente && !d.parcela_total && (
                            <span className="ml-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">recorrente</span>
                          )}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge text={d.tipo_nome ?? d.categoria ?? '—'} cor={tipoCor(d.tipo_nome ?? d.categoria)} />
                          <StatusBadge status={d.status} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold tabular-nums text-red-500">{fmtBRL(d.valor)}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{fmtCompetencia(d.competencia)}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-xs text-gray-400 capitalize">
                        {nomeCentro(d.centro_custo, centros)}
                        {d.banco_nome ? ` · ${d.banco_nome}` : ''}
                        {d.data_vencimento ? ` · Vence ${fmtData(d.data_vencimento)}` : ''}
                        {d.paga_em ? ` · Pagamento ${fmtData(d.paga_em)}` : ''}
                      </p>
                      {confirmandoId === d.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button onClick={() => deletarDespesa(d.id)} disabled={deletando}
                            className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                            {deletando ? 'Excluindo…' : 'Confirmar'}
                          </button>
                          <span className="text-gray-300">|</span>
                          <button onClick={() => setConfirmandoId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <button onClick={() => setEditandoDespesa(d)} className="focus-ring rounded text-gray-300 transition-colors hover:text-blue-500" aria-label={`Editar despesa ${d.descricao}`}><IconLapis /></button>
                          {podeExcluirLancamento(d, role, userId) && (
                            <button onClick={() => abrirDialogExclusao(d)} className="focus-ring rounded text-gray-300 transition-colors hover:text-red-400" aria-label={`Excluir despesa ${d.descricao}`}><IconLixo /></button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {somaDespesasExibidas > 0 && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-semibold text-gray-700">Total exibido ({despesasPagina.length})</span>
                    <span className="text-sm font-bold tabular-nums text-red-500">{fmtBRL(somaDespesasExibidas)}</span>
                  </div>
                )}
              </div>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-[11px] font-medium text-gray-500">
                      <ThOrdenavel campo="competencia">Competência</ThOrdenavel>
                      <th className="px-4 py-2">Tipo</th>
                      <th className="px-4 py-2">Descrição</th>
                      <th className="px-4 py-2">Centro</th>
                      <th className="px-4 py-2">Banco</th>
                      <ThOrdenavel campo="valor" alinhar="right">Valor</ThOrdenavel>
                      <ThOrdenavel campo="vencimento">Vencimento</ThOrdenavel>
                      <ThOrdenavel campo="pagamento">Data de Pagamento</ThOrdenavel>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {despesasPagina.map((d) => (
                      <tr key={d.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-600">{fmtCompetencia(d.competencia)}</td>
                        <td className="px-4 py-2"><Badge text={d.tipo_nome ?? d.categoria ?? '—'} cor={tipoCor(d.tipo_nome ?? d.categoria)} /></td>
                        <td className="px-4 py-2 text-gray-700">
                          <span>{d.descricao}</span><MarcaAnexos n={anexosDesp[d.id]} />
                          {d.parcela_total && d.parcela_total > 1 && (
                            <span
                              className="ml-2 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600"
                              title={`Parcela ${d.parcela_atual} de ${d.parcela_total}`}
                            >
                              parcela {d.parcela_atual}/{d.parcela_total}
                            </span>
                          )}
                          {d.recorrente && !d.parcela_total && (
                            <span className="ml-1.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">recorrente</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{nomeCentro(d.centro_custo, centros)}</td>
                        <td className="px-4 py-2 text-gray-600">{d.banco_nome ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-red-500">{fmtBRL(d.valor)}</td>
                        <td className="px-4 py-2 text-gray-400">{fmtData(d.data_vencimento)}</td>
                        <td className="px-4 py-2 text-gray-400">{fmtData(d.paga_em)}</td>
                        <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                        <td className="px-3 py-2 text-right">
                          {confirmandoId === d.id ? (
                            <span className="inline-flex items-center gap-2">
                              <button onClick={() => deletarDespesa(d.id)} disabled={deletando}
                                className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                                {deletando ? 'Excluindo…' : 'Confirmar'}
                              </button>
                              <span className="text-gray-300">|</span>
                              <button onClick={() => setConfirmandoId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <button onClick={() => setEditandoDespesa(d)} className="text-gray-300 hover:text-blue-500 transition-colors" title="Editar"><IconLapis /></button>
                              {podeExcluirLancamento(d, role, userId) && (
                            <button onClick={() => abrirDialogExclusao(d)} className="text-gray-300 hover:text-red-400 transition-colors" title="Excluir"><IconLixo /></button>
                          )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {despesasVisiveis.length === 0 && (
                      <tr><td colSpan={10}><EmptyState titulo="Nenhuma despesa no período" descricao={vazioDescricao} /></td></tr>
                    )}
                  </tbody>
                  {somaDespesasExibidas > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-100">
                        <td colSpan={5} className="px-4 py-2 font-semibold text-gray-700">Total exibido ({despesasPagina.length})</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-red-500">{fmtBRL(somaDespesasExibidas)}</td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          ) : aba === 'receitas' ? (
            <>
              {/* Mobile: card list */}
              <div className="divide-y divide-gray-50 sm:hidden">
                {receitasVisiveis.length === 0 ? (
                  <EmptyState titulo="Nenhuma receita no período" descricao={vazioDescricao} />
                ) : receitasPagina.map((r) => (
                  <div key={r.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-800">{r.descricao}<MarcaAnexos n={anexosRec[r.id]} /></p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge text={r.tipo_nome ?? '—'} cor="bg-green-100 text-green-700" />
                          {r.somente_dre && <Badge text="Só DRE" cor="bg-indigo-100 text-indigo-700" />}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold tabular-nums text-green-600">{fmtBRL(r.valor)}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{fmtCompetencia(r.competencia)}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-xs text-gray-400 capitalize">
                        {r.centro_custo ? nomeCentro(r.centro_custo, centros) : ''}
                        {r.banco_nome ? ` · ${r.banco_nome}` : ''}
                        {r.recebido_em ? ` · Pagamento ${fmtData(r.recebido_em)}` : ''}
                      </p>
                      {confirmandoId === r.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button onClick={() => deletarReceita(r.id)} disabled={deletando}
                            className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                            {deletando ? 'Excluindo…' : 'Confirmar'}
                          </button>
                          <span className="text-gray-300">|</span>
                          <button onClick={() => setConfirmandoId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          {r.origem === 'manual' && (
                            <button onClick={() => setEditandoReceita(r)} className="focus-ring rounded text-gray-300 transition-colors hover:text-blue-500" aria-label={`Editar receita ${r.descricao}`}><IconLapis /></button>
                          )}
                          <button onClick={() => abrirDialogExclusaoReceita(r)} className="focus-ring rounded text-gray-300 transition-colors hover:text-red-400" aria-label={`Excluir receita ${r.descricao}`}><IconLixo /></button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-[11px] font-medium text-gray-500">
                      <ThOrdenavel campo="competencia">Competência</ThOrdenavel>
                      <th className="px-4 py-2">Tipo</th>
                      <th className="px-4 py-2">Descrição</th>
                      <th className="px-4 py-2">Centro</th>
                      <th className="px-4 py-2">Banco</th>
                      <ThOrdenavel campo="valor" alinhar="right">Valor</ThOrdenavel>
                      <ThOrdenavel campo="pagamento">Data de Pagamento</ThOrdenavel>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {receitasPagina.map((r) => (
                      <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-600">{fmtCompetencia(r.competencia)}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex flex-wrap gap-1">
                            <Badge text={r.tipo_nome ?? '—'} cor="bg-green-100 text-green-700" />
                            {r.somente_dre && <Badge text="Só DRE" cor="bg-indigo-100 text-indigo-700" />}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-700">{r.descricao}<MarcaAnexos n={anexosRec[r.id]} /></td>
                        <td className="px-4 py-2 text-gray-600">{nomeCentro(r.centro_custo, centros)}</td>
                        <td className="px-4 py-2 text-gray-600">{r.banco_nome ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-green-600">{fmtBRL(r.valor)}</td>
                        <td className="px-4 py-2 text-gray-400">{fmtData(r.recebido_em)}</td>
                        <td className="px-3 py-2 text-right">
                          {confirmandoId === r.id ? (
                            <span className="inline-flex items-center gap-2">
                              <button onClick={() => deletarReceita(r.id)} disabled={deletando}
                                className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                                {deletando ? 'Excluindo…' : 'Confirmar'}
                              </button>
                              <span className="text-gray-300">|</span>
                              <button onClick={() => setConfirmandoId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              {r.origem === 'manual' && (
                                <button onClick={() => setEditandoReceita(r)} className="focus-ring rounded text-gray-300 transition-colors hover:text-blue-500" aria-label={`Editar receita ${r.descricao}`}><IconLapis /></button>
                              )}
                              <button onClick={() => abrirDialogExclusaoReceita(r)} className="focus-ring rounded text-gray-300 transition-colors hover:text-red-400" aria-label={`Excluir receita ${r.descricao}`}><IconLixo /></button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {receitasVisiveis.length === 0 && (
                      <tr><td colSpan={8}><EmptyState titulo="Nenhuma receita no período" descricao={vazioDescricao} /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="divide-y divide-gray-50 sm:hidden">
                {ordensVisiveis.length === 0 ? (
                  <EmptyState titulo="Nenhuma ordem de compra no período" descricao={vazioDescricao} />
                ) : ordensVisiveis.map((o) => (
                  <div key={o.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-gray-800">{o.assunto}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={o.status} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold tabular-nums text-navy">{o.valor != null ? fmtBRL(o.valor) : '—'}</p>
                        <p className="mt-0.5 text-[10px] text-gray-400">{fmtData(o.data_solicitacao)}</p>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">{o.descricao}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-xs text-gray-400">Solicitante: {o.solicitante}</p>
                      {confirmandoId === o.id ? (
                        <span className="inline-flex items-center gap-2">
                          <button onClick={() => deletarOrdem(o.id)} disabled={deletando}
                            className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                            {deletando ? 'Excluindo…' : 'Confirmar'}
                          </button>
                          <span className="text-gray-300">|</span>
                          <button onClick={() => setConfirmandoId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <button onClick={() => setEditandoOrdem(o)} className="focus-ring rounded text-gray-300 transition-colors hover:text-blue-500" aria-label={`Editar ordem de compra ${o.assunto}`}><IconLapis /></button>
                          {podeExcluirLancamento(o, role, userId) && (
                            <button onClick={() => setConfirmandoId(o.id)} className="focus-ring rounded text-gray-300 transition-colors hover:text-red-400" aria-label={`Excluir ordem de compra ${o.assunto}`}><IconLixo /></button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {somaOrdensVisiveis > 0 && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm font-semibold text-gray-700">Total</span>
                    <span className="text-sm font-bold tabular-nums text-navy">{fmtBRL(somaOrdensVisiveis)}</span>
                  </div>
                )}
              </div>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-[11px] font-medium text-gray-500">
                      <ThOrdenavel campo="competencia">Data Solicitação</ThOrdenavel>
                      <th className="px-4 py-2">Assunto</th>
                      <th className="px-4 py-2">Solicitante</th>
                      <th className="px-4 py-2">Descrição</th>
                      <ThOrdenavel campo="valor" alinhar="right">Valor</ThOrdenavel>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {ordensVisiveis.map((o) => (
                      <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-600">{fmtData(o.data_solicitacao)}</td>
                        <td className="px-4 py-2 text-gray-700">{o.assunto}</td>
                        <td className="px-4 py-2 text-gray-600">{o.solicitante}</td>
                        <td className="px-4 py-2 text-gray-700">{o.descricao}</td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums text-navy">{o.valor != null ? fmtBRL(o.valor) : '—'}</td>
                        <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                        <td className="px-3 py-2 text-right">
                          {confirmandoId === o.id ? (
                            <span className="inline-flex items-center gap-2">
                              <button onClick={() => deletarOrdem(o.id)} disabled={deletando}
                                className="text-xs font-medium text-red-500 hover:text-red-700 disabled:opacity-50">
                                {deletando ? 'Excluindo…' : 'Confirmar'}
                              </button>
                              <span className="text-gray-300">|</span>
                              <button onClick={() => setConfirmandoId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <button onClick={() => setEditandoOrdem(o)} className="focus-ring rounded text-gray-300 transition-colors hover:text-blue-500" aria-label={`Editar ordem de compra ${o.assunto}`}><IconLapis /></button>
                              {podeExcluirLancamento(o, role, userId) && (
                                <button onClick={() => setConfirmandoId(o.id)} className="focus-ring rounded text-gray-300 transition-colors hover:text-red-400" aria-label={`Excluir ordem de compra ${o.assunto}`}><IconLixo /></button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {ordensVisiveis.length === 0 && (
                      <tr><td colSpan={7}><EmptyState titulo="Nenhuma ordem de compra no período" descricao={vazioDescricao} /></td></tr>
                    )}
                  </tbody>
                  {somaOrdensVisiveis > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-100">
                        <td colSpan={4} className="px-4 py-2 font-semibold text-gray-700">Total</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-navy">{fmtBRL(somaOrdensVisiveis)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}

          {/* Paginação: renderiza em blocos para não travar com listas longas */}
          {temMais && (
            <div className="border-t border-gray-100 px-4 py-3 text-center">
              <button
                disabled={carregandoMais}
                onClick={exibirMais}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {carregandoMais ? 'Carregando…' : `Exibir Mais (${restantes} restantes)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
