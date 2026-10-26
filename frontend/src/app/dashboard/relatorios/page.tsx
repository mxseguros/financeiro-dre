'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { api, API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { FILTRO_BOTAO, FILTRO_CAMPO, FILTRO_GRUPO, filtroSegmento } from '@/components/ui/filtros'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { SeletorPeriodo } from '@/components/ui/SeletorPeriodo'
import { Construtor } from './_components/Construtor'
import { Detalhe, TabelaDinamica } from './_components/TabelaDinamica'
import {
  CAMPO, MAX_LINHAS_TELA, MODELOS, chaveCaminho, copiaConfig, lancamentosDaCelula, linhasBase,
  montarTabela, rotulo, tabelaTSV, type Config, type Fonte, type Lancamento,
} from './_components/pivot'

interface DadosResp {
  inicio: string
  fim: string
  total: number
  despesas_ocultas: boolean
  itens: Lancamento[]
}

const FONTES: [Fonte, string][] = [['despesa', 'Despesas'], ['receita', 'Receitas'], ['ambos', 'Ambos']]
const AJUSTADO = ' (ajustado)'

// Abre no último relatório usado (só neste navegador; salvar de verdade é a fase 2).
const CHAVE_ULTIMO = 'relatorios.ultimo.v1'
function configInicial(): Config {
  try {
    const c = JSON.parse(window.localStorage.getItem(CHAVE_ULTIMO) ?? 'null')
    if (c && Array.isArray(c.linhas) && Array.isArray(c.colunas) && Array.isArray(c.valores) && c.filtros) {
      const valido = (f: string) => f in CAMPO
      return {
        nome: String(c.nome ?? MODELOS[0].nome),
        fonte: ['despesa', 'receita', 'ambos'].includes(c.fonte) ? c.fonte : 'despesa',
        linhas: c.linhas.filter(valido),
        colunas: c.colunas.filter(valido),
        valores: c.valores.filter((v: { f: string }) => valido(v.f)),
        filtros: Object.fromEntries(Object.entries(c.filtros).filter(([k]) => valido(k))),
      }
    }
  } catch { /* sem storage: começa no primeiro modelo */ }
  return copiaConfig(MODELOS[0])
}

const IconSwap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5"><path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4" /></svg>
)

export default function RelatoriosPage() {
  const { token } = useAuth()
  const toast = useToast()
  const filtro = filtroDoPeriodo(usePeriodo(), true)
  const [cfg, setCfgBruto] = useState<Config>(() => copiaConfig(MODELOS[0]))
  const [dados, setDados] = useState<Lancamento[]>([])
  const [despesasOcultas, setDespesasOcultas] = useState(false)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const [detalhe, setDetalhe] = useState<{ caminho: string[]; col: number } | null>(null)
  const [exportando, setExportando] = useState(false)

  useEffect(() => { setCfgBruto(configInicial()) }, [])

  const setCfg = useCallback((c: Config, ajuste = true) => {
    const nome = ajuste && !c.nome.endsWith(AJUSTADO) ? c.nome + AJUSTADO : c.nome
    const novo = { ...c, nome }
    setCfgBruto(novo)
    setDetalhe(null)
    try { window.localStorage.setItem(CHAVE_ULTIMO, JSON.stringify(novo)) } catch { /* idem */ }
  }, [])

  const buscar = useCallback(() => {
    if (!token) return
    setLoading(true); setErro(null); setDetalhe(null)
    api.get<DadosResp>(`/relatorios/dados?${filtro.qs}&fonte=ambos`, token)
      .then(r => { setDados(r.itens); setDespesasOcultas(r.despesas_ocultas) })
      .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar os lançamentos.'))
      .finally(() => setLoading(false))
  }, [token, filtro.qs])

  useEffect(() => { buscar() }, [buscar])

  const daFonte = useMemo(() => linhasBase(dados, { ...cfg, filtros: {} }), [dados, cfg])
  const base = useMemo(() => linhasBase(dados, cfg), [dados, cfg])
  const tabela = useMemo(
    () => cfg.valores.length ? montarTabela(base, cfg, fechados, MAX_LINHAS_TELA) : null,
    [base, cfg, fechados],
  )

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
    const linha = detalhe.caminho.map((k, i) => rotulo(cfg.linhas[i], k)).join(' › ')
    return { rows, titulo: [linha, col].filter(Boolean).join(' · ') || 'Total geral' }
  }, [detalhe, tabela, base, cfg])

  async function copiar() {
    if (!cfg.valores.length) return
    try {
      await navigator.clipboard.writeText(tabelaTSV(montarTabela(base, cfg, fechados)))
      toast.sucesso('Tabela copiada. Cole no Excel ou no WhatsApp.')
    } catch {
      toast.erro('O navegador não permitiu copiar. Use Exportar Excel.')
    }
  }

  async function exportar() {
    if (!token || !cfg.valores.length) return
    const t = montarTabela(base, cfg, fechados)
    setExportando(true)
    try {
      const res = await fetch(`${API_BASE}/relatorios/exportar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          titulo: cfg.nome,
          subtitulo: `${filtro.rotulo} · ${FONTES.find(f => f[0] === cfg.fonte)?.[1]} · ${base.length} lançamentos`,
          cabecalho: [t.titulo, ...t.cabecalho],
          linhas: t.linhas.map(l => ({
            rotulo: l.rotulo, nivel: l.nivel, tipo: l.tipo,
            valores: l.celulas.map(c => c.valor), formatos: l.celulas.map(c => c.formato),
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
      a.download = `${cfg.nome.replace(AJUSTADO, '')} - ${filtro.rotulo}.xlsx`.replace(/[\\/:*?"<>|]/g, '-')
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao exportar.')
    } finally {
      setExportando(false)
    }
  }

  const resumo = `${base.length} lançamento${base.length === 1 ? '' : 's'} · ${cfg.linhas.map(f => CAMPO[f].nome).join(' › ') || 'sem linhas'}` +
    (cfg.colunas.length ? ' × ' + cfg.colunas.map(f => CAMPO[f].nome).join(' › ') : '')

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-navy md:text-2xl">Relatórios</h1>
          <p className="mt-0.5 truncate text-sm text-gray-500">
            <strong className="font-medium text-gray-700">{cfg.nome}</strong> · {filtro.rotulo}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorPeriodo intervaloMeses />
          <div className={FILTRO_GRUPO} role="group" aria-label="Fonte">
            {FONTES.map(([f, n]) => (
              <button key={f} type="button" aria-pressed={cfg.fonte === f} onClick={() => setCfg({ ...cfg, fonte: f })} className={filtroSegmento(cfg.fonte === f)}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          data-tour="rel-modelos"
          value=""
          onChange={e => { if (e.target.value !== '') { setCfg(copiaConfig(MODELOS[Number(e.target.value)]), false); setFechados(new Set()) } }}
          className={FILTRO_CAMPO}
          aria-label="Modelos prontos"
        >
          <option value="">Modelos prontos…</option>
          {MODELOS.map((m, i) => <option key={m.nome} value={i}>{m.nome}</option>)}
        </select>
        <button type="button" onClick={() => setCfg({ ...cfg, linhas: cfg.colunas, colunas: cfg.linhas })} className={FILTRO_BOTAO} title="Troca linhas e colunas">
          <IconSwap /> Inverter
        </button>
        <span className="flex-1" />
        <button type="button" onClick={copiar} disabled={!tabela} className={FILTRO_BOTAO}>Copiar tabela</button>
        <button
          type="button" onClick={exportar} disabled={!tabela || exportando}
          className={cn(FILTRO_BOTAO, 'border-navy bg-navy text-white hover:bg-navy-hover')}
        >
          {exportando ? 'Exportando…' : 'Exportar Excel'}
        </button>
      </div>

      <Construtor cfg={cfg} dados={daFonte} onChange={c => setCfg(c)} onAviso={m => toast.toast(m, 'info')}>
        {despesasOcultas && cfg.fonte !== 'receita' && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Seu perfil não acessa despesas; o relatório mostra só as receitas que você lançou.
          </p>
        )}

        {/* Resultado */}
        <div data-tour="rel-tabela" className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 text-xs text-gray-500">
            <span>{loading ? 'Carregando…' : resumo}</span>
            <span className="text-gray-400">Clique num número para ver os lançamentos</span>
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
              <TabelaDinamica tabela={tabela} onAlternar={alternar} onCelula={(caminho, col) => setDetalhe({ caminho, col })} />
              {tabela.truncada && (
                <p className="border-t border-gray-200 px-3 py-2 text-[11px] text-gray-500">
                  Mostrando as primeiras {MAX_LINHAS_TELA.toLocaleString('pt-BR')} linhas. Recolha níveis ou filtre para ver o resto; Exportar e Copiar levam a tabela inteira.
                </p>
              )}
            </>
          )}
          {detalheInfo && (
            <Detalhe titulo={detalheInfo.titulo} lancamentos={detalheInfo.rows} onFechar={() => setDetalhe(null)} />
          )}
        </div>
      </Construtor>
    </div>
  )
}
