'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { api, API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'
import { permissaoRelatorios } from '@/types'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FILTRO_BOTAO, FILTRO_CAMPO, FILTRO_GRUPO, filtroSegmento } from '@/components/ui/filtros'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { Construtor } from './_components/Construtor'
import { Detalhe, TabelaDinamica } from './_components/TabelaDinamica'
import { Grafico, legendaGrafico } from './_components/Grafico'
import { DialogoSalvar, MenuAbrir, type RelatorioSalvo, type SalvosResp } from './_components/Salvos'
import { EdicaoLancamento, useEdicaoLancamento } from './_components/EdicaoLancamento'
import { PERIODOS_RELATIVOS, filtroDoRelatorio, periodoAnterior } from './_components/periodo'
import {
  CAMPO, CAMPOS_DATA, GRANULARIDADES, MAX_LINHAS_TELA, MODELOS, chaveCaminho, copiaConfig, dadosGrafico, granularidade,
  lancamentosDaCelula, linhasBase, montarTabela, rotuloCampo, tabelaTSV,
  type Config, type Fonte, type Lancamento, type Ordem, type PeriodoRel, type PeriodoRelativo, type Visao,
} from './_components/pivot'

interface DadosResp {
  inicio: string
  fim: string
  total: number
  despesas_ocultas: boolean
  itens: Lancamento[]
}

const FONTES: [Fonte, string][] = [['despesa', 'Despesas'], ['receita', 'Receitas'], ['ambos', 'Ambos']]
const VISOES: [Visao, string][] = [['tabela', 'Tabela'], ['grafico', 'Gráfico'], ['ambos', 'Ambos']]
const ORDENS: [Ordem, string][] = [['rotulo', 'Ordem: A–Z'], ['maior', 'Ordem: maior valor'], ['menor', 'Ordem: menor valor']]

// Abre no último relatório usado (só neste navegador): a configuração e, se
// era um relatório salvo, qual — para o "Salvar" continuar atualizando o mesmo.
const CHAVE_ULTIMO = 'relatorios.ultimo.v2'
interface Ultimo { cfg: Config; atualId: string | null; alterado: boolean }

function configValida(c: unknown): c is Config {
  const x = c as Config | null
  return !!x && Array.isArray(x.linhas) && Array.isArray(x.colunas) && Array.isArray(x.valores) && !!x.filtros
}

/** Descarta campos que não existem mais (configs salvas por versões antigas). */
function limpar(c: Config): Config {
  const valido = (f: string) => f in CAMPO
  return {
    ...copiaConfig(c),
    fonte: ['despesa', 'receita', 'ambos'].includes(c.fonte) ? c.fonte : 'despesa',
    linhas: c.linhas.filter(valido),
    colunas: c.colunas.filter(valido),
    valores: c.valores.filter(v => valido(v.f)),
    filtros: Object.fromEntries(Object.entries(c.filtros).filter(([k]) => valido(k))),
  }
}

function lerUltimo(): Ultimo | null {
  try {
    const u = JSON.parse(window.localStorage.getItem(CHAVE_ULTIMO) ?? 'null')
    if (u && configValida(u.cfg)) return { cfg: limpar(u.cfg), atualId: u.atualId ?? null, alterado: !!u.alterado }
  } catch { /* sem storage: começa no primeiro modelo */ }
  return null
}

function guardar(c: Config, atualId: string | null, alterado: boolean) {
  try { window.localStorage.setItem(CHAVE_ULTIMO, JSON.stringify({ cfg: c, atualId, alterado })) } catch { /* idem */ }
}

/** O que vai para o banco: a configuração sem o nome (que tem coluna própria). */
function configParaSalvar(c: Config): Omit<Config, 'nome'> {
  const { nome: _ignorado, ...resto } = c // eslint-disable-line @typescript-eslint/no-unused-vars
  return resto
}

const IconSwap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4" /></svg>
)

export default function RelatoriosPage() {
  const { token } = useAuth()
  const { role, permissions } = useUser()
  const toast = useToast()
  const daTela = filtroDoPeriodo(usePeriodo(), true)

  const [cfg, setCfgBruto] = useState<Config>(() => copiaConfig(MODELOS[0]))
  const [atual, setAtual] = useState<RelatorioSalvo | null>(null)
  const [alterado, setAlterado] = useState(false)
  const pendenteId = useRef<string | null>(null)

  const [salvos, setSalvos] = useState<SalvosResp | null>(null)
  const [dados, setDados] = useState<Lancamento[]>([])
  const [anteriores, setAnteriores] = useState<Lancamento[] | null>(null)
  const [despesasOcultas, setDespesasOcultas] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const [detalhe, setDetalhe] = useState<{ caminho: string[]; col: number } | null>(null)
  const [exportando, setExportando] = useState(false)
  const [dialogo, setDialogo] = useState<'novo' | 'renomear' | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erroDialogo, setErroDialogo] = useState<string | null>(null)
  const [excluir, setExcluir] = useState(false)

  const podeCriar = salvos?.pode_criar ?? permissaoRelatorios(permissions, role, 'criar')
  const podeCompartilhar = salvos?.pode_compartilhar ?? permissaoRelatorios(permissions, role, 'compartilhar')
  const salvarDisponivel = salvos?.disponivel !== false
  const meuSalvo = !!atual?.meu

  const filtro = filtroDoRelatorio(cfg.periodo, daTela)
  const filtroAnt = periodoAnterior(filtro)

  // ── Configuração ──────────────────────────────────────────
  useEffect(() => {
    const u = lerUltimo()
    if (u) { setCfgBruto(u.cfg); setAlterado(u.alterado); pendenteId.current = u.atualId }
  }, [])

  const setCfg = useCallback((c: Config) => {
    setCfgBruto(c)
    setAlterado(true)
    setDetalhe(null)
    guardar(c, atual?.id ?? null, true)
  }, [atual])

  const abrir = (c: Config, salvo: RelatorioSalvo | null) => {
    const limpo = limpar({ ...c, nome: salvo?.nome ?? c.nome })
    setCfgBruto(limpo)
    setAtual(salvo)
    setAlterado(false)
    setFechados(new Set())
    setDetalhe(null)
    guardar(limpo, salvo?.id ?? null, false)
  }

  // ── Dados ─────────────────────────────────────────────────
  const buscarSalvos = useCallback(() => {
    if (!token) return
    api.get<SalvosResp>('/relatorios', token)
      .then(r => {
        setSalvos(r)
        if (pendenteId.current) {
          setAtual(r.itens.find(i => i.id === pendenteId.current) ?? null)
          pendenteId.current = null
        }
      })
      .catch(() => setSalvos(null))
  }, [token])

  useEffect(() => { buscarSalvos() }, [buscarSalvos])

  // Reflete na lista do menu na hora (sem esperar o recarregamento em segundo plano).
  const aplicarNaLista = (mudar: (itens: RelatorioSalvo[]) => RelatorioSalvo[]) => {
    setSalvos(s => (s ? { ...s, itens: mudar(s.itens).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) } : s))
    buscarSalvos()
  }

  const buscar = useCallback(() => {
    if (!token) return
    setLoading(true); setErro(null); setDetalhe(null)
    api.get<DadosResp>(`/relatorios/dados?${filtro.qs}&fonte=ambos`, token)
      .then(r => { setDados(r.itens); setDespesasOcultas(r.despesas_ocultas) })
      .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar os lançamentos.'))
      .finally(() => setLoading(false))
  }, [token, filtro.qs])

  useEffect(() => { buscar() }, [buscar])

  const comparar = !!cfg.comparar
  const [versaoAnt, setVersaoAnt] = useState(0)
  useEffect(() => {
    if (!token || !comparar) { setAnteriores(null); return }
    let vivo = true
    setAnteriores(null)
    api.get<DadosResp>(`/relatorios/dados?${filtroAnt.qs}&fonte=ambos`, token)
      .then(r => { if (vivo) setAnteriores(r.itens) })
      .catch(e => { if (vivo) toast.erro(e instanceof Error ? e.message : 'Erro ao carregar o período anterior.') })
    return () => { vivo = false }
  }, [token, comparar, filtroAnt.qs, versaoAnt]) // eslint-disable-line react-hooks/exhaustive-deps

  const edicao = useEdicaoLancamento(token, toast.erro)

  // ── Cálculo ───────────────────────────────────────────────
  const daFonte = useMemo(() => linhasBase(dados, { ...cfg, filtros: {} }), [dados, cfg])
  const base = useMemo(() => linhasBase(dados, cfg), [dados, cfg])
  const baseAnt = useMemo(() => (comparar && anteriores ? linhasBase(anteriores, cfg) : null), [comparar, anteriores, cfg])
  const tabela = useMemo(
    () => cfg.valores.length ? montarTabela(base, cfg, fechados, MAX_LINHAS_TELA, baseAnt) : null,
    [base, cfg, fechados, baseAnt],
  )
  const visao = cfg.visao ?? 'tabela'
  const grafico = useMemo(() => (visao !== 'tabela' ? dadosGrafico(base, cfg) : null), [visao, base, cfg])

  const alternar = (caminho: string[]) => setFechados(prev => {
    const k = chaveCaminho(caminho)
    const s = new Set(prev)
    if (s.has(k)) s.delete(k)
    else s.add(k)
    return s
  })

  const detalheInfo = useMemo(() => {
    if (!detalhe || !tabela) return null
    const rows = lancamentosDaCelula(base, cfg, tabela, detalhe.caminho, detalhe.col)
    const col = detalhe.col >= 0 ? tabela.colunas[detalhe.col]?.rotulo : ''
    const linha = detalhe.caminho.map((k, i) => rotuloCampo(cfg, cfg.linhas[i], k)).join(' › ')
    return { rows, titulo: [linha, col].filter(Boolean).join(' · ') || 'Total geral' }
  }, [detalhe, tabela, base, cfg])

  // ── Salvar ────────────────────────────────────────────────
  async function salvar() {
    if (!token) return
    if (!atual?.meu) { setErroDialogo(null); setDialogo('novo'); return }
    setSalvando(true)
    try {
      const r = await api.patch<RelatorioSalvo>(`/relatorios/${atual.id}`, token, { config: configParaSalvar(cfg) })
      const novo = { ...atual, ...r, meu: true }
      setAtual(novo)
      setAlterado(false)
      guardar(cfg, atual.id, false)
      toast.sucesso(`"${atual.nome}" salvo.`)
      aplicarNaLista(itens => itens.map(i => (i.id === novo.id ? novo : i)))
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function confirmarDialogo(nome: string, compartilhado: boolean) {
    if (!token) return
    const renomeando = dialogo === 'renomear' && atual
    setSalvando(true); setErroDialogo(null)
    try {
      const r = renomeando
        ? await api.patch<RelatorioSalvo>(`/relatorios/${atual.id}`, token, { nome, compartilhado })
        : await api.post<RelatorioSalvo>('/relatorios', token, { nome, compartilhado, config: configParaSalvar(cfg) })
      const novo = { ...cfg, nome: r.nome }
      const continuaAlterado = renomeando ? alterado : false
      const salvo = { ...r, meu: true }
      setCfgBruto(novo)
      setAtual(salvo)
      setAlterado(continuaAlterado)
      guardar(novo, r.id, continuaAlterado)
      setDialogo(null)
      toast.sucesso(renomeando ? 'Relatório atualizado.' : `"${r.nome}" salvo em Meus relatórios.`)
      aplicarNaLista(itens => [...itens.filter(i => i.id !== salvo.id), salvo])
    } catch (e) {
      setErroDialogo(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function confirmarExcluir() {
    if (!token || !atual) return
    setSalvando(true)
    try {
      await api.delete(`/relatorios/${atual.id}`, token)
      toast.sucesso(`"${atual.nome}" excluído.`)
      setAtual(null)
      setAlterado(true)
      guardar(cfg, null, true)
      setExcluir(false)
      aplicarNaLista(itens => itens.filter(i => i.id !== atual.id))
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir.')
    } finally {
      setSalvando(false)
    }
  }

  // ── Copiar / exportar ─────────────────────────────────────
  async function copiar() {
    if (!cfg.valores.length) return
    try {
      await navigator.clipboard.writeText(tabelaTSV(montarTabela(base, cfg, fechados, Infinity, baseAnt)))
      toast.sucesso('Tabela copiada. Cole no Excel ou no WhatsApp.')
    } catch {
      toast.erro('O navegador não permitiu copiar. Use Exportar Excel.')
    }
  }

  async function exportar() {
    if (!token || !cfg.valores.length) return
    const t = montarTabela(base, cfg, fechados, Infinity, baseAnt)
    setExportando(true)
    try {
      const res = await fetch(`${API_BASE}/relatorios/exportar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          titulo: cfg.nome,
          subtitulo: `${filtro.rotulo} · ${FONTES.find(f => f[0] === cfg.fonte)?.[1]} · ${base.length} lançamentos` +
            (baseAnt ? ` · comparado com ${filtroAnt.rotulo}` : ''),
          cabecalho: [t.titulo, ...t.cabecalho],
          linhas: t.linhas.map(l => ({
            rotulo: l.rotulo, nivel: l.nivel, tipo: l.tipo,
            valores: l.celulas.map(c => c.valor), formatos: l.celulas.map(c => (c.formato === 'var' ? 'pct' : c.formato)),
          })),
          lancamentos: base.map(r => ({
            data: r.data, tipo: r.tipo, descricao: r.descricao, categoria: r.categoria, subitem: r.subitem,
            classificacao: r.classificacao, banco: r.banco, centro: r.centro, status: r.status, valor: r.valor,
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${cfg.nome} - ${filtro.rotulo}.xlsx`.replace(/[\\/:*?"<>|]/g, '-')
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao exportar.')
    } finally {
      setExportando(false)
    }
  }

  // ── Período ───────────────────────────────────────────────
  const modoPeriodo = cfg.periodo?.modo === 'relativo' ? cfg.periodo.rel : cfg.periodo?.modo ?? 'tela'
  const mudarPeriodo = (v: string) => {
    let periodo: PeriodoRel
    if (v === 'tela') periodo = { modo: 'tela' }
    else if (v === 'fixo') periodo = { modo: 'fixo', inicio: filtro.inicio, fim: filtro.fim }
    else periodo = { modo: 'relativo', rel: v as PeriodoRelativo }
    setCfg({ ...cfg, periodo })
  }

  const nomeGranularidade = (g: string) => GRANULARIDADES.find(x => x[0] === g)?.[1].toLowerCase()
  const nomeCampo = (f: (typeof cfg.linhas)[number]) =>
    CAMPO[f].nome + (CAMPOS_DATA.has(f) && granularidade(cfg, f) !== 'mes' ? ` (${nomeGranularidade(granularidade(cfg, f))})` : '')
  const temDataNasLinhas = cfg.linhas.some(f => CAMPOS_DATA.has(f))
  const resumo = `${base.length} lançamento${base.length === 1 ? '' : 's'} · ${cfg.linhas.map(nomeCampo).join(' › ') || 'sem linhas'}` +
    (cfg.colunas.length ? ' × ' + cfg.colunas.map(nomeCampo).join(' › ') : '')

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-navy md:text-2xl">Relatórios</h1>
          <p className="mt-0.5 truncate text-sm text-gray-500">
            <strong className="font-medium text-gray-700">{cfg.nome}</strong>
            {atual && !atual.meu && <span className="text-gray-400"> · de {atual.dono_nome ?? 'outro usuário'}</span>}
            {atual?.meu && atual.compartilhado && <span className="text-gray-400"> · compartilhado com a equipe</span>}
            {alterado && atual && <span className="text-amber-600"> · alterações não salvas</span>}
            {' · '}{filtro.rotulo}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={modoPeriodo} onChange={e => mudarPeriodo(e.target.value)} className={FILTRO_CAMPO} aria-label="Período do relatório"
            title="Seguir o seletor usa o mesmo período das outras telas; um período relativo se atualiza sozinho">
            <option value="tela">Período: seguir o seletor</option>
            {PERIODOS_RELATIVOS.map(([v, n]) => <option key={v} value={v}>Período: {n.toLowerCase()}</option>)}
            <option value="fixo">Período: fixo{cfg.periodo?.modo === 'fixo' ? ` (${filtro.rotulo})` : ' (o atual)'}</option>
          </select>
          {modoPeriodo === 'tela' && <SeletorPeriodo intervaloMeses />}
          <div className={FILTRO_GRUPO} role="group" aria-label="Fonte">
            {FONTES.map(([f, n]) => (
              <button key={f} type="button" aria-pressed={cfg.fonte === f} onClick={() => setCfg({ ...cfg, fonte: f })} className={filtroSegmento(cfg.fonte === f)}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex flex-wrap items-center gap-2">
        <MenuAbrir salvos={salvos} atualId={atual?.id ?? null} onSalvo={r => abrir(r.config, r)} onModelo={m => abrir(m, null)} />
        {podeCriar && (
          <>
            <button type="button" onClick={salvar} disabled={!salvarDisponivel || salvando || (meuSalvo && !alterado)}
              title={salvarDisponivel ? (meuSalvo ? 'Atualiza o relatório salvo' : 'Guarda em Meus relatórios') : salvos?.aviso ?? ''}
              className={FILTRO_BOTAO}>
              {salvando && !dialogo ? 'Salvando…' : meuSalvo ? 'Salvar' : 'Salvar…'}
            </button>
            {meuSalvo && (
              <>
                <button type="button" onClick={() => { setErroDialogo(null); setDialogo('novo') }} disabled={!salvarDisponivel} className={FILTRO_BOTAO}>Salvar como…</button>
                <button type="button" onClick={() => { setErroDialogo(null); setDialogo('renomear') }} className={FILTRO_BOTAO}>
                  {podeCompartilhar ? 'Renomear / compartilhar' : 'Renomear'}
                </button>
                <button type="button" onClick={() => setExcluir(true)} className={cn(FILTRO_BOTAO, 'text-red-600 hover:bg-red-50')}>Excluir</button>
              </>
            )}
          </>
        )}
        <span className="mx-1 hidden h-5 w-px bg-gray-200 sm:block" />
        <button type="button" onClick={() => setCfg({ ...cfg, linhas: cfg.colunas, colunas: cfg.linhas })} className={FILTRO_BOTAO} title="Troca linhas e colunas">
          <IconSwap /> Inverter
        </button>
        <select value={cfg.ordem ?? 'rotulo'} onChange={e => setCfg({ ...cfg, ordem: e.target.value as Ordem })} className={FILTRO_CAMPO} aria-label="Ordenar linhas">
          {ORDENS.map(([o, n]) => <option key={o} value={o}>{n}</option>)}
        </select>
        <label className={cn(FILTRO_BOTAO, 'cursor-pointer', comparar && 'border-navy text-navy')} title={`Mostra o valor de ${filtroAnt.rotulo} e a variação`}>
          <input type="checkbox" checked={comparar} onChange={e => setCfg({ ...cfg, comparar: e.target.checked })} className="accent-navy" />
          Comparar com anterior
        </label>
        {tabela && tabela.grupos.length > 0 && visao !== 'grafico' && (
          <button type="button" className={FILTRO_BOTAO}
            onClick={() => setFechados(fechados.size ? new Set() : new Set(tabela.grupos.map(chaveCaminho)))}>
            {fechados.size ? 'Expandir tudo' : 'Recolher tudo'}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={copiar} disabled={!tabela} className={FILTRO_BOTAO}>Copiar tabela</button>
        <button
          type="button" onClick={exportar} disabled={!tabela || exportando}
          className={cn(FILTRO_BOTAO, 'border-navy bg-navy text-white hover:bg-navy-hover')}
        >
          {exportando ? 'Exportando…' : 'Exportar Excel'}
        </button>
      </div>

      {salvos && !salvos.disponivel && podeCriar && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{salvos.aviso}</p>
      )}

      <Construtor cfg={cfg} dados={daFonte} onChange={c => setCfg(c)} onAviso={m => toast.toast(m, 'info')}>
        {despesasOcultas && cfg.fonte !== 'receita' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Seu perfil não acessa despesas; o relatório mostra só as receitas que você lançou.
          </p>
        )}
        {comparar && temDataNasLinhas && (
          <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
            A comparação casa as linhas pelo nome. Datas nas linhas não têm par no período anterior; use as datas nas colunas.
          </p>
        )}

        {/* Resultado */}
        <div data-tour="rel-tabela" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 text-xs text-gray-500">
            <span>
              {loading ? 'Carregando…' : resumo}
              {comparar && !loading && <> · comparado com <b className="font-medium">{filtroAnt.rotulo}</b>{!anteriores && ' (carregando…)'}</>}
            </span>
            <span className="flex items-center gap-3">
              {visao !== 'grafico' && <span className="hidden text-gray-400 md:inline">Clique num número para ver os lançamentos</span>}
              <span className={cn(FILTRO_GRUPO, 'h-7')} role="group" aria-label="Visão">
                {VISOES.map(([v, n]) => (
                  <button key={v} type="button" aria-pressed={visao === v} onClick={() => setCfg({ ...cfg, visao: v })} className={filtroSegmento(visao === v)}>{n}</button>
                ))}
              </span>
            </span>
          </div>
          {loading ? (
            <div className="space-y-2 p-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} />)}</div>
          ) : erro ? (
            <div className="flex items-center justify-between bg-red-50 px-4 py-3 text-sm text-red-600">
              <span>{erro}</span>
              <button onClick={buscar} className="ml-4 shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
                Tentar novamente
              </button>
            </div>
          ) : !tabela ? (
            <p className="px-4 py-8 text-sm text-gray-500">
              Arraste <b>Valor</b> ou <b>Quantidade</b> para a área Valores para ver os números.
            </p>
          ) : base.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500">Nenhum lançamento neste período com esses filtros.</p>
          ) : (
            <>
              {visao !== 'tabela' && grafico && (
                <figure className={cn('m-0', visao === 'ambos' && 'border-b border-gray-200')}>
                  <figcaption className="px-3 pt-2 text-[11px] text-gray-400">{legendaGrafico(grafico)}</figcaption>
                  <Grafico dados={grafico} />
                </figure>
              )}
              {visao !== 'grafico' && (
                <TabelaDinamica tabela={tabela} onAlternar={alternar} onCelula={(caminho, col) => setDetalhe({ caminho, col })} />
              )}
              {visao !== 'grafico' && tabela.truncada && (
                <p className="border-t border-gray-200 px-3 py-2 text-[11px] text-gray-500">
                  Mostrando as primeiras {MAX_LINHAS_TELA.toLocaleString('pt-BR')} linhas. Recolha níveis ou filtre para ver o resto; Exportar e Copiar levam a tabela inteira.
                </p>
              )}
            </>
          )}
          {detalheInfo && visao !== 'grafico' && (
            <Detalhe
              titulo={detalheInfo.titulo} lancamentos={detalheInfo.rows} onFechar={() => setDetalhe(null)}
              onEditar={permissions?.lancamentos?.visualizar ? edicao.editar : undefined} editando={edicao.carregando}
            />
          )}
        </div>
      </Construtor>

      <DialogoSalvar
        aberto={dialogo !== null}
        titulo={dialogo === 'renomear' ? 'Renomear relatório' : 'Salvar relatório'}
        nomeInicial={dialogo === 'novo' && meuSalvo ? `${cfg.nome} (cópia)` : cfg.nome}
        compartilhadoInicial={dialogo === 'renomear' ? !!atual?.compartilhado : false}
        podeCompartilhar={podeCompartilhar}
        salvando={salvando}
        erro={erroDialogo}
        onCancelar={() => setDialogo(null)}
        onConfirmar={confirmarDialogo}
      />
      <ConfirmDialog
        open={excluir}
        titulo="Excluir relatório"
        mensagem={<>Excluir <b>{atual?.nome}</b>? {atual?.compartilhado && 'Ele some também para a equipe. '}A tabela continua na tela até você trocar.</>}
        confirmarLabel="Excluir"
        loading={salvando}
        onCancelar={() => setExcluir(false)}
        onConfirmar={confirmarExcluir}
      />
      {token && (
        <EdicaoLancamento token={token} aberto={edicao.aberto} cadastros={edicao.cadastros} onFechar={edicao.fechar}
          onSalvo={() => { buscar(); if (comparar) setVersaoAnt(v => v + 1) }} />
      )}
    </div>
  )
}
