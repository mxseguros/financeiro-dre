'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  AGGS, CAMPO, CAMPOS, NOME_AGG, ZONAS, ehMedida, rotulo, valoresDistintos,
  type Agg, type CampoId, type Config, type Lancamento, type MedidaId, type Zona,
} from './pivot'

// ── Operações sobre a configuração ──────────────────────────
// Linhas, Colunas e Valores são exclusivos entre si (como no Excel); Filtros
// é independente — dá para filtrar um campo que também está nas linhas.

type Campo = CampoId | MedidaId

function semCampo(cfg: Config, campo: Campo): Config {
  return {
    ...cfg,
    linhas: cfg.linhas.filter(f => f !== campo),
    colunas: cfg.colunas.filter(f => f !== campo),
    valores: cfg.valores.filter(v => v.f !== campo),
  }
}

export function colocar(cfg: Config, campo: Campo, zona: Zona, idx?: number): Config | string {
  const medida = ehMedida(campo)
  if (medida && zona !== 'valores') return 'Valor, Quantidade e Saldo só entram na área Valores.'
  if (!medida && zona === 'valores') return 'Na área Valores entram Valor, Quantidade ou Saldo.'
  if (zona === 'filtros') {
    if (campo in cfg.filtros) return cfg
    return { ...cfg, filtros: { ...cfg.filtros, [campo]: null } }
  }
  const base = semCampo(cfg, campo)
  const inserir = <T,>(lista: T[], item: T) => {
    const l = [...lista]
    l.splice(idx == null ? l.length : Math.min(idx, l.length), 0, item)
    return l
  }
  if (zona === 'valores') return { ...base, valores: inserir(base.valores, { f: campo as MedidaId, a: AGGS[campo as MedidaId][0] }) }
  return { ...base, [zona]: inserir(base[zona], campo as CampoId) }
}

export function retirar(cfg: Config, campo: Campo, zona: Zona): Config {
  if (zona === 'filtros') {
    const filtros = { ...cfg.filtros }
    delete filtros[campo as CampoId]
    return { ...cfg, filtros }
  }
  return semCampo(cfg, campo)
}

// ── Componente ──────────────────────────────────────────────

interface Arrasto { campo: Campo; de?: Zona }
const TIPO_DND = 'application/x-relatorio-campo'

interface Props {
  cfg: Config
  dados: Lancamento[]
  onChange: (cfg: Config) => void
  onAviso: (msg: string) => void
  /** Resultado: fica na coluna da direita, logo abaixo das áreas. */
  children?: React.ReactNode
}

export function Construtor({ cfg, dados, onChange, onAviso, children }: Props) {
  const [busca, setBusca] = useState('')
  const [sobre, setSobre] = useState<Zona | 'campos' | null>(null)
  const [filtroAberto, setFiltroAberto] = useState<CampoId | null>(null)
  const [menuCampo, setMenuCampo] = useState<CampoId | null>(null)
  const arrasto = useRef<Arrasto | null>(null)

  const usados = useMemo(() => new Set<string>([
    ...cfg.linhas, ...cfg.colunas, ...cfg.valores.map(v => v.f), ...Object.keys(cfg.filtros),
  ]), [cfg])

  const aplicar = (r: Config | string) => (typeof r === 'string' ? onAviso(r) : onChange(r))

  const adicionarRapido = (campo: Campo, zona?: Zona) => {
    setMenuCampo(null)
    const destino = zona ?? (ehMedida(campo) ? 'valores' : 'linhas')
    aplicar(colocar(cfg, campo, destino))
    if (destino === 'filtros') setFiltroAberto(campo as CampoId)
  }

  // Arrastar e soltar nativo do navegador (o "+" cobre o celular, onde não há arrasto).
  const iniciar = (e: React.DragEvent, a: Arrasto) => {
    arrasto.current = a
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData(TIPO_DND, a.campo) } catch { /* alguns navegadores recusam tipos próprios */ }
  }
  const sobreAlvo = (e: React.DragEvent, alvo: Zona | 'campos') => {
    if (!arrasto.current) return
    e.preventDefault()
    if (sobre !== alvo) setSobre(alvo)
  }
  const soltar = (e: React.DragEvent, alvo: Zona | 'campos', idx?: number) => {
    e.preventDefault()
    e.stopPropagation()
    setSobre(null)
    const a = arrasto.current
    arrasto.current = null
    if (!a) return
    if (alvo === 'campos') { if (a.de) onChange(retirar(cfg, a.campo, a.de)); return }
    // Mover de Filtros para outra área tira o filtro; o contrário mantém o campo onde estava.
    let partida = cfg
    if (a.de === 'filtros' && alvo !== 'filtros') partida = retirar(cfg, a.campo, 'filtros')
    aplicar(colocar(partida, a.campo, alvo, idx))
    if (alvo === 'filtros' && !ehMedida(a.campo)) setFiltroAberto(a.campo)
  }

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const g: Record<string, typeof CAMPOS> = {}
    CAMPOS.filter(c => c.nome.toLowerCase().includes(termo)).forEach(c => { (g[c.grupo] ||= []).push(c) })
    return Object.entries(g)
  }, [busca])

  const chipZona = (campo: Campo, zona: Zona, idx: number, extra?: React.ReactNode, onClick?: () => void) => (
    <div
      key={`${zona}-${campo}`}
      draggable
      onDragStart={e => iniciar(e, { campo, de: zona })}
      onDragOver={e => sobreAlvo(e, zona)}
      onDrop={e => soltar(e, zona, zona === 'filtros' ? undefined : idx)}
      onClick={onClick}
      className={cn('flex min-w-0 cursor-grab items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs shadow-sm',
        onClick && 'cursor-pointer hover:border-navy')}
      title={onClick ? 'Clique para escolher os itens' : undefined}
    >
      <span className="min-w-0 flex-1 truncate text-gray-700">{CAMPO[campo].nome}</span>
      {extra}
      <button
        type="button"
        onClick={ev => { ev.stopPropagation(); onChange(retirar(cfg, campo, zona)); if (filtroAberto === campo) setFiltroAberto(null) }}
        className="px-0.5 text-sm leading-none text-gray-400 hover:text-red-600"
        aria-label={`Retirar ${CAMPO[campo].nome}`}
      >×</button>
    </div>
  )

  const itensZona = (zona: Zona) => {
    if (zona === 'valores') return cfg.valores.map((v, i) => chipZona(v.f, zona, i, (
      <select
        value={v.a}
        onClick={e => e.stopPropagation()}
        onChange={e => onChange({ ...cfg, valores: cfg.valores.map((x, j) => j === i ? { ...x, a: e.target.value as Agg } : x) })}
        className="max-w-[92px] rounded bg-navy/5 px-1 py-0.5 text-[11px] text-navy focus:outline-none"
        aria-label={`Conta de ${CAMPO[v.f].nome}`}
      >
        {AGGS[v.f].map(a => <option key={a} value={a}>{NOME_AGG[a]}</option>)}
      </select>
    )))
    if (zona === 'filtros') return (Object.entries(cfg.filtros) as [CampoId, string[] | null][]).map(([f, sel], i) => chipZona(f, zona, i, (
      <span className="rounded bg-beige/20 px-1 text-[10px] text-gray-700">{sel ? sel.length : 'Todos'}</span>
    ), () => setFiltroAberto(filtroAberto === f ? null : f)))
    return cfg[zona].map((f, i) => chipZona(f, zona, i))
  }

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Campos */}
      <div
        data-tour="rel-campos"
        onDragOver={e => sobreAlvo(e, 'campos')}
        onDragLeave={() => setSobre(null)}
        onDrop={e => soltar(e, 'campos')}
        className={cn('grid grid-cols-1 gap-2.5 rounded-xl border bg-white p-3 shadow-sm', sobre === 'campos' ? 'border-navy' : 'border-gray-200')}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Campos</span>
        <input
          type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar campo"
          className="h-8 w-full rounded-md border border-gray-200 bg-gray-50 px-2 text-xs focus:outline-none focus-ring"
        />
        <div className="grid grid-cols-1 gap-2.5 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
          {grupos.length === 0 && <span className="text-xs text-gray-400">Nenhum campo com esse nome.</span>}
          {grupos.map(([g, cs]) => (
            <div key={g} className="grid grid-cols-1 gap-1">
              <span className="text-[11px] font-semibold text-gray-400">{g}</span>
              {cs.map(c => (
                <div key={c.id} className="relative">
                  <div
                    draggable
                    onDragStart={e => iniciar(e, { campo: c.id })}
                    className={cn('flex min-w-0 cursor-grab select-none items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:border-navy',
                      usados.has(c.id) && 'opacity-50')}
                  >
                    <span className={cn('w-4 shrink-0 font-mono text-[10px]', c.medida ? 'text-green-700' : 'text-gray-400')}>{c.medida ? 'Σ' : 'Aa'}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-700">{c.nome}</span>
                    <button
                      type="button"
                      onClick={() => c.medida ? adicionarRapido(c.id) : setMenuCampo(menuCampo === c.id ? null : c.id as CampoId)}
                      className="px-1 text-base leading-none text-gray-400 hover:text-navy"
                      aria-label={`Adicionar ${c.nome}`} title="Adicionar"
                    >+</button>
                  </div>
                  {menuCampo === c.id && (
                    <MenuZona onEscolher={z => adicionarRapido(c.id, z)} onFechar={() => setMenuCampo(null)} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-w-0 gap-2.5">
        {/* Áreas */}
        <div data-tour="rel-areas" className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {ZONAS.map(([z, nome]) => {
            const itens = itensZona(z)
            return (
              <div
                key={z}
                onDragOver={e => sobreAlvo(e, z)}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(null) }}
                onDrop={e => soltar(e, z)}
                className={cn('grid min-h-[84px] min-w-0 content-start gap-1.5 rounded-xl border-[1.5px] border-dashed p-2 transition-colors',
                  sobre === z ? 'border-navy bg-navy/5' : 'border-gray-300 bg-white/60')}
              >
                <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  <span>{nome}</span><span>{itens.length || ''}</span>
                </div>
                {itens.length ? itens : (
                  <span className="text-[11px] text-gray-400">{z === 'valores' ? 'Arraste Valor ou Quantidade' : 'Arraste um campo aqui'}</span>
                )}
              </div>
            )
          })}
        </div>

        {filtroAberto && filtroAberto in cfg.filtros && (
          <FiltroItens
            campo={filtroAberto}
            dados={dados}
            selecionados={cfg.filtros[filtroAberto] ?? null}
            onChange={sel => onChange({ ...cfg, filtros: { ...cfg.filtros, [filtroAberto]: sel } })}
            onFechar={() => setFiltroAberto(null)}
          />
        )}

        {children}
      </div>
    </div>
  )
}

function MenuZona({ onEscolher, onFechar }: { onEscolher: (z: Zona) => void; onFechar: () => void }) {
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) onFechar() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [onFechar])
  return (
    <div ref={caixa} className="absolute right-0 top-full z-20 mt-1 grid w-32 rounded-md border border-gray-200 bg-white py-1 text-xs shadow-lg">
      {([['linhas', 'Linhas'], ['colunas', 'Colunas'], ['filtros', 'Filtros']] as [Zona, string][]).map(([z, n]) => (
        <button key={z} type="button" onClick={() => onEscolher(z)} className="px-3 py-1.5 text-left text-gray-700 hover:bg-gray-50">
          Para {n}
        </button>
      ))}
    </div>
  )
}

interface FiltroProps {
  campo: CampoId
  dados: Lancamento[]
  selecionados: string[] | null
  onChange: (sel: string[] | null) => void
  onFechar: () => void
}

function FiltroItens({ campo, dados, selecionados, onChange, onFechar }: FiltroProps) {
  const [busca, setBusca] = useState('')
  const todos = useMemo(() => valoresDistintos(dados, campo), [dados, campo])
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return t ? todos.filter(v => rotulo(campo, v).toLowerCase().includes(t)) : todos
  }, [todos, busca, campo])
  // Valores salvos que não existem no período (ex.: modelo pede "Empréstimos" e
  // ninguém usou) continuam marcados, para o filtro não "sumir" sozinho.
  const sel = selecionados == null ? null : new Set(selecionados)
  const marcado = (v: string) => sel == null || sel.has(v)

  const alternar = (v: string) => {
    const atual = new Set(sel ?? todos)
    if (atual.has(v)) atual.delete(v)
    else atual.add(v)
    onChange(todos.every(x => atual.has(x)) && atual.size === todos.length ? null : [...atual])
  }

  return (
    <div className="grid gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <b className="text-navy">Filtro: {CAMPO[campo].nome}</b>
        <span className="flex gap-3">
          <button type="button" onClick={() => onChange(null)} className="font-medium text-navy hover:underline">Todos</button>
          <button type="button" onClick={() => onChange([])} className="font-medium text-navy hover:underline">Nenhum</button>
          <button type="button" onClick={onFechar} className="font-medium text-navy hover:underline">Fechar</button>
        </span>
      </div>
      {todos.length > 12 && (
        <input
          type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar item"
          className="h-7 w-full max-w-xs rounded-md border border-gray-200 bg-gray-50 px-2 text-xs focus:outline-none focus-ring"
        />
      )}
      <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto text-xs">
        {visiveis.length === 0 && <span className="text-gray-400">Nenhum item neste período.</span>}
        {visiveis.map(v => (
          <label key={v} className="inline-flex items-center gap-1.5 whitespace-nowrap text-gray-700">
            <input type="checkbox" checked={marcado(v)} onChange={() => alternar(v)} className="accent-navy" />
            {rotulo(campo, v)}
          </label>
        ))}
      </div>
    </div>
  )
}
