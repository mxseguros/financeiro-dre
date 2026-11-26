'use client'
import { useState } from 'react'
import { cn, fmtBRL } from '@/lib/utils'
import { nomeCentro } from '@/lib/centros'
import { SeloRecibo } from '@/lib/recibo'
import { MarcaAnexos } from '@/components/anexos/CampoAnexos'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { FILTRO_CAMPO, filtroAtivo } from '@/components/ui/filtros'
import { CadeadoConfidencial, type CentroCusto, type Despesa, type OrdemCompra, type Receita } from './shared'
import {
  PontoBanco, Selo, ddmm, diaExtenso, hojeISO, situacaoDespesa, situacaoOrdem, situacaoReceita,
} from './situacao'

/**
 * Peças da tela de Lançamentos no redesenho UX (fase 3, 26/11/2026): resumo
 * da aba, filtros em chips, barra de ações em lote, tabela (desktop) e cartões
 * agrupados por dia (celular).
 */

// ── Resumo ──────────────────────────────────────────────────────
export function CartaoResumo({ titulo, valor, sub, tom = 'neutro', corValor }: {
  titulo: string; valor: number; sub?: string; tom?: 'neutro' | 'alerta' | 'positivo'; corValor?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5 rounded-xl border px-4 py-3.5',
      tom === 'alerta' ? 'border-red-200 bg-red-50' : tom === 'positivo' ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white')}>
      <span className={cn('text-[13px]', tom === 'alerta' ? 'font-semibold text-red-800' : tom === 'positivo' ? 'font-semibold text-green-900' : 'text-slate-600')}>
        {titulo}
      </span>
      <span className={cn('text-lg font-bold tabular-nums md:text-xl', corValor ?? 'text-slate-900')}>{fmtBRL(valor)}</span>
      {sub && <span className={cn('text-[13px]', tom === 'alerta' ? 'text-red-800' : tom === 'positivo' ? 'text-green-900' : 'text-slate-600')}>{sub}</span>}
    </div>
  )
}

export const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

// ── Filtro em chip (select nativo com o valor escrito) ────────────
export function ChipSelect({ rotulo, valor, onChange, opcoes, disabled, vazio }: {
  rotulo: string
  valor: string
  onChange: (v: string) => void
  opcoes: { valor: string; texto: string }[]
  disabled?: boolean
  /** Texto quando desabilitado (ex.: "Escolha a categoria"). */
  vazio?: string
}) {
  return (
    <select aria-label={rotulo} value={valor} onChange={e => onChange(e.target.value)} disabled={disabled}
      className={cn(FILTRO_CAMPO, 'w-auto max-w-[15rem] shrink-0 cursor-pointer pr-8 [field-sizing:content]', filtroAtivo(!!valor), valor && 'border-2')}>
      <option value="">{disabled && vazio ? vazio : rotulo}</option>
      {opcoes.map(o => <option key={o.valor} value={o.valor}>{`${rotulo}: ${o.texto}`}</option>)}
    </select>
  )
}

// ── Barra de ações em lote ───────────────────────────────────────
export function BarraLote({ n, total, children, onLimpar }: {
  n: number; total: number; children: React.ReactNode; onLimpar: () => void
}) {
  if (n === 0) return null
  return (
    <div role="region" aria-label="Ações em lote"
      className="flex flex-wrap items-center gap-2 bg-navy px-4 py-2 text-sm text-white">
      <span><b>{qtd(n, 'selecionada', 'selecionadas')}</b> · <span className="tabular-nums">{fmtBRL(total)}</span></span>
      <span className="flex-1" />
      {children}
      <button type="button" onClick={onLimpar}
        className="focus-ring h-10 rounded-lg px-3 text-sm text-slate-300 hover:text-white">Limpar seleção</button>
    </div>
  )
}

export const botaoLote = 'focus-ring h-10 rounded-lg border border-slate-500 px-3.5 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50'
export const botaoLotePrimario = 'focus-ring h-10 rounded-lg bg-white px-3.5 text-sm font-semibold text-navy hover:bg-slate-100 disabled:opacity-50'

// ── Diálogo "Marcar como paga/recebida" ─────────────────────────
export function DialogMarcar({ open, n, receita, onCancelar, onConfirmar, loading }: {
  open: boolean; n: number; receita?: boolean; loading?: boolean
  onCancelar: () => void; onConfirmar: (data: string) => void
}) {
  const [data, setData] = useState(hojeISO())
  const verbo = receita ? 'recebida' : 'paga'
  return (
    <Modal open={open} onClose={onCancelar} variant="center" maxWidth="sm:max-w-sm" dismissable={!loading}
      title={n === 1 ? `Marcar como ${verbo}` : `Marcar ${n} como ${verbo}s`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancelar} disabled={loading}>Cancelar</Button>
          <Button onClick={() => onConfirmar(data)} loading={loading} disabled={!data}>Confirmar</Button>
        </div>
      }>
      <label htmlFor="data-marcar" className="block text-sm font-semibold text-slate-700">
        Data {receita ? 'do recebimento' : 'do pagamento'}
      </label>
      <input id="data-marcar" type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)}
        className={cn(FILTRO_CAMPO, 'mt-1.5 w-full')} />
      {!receita && (
        <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
          Com a Data de Pagamento, a despesa fica <strong>aprovada</strong> (regra de sempre).
          Despesas que estão numa remessa do banco não mudam por aqui.
        </p>
      )}
    </Modal>
  )
}

// ── Tabela: cabeçalho e linha ───────────────────────────────────
const th = 'px-3 py-2.5 text-left text-[13px] font-semibold text-slate-600'
const td = 'px-3 py-2'

function CaixaSel({ marcada, onChange, rotulo, disabled }: { marcada: boolean; onChange: () => void; rotulo: string; disabled?: boolean }) {
  return (
    <input type="checkbox" checked={marcada} onChange={onChange} disabled={disabled} aria-label={rotulo}
      onClick={e => e.stopPropagation()}
      className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-navy disabled:cursor-not-allowed disabled:opacity-30" />
  )
}

/** Título clicável (o teclado chega na edição por aqui; o mouse pode clicar na linha toda). */
function Titulo({ texto, onAbrir, children }: { texto: string; onAbrir?: () => void; children?: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {onAbrir ? (
        <button type="button" onClick={e => { e.stopPropagation(); onAbrir() }}
          className="focus-ring rounded text-left font-semibold text-slate-900 hover:underline">{texto}</button>
      ) : <span className="font-semibold text-slate-900">{texto}</span>}
      {children}
    </span>
  )
}

function Etiqueta({ children, cls, title }: { children: React.ReactNode; cls: string; title?: string }) {
  return <span title={title} className={cn('rounded-full px-2 py-0.5 text-[13px] font-semibold', cls)}>{children}</span>
}

export interface Ordenacao<C extends string> {
  ativo: C; dir: 'asc' | 'desc'; alternar: (c: C) => void
}

function ThOrd<C extends string>({ campo, ord, children, direita }: { campo: C; ord: Ordenacao<C>; children: React.ReactNode; direita?: boolean }) {
  const ativo = ord.ativo === campo
  return (
    <th scope="col" aria-sort={ativo ? (ord.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn(th, direita && 'text-right')}>
      <button type="button" onClick={() => ord.alternar(campo)} className="focus-ring inline-flex min-h-11 items-center rounded hover:text-slate-900">
        {children}{ativo ? (ord.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )
}

// ── Despesas ────────────────────────────────────────────────────
export interface PropsLista<T, C extends string> {
  itens: T[]
  centros: CentroCusto[]
  catSub: (tipoId: string | null, tipoNome: string | null) => string
  anexos: Record<string, number>
  sel: Set<string>
  onSel: (id: string) => void
  onSelTodos: (ids: string[]) => void
  onAbrir: (item: T) => void
  onMarcar?: (item: T) => void
  ord: Ordenacao<C>
  vazio: { titulo: string; descricao?: string }
}

export function selecionavelDespesa(d: Despesa) { return !d.agregado }

export function TabelaDespesas<C extends string>(p: PropsLista<Despesa, C> & { campoVenc: C; campoValor: C }) {
  const hoje = hojeISO()
  const selecionaveis = p.itens.filter(selecionavelDespesa)
  const todas = selecionaveis.length > 0 && selecionaveis.every(d => p.sel.has(d.id))
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th scope="col" className="w-12 px-3"><CaixaSel marcada={todas} rotulo="Selecionar todas as despesas da lista"
            onChange={() => p.onSelTodos(todas ? [] : selecionaveis.map(d => d.id))} disabled={!selecionaveis.length} /></th>
          <ThOrd campo={p.campoVenc} ord={p.ord}>Vencimento</ThOrd>
          <th scope="col" className={th}>Descrição</th>
          <th scope="col" className={th}>Centro</th>
          <th scope="col" className={th}>Banco</th>
          <th scope="col" className={th}>Situação</th>
          <ThOrd campo={p.campoValor} ord={p.ord} direita>Valor</ThOrd>
        </tr>
      </thead>
      <tbody>
        {p.itens.map(d => {
          const s = situacaoDespesa(d, hoje)
          const marcada = p.sel.has(d.id)
          const abre = d.agregado ? undefined : () => p.onAbrir(d)
          return (
            <tr key={d.id} onClick={abre}
              className={cn('h-[60px] border-t border-gray-200', abre && 'cursor-pointer', marcada ? 'bg-sel-bg' : 'hover:bg-slate-50')}>
              <td className="px-3">
                {d.agregado ? <CadeadoConfidencial n={d.quantidade} /> :
                  <CaixaSel marcada={marcada} onChange={() => p.onSel(d.id)} rotulo={`Selecionar ${d.descricao}`} />}
              </td>
              <td className={cn(td, 'whitespace-nowrap tabular-nums', s.atrasada ? 'font-semibold text-red-800' : 'text-slate-700')}>
                {ddmm(d.data_vencimento)}
              </td>
              <td className={td}>
                <Titulo texto={d.descricao} onAbrir={abre}>
                  <MarcaAnexos n={p.anexos[d.id]} />
                  {d.parcela_total && d.parcela_total > 1 && <Etiqueta cls="bg-indigo-100 text-indigo-800">parcela {d.parcela_atual}/{d.parcela_total}</Etiqueta>}
                  {d.recorrente && !d.parcela_total && <Etiqueta cls="bg-blue-100 text-blue-800">todo mês</Etiqueta>}
                </Titulo>
                <span className="block text-[13px] text-slate-600">{p.catSub(d.tipo_lancamento_id, d.tipo_nome ?? d.categoria)}</span>
              </td>
              <td className={cn(td, 'text-slate-700')}>{nomeCentro(d.centro_custo, p.centros)}</td>
              <td className={cn(td, 'text-slate-700')}><PontoBanco nome={d.banco_nome} /></td>
              <td className={td}><Selo texto={s.texto} tom={s.tom} /></td>
              <td className={cn(td, 'whitespace-nowrap text-right font-semibold tabular-nums text-slate-900')}>{fmtBRL(d.valor)}</td>
            </tr>
          )
        })}
        {p.itens.length === 0 && <tr><td colSpan={7}><EmptyState titulo={p.vazio.titulo} descricao={p.vazio.descricao} /></td></tr>}
      </tbody>
    </table>
  )
}

/** Grupos do celular: vencidas, hoje, próximos vencimentos, sem vencimento e pagas (por dia). */
function agruparDespesas(itens: Despesa[], hoje: string): { titulo: string; alerta?: boolean; itens: Despesa[] }[] {
  const vencidas: Despesa[] = [], semVenc: Despesa[] = []
  const porVenc = new Map<string, Despesa[]>(), porPag = new Map<string, Despesa[]>()
  for (const d of itens) {
    if (d.paga_em) { const k = d.paga_em.slice(0, 10); porPag.set(k, [...(porPag.get(k) ?? []), d]); continue }
    const v = d.data_vencimento?.slice(0, 10)
    if (!v) semVenc.push(d)
    else if (v < hoje) vencidas.push(d)
    else porVenc.set(v, [...(porVenc.get(v) ?? []), d])
  }
  const grupos: { titulo: string; alerta?: boolean; itens: Despesa[] }[] = []
  if (vencidas.length) grupos.push({ titulo: 'Vencidas', alerta: true, itens: vencidas })
  for (const k of Array.from(porVenc.keys()).sort()) {
    grupos.push({ titulo: k === hoje ? `Hoje · ${diaExtenso(k).split(' · ')[0]}` : `Vence ${diaExtenso(k)}`, itens: porVenc.get(k)! })
  }
  if (semVenc.length) grupos.push({ titulo: 'Sem vencimento', itens: semVenc })
  for (const k of Array.from(porPag.keys()).sort().reverse()) {
    grupos.push({ titulo: `Pagas · ${diaExtenso(k).split(' · ')[0]}`, itens: porPag.get(k)! })
  }
  return grupos
}

const cartaoCls = 'flex flex-col gap-1.5 rounded-xl border bg-white p-3.5'
const botaoCartao = 'focus-ring h-12 shrink-0 whitespace-nowrap rounded-lg border border-gray-300 px-3.5 text-sm font-semibold text-slate-900 hover:bg-gray-50'

export function CartoesDespesas<C extends string>(p: PropsLista<Despesa, C>) {
  const hoje = hojeISO()
  if (p.itens.length === 0) return <EmptyState titulo={p.vazio.titulo} descricao={p.vazio.descricao} />
  return (
    <div className="space-y-2 p-3">
      {agruparDespesas(p.itens, hoje).map(g => (
        <section key={g.titulo} aria-label={g.titulo} className="space-y-2">
          <h3 className={cn('px-1 pt-2 text-[13px] font-bold uppercase tracking-wide', g.alerta ? 'text-red-800' : 'text-slate-600')}>{g.titulo}</h3>
          {g.itens.map(d => {
            const s = situacaoDespesa(d, hoje)
            const podeMarcar = !d.agregado && !d.paga_em && d.status !== 'rejeitada' && p.onMarcar
            return (
              <article key={d.id} className={cn(cartaoCls, s.atrasada ? 'border-red-200' : 'border-gray-200')}>
                <button type="button" disabled={d.agregado} onClick={() => p.onAbrir(d)}
                  className="focus-ring -m-1 flex flex-col gap-1 rounded-lg p-1 text-left disabled:cursor-default">
                  <span className="flex justify-between gap-3">
                    <span className="text-[15px] font-semibold text-slate-900">{d.descricao}<MarcaAnexos n={p.anexos[d.id]} /></span>
                    <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-slate-900">{fmtBRL(d.valor)}</span>
                  </span>
                  <span className="text-[13px] text-slate-600">
                    {[p.catSub(d.tipo_lancamento_id, d.tipo_nome ?? d.categoria), nomeCentro(d.centro_custo, p.centros), d.banco_nome,
                      d.parcela_total && d.parcela_total > 1 ? `parcela ${d.parcela_atual}/${d.parcela_total}` : d.recorrente ? 'todo mês' : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </button>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  {d.agregado ? <CadeadoConfidencial n={d.quantidade} /> : <Selo texto={s.texto} tom={s.tom} />}
                  {podeMarcar && <button type="button" onClick={() => p.onMarcar!(d)} className={botaoCartao}>Marcar como paga</button>}
                </span>
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}

// ── Receitas ────────────────────────────────────────────────────
export function selecionavelReceita(r: Receita) { return r.origem === 'manual' && !r.recebido_em }

function EtiquetaSoDre() {
  return <Etiqueta cls="border border-slate-300 bg-slate-100 text-slate-700"
    title="Entra só na DRE: fica fora dos totais da Visão Geral e de Lançamentos.">Só DRE</Etiqueta>
}

export function TabelaReceitas<C extends string>(p: PropsLista<Receita, C> & { campoReceb: C; campoValor: C }) {
  const hoje = hojeISO()
  const selecionaveis = p.itens.filter(selecionavelReceita)
  const todas = selecionaveis.length > 0 && selecionaveis.every(r => p.sel.has(r.id))
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th scope="col" className="w-12 px-3"><CaixaSel marcada={todas} rotulo="Selecionar todas as receitas a receber da lista"
            onChange={() => p.onSelTodos(todas ? [] : selecionaveis.map(r => r.id))} disabled={!selecionaveis.length} /></th>
          <ThOrd campo={p.campoReceb} ord={p.ord}>Recebimento</ThOrd>
          <th scope="col" className={th}>Descrição</th>
          <th scope="col" className={th}>Centro</th>
          <th scope="col" className={th}>Banco</th>
          <th scope="col" className={th}>Situação</th>
          <ThOrd campo={p.campoValor} ord={p.ord} direita>Valor</ThOrd>
        </tr>
      </thead>
      <tbody>
        {p.itens.map(r => {
          const s = situacaoReceita(r, hoje)
          const marcada = p.sel.has(r.id)
          const abre = r.origem === 'manual' ? () => p.onAbrir(r) : undefined
          return (
            <tr key={r.id} onClick={abre}
              className={cn('h-[60px] border-t border-gray-200', abre && 'cursor-pointer', marcada ? 'bg-sel-bg' : 'hover:bg-slate-50')}>
              <td className="px-3">
                <CaixaSel marcada={marcada} onChange={() => p.onSel(r.id)} rotulo={`Selecionar ${r.descricao}`} disabled={!selecionavelReceita(r)} />
              </td>
              <td className={cn(td, 'whitespace-nowrap tabular-nums', s.atrasada ? 'font-semibold text-red-800' : 'text-slate-700')}>
                {ddmm(r.recebido_em ?? r.data_vencimento)}
              </td>
              <td className={td}>
                <Titulo texto={r.descricao} onAbrir={abre}>
                  <MarcaAnexos n={p.anexos[r.id]} />
                  {r.somente_dre && <EtiquetaSoDre />}
                </Titulo>
                <span className="block text-[13px] text-slate-600">
                  {r.origem === 'comissao' ? 'Comissão de apólice' : p.catSub(r.tipo_lancamento_id, r.tipo_nome)}
                </span>
              </td>
              <td className={cn(td, 'text-slate-700')}>{r.centro_custo ? nomeCentro(r.centro_custo, p.centros) : '—'}</td>
              <td className={cn(td, 'text-slate-700')}><PontoBanco nome={r.banco_nome} /></td>
              <td className={td}><Selo texto={s.texto} tom={s.tom} /></td>
              <td className={cn(td, 'whitespace-nowrap text-right font-semibold tabular-nums text-green-700')}>{fmtBRL(r.valor)}</td>
            </tr>
          )
        })}
        {p.itens.length === 0 && <tr><td colSpan={7}><EmptyState titulo={p.vazio.titulo} descricao={p.vazio.descricao} /></td></tr>}
      </tbody>
    </table>
  )
}

function agruparReceitas(itens: Receita[], hoje: string): { titulo: string; alerta?: boolean; itens: Receita[] }[] {
  const atrasadas: Receita[] = [], semData: Receita[] = []
  const aReceber = new Map<string, Receita[]>(), recebidas = new Map<string, Receita[]>()
  for (const r of itens) {
    if (r.recebido_em) { const k = r.recebido_em.slice(0, 10); recebidas.set(k, [...(recebidas.get(k) ?? []), r]); continue }
    const v = r.data_vencimento?.slice(0, 10)
    if (!v) semData.push(r)
    else if (v < hoje) atrasadas.push(r)
    else aReceber.set(v, [...(aReceber.get(v) ?? []), r])
  }
  const grupos: { titulo: string; alerta?: boolean; itens: Receita[] }[] = []
  if (atrasadas.length) grupos.push({ titulo: 'Atrasadas', alerta: true, itens: atrasadas })
  for (const k of Array.from(aReceber.keys()).sort()) {
    grupos.push({ titulo: k === hoje ? `Hoje · ${diaExtenso(k).split(' · ')[0]}` : `A receber ${diaExtenso(k)}`, itens: aReceber.get(k)! })
  }
  if (semData.length) grupos.push({ titulo: 'Sem data prevista', itens: semData })
  for (const k of Array.from(recebidas.keys()).sort().reverse()) {
    grupos.push({ titulo: `Recebidas · ${diaExtenso(k).split(' · ')[0]}`, itens: recebidas.get(k)! })
  }
  return grupos
}

export function CartoesReceitas<C extends string>(p: PropsLista<Receita, C>) {
  const hoje = hojeISO()
  if (p.itens.length === 0) return <EmptyState titulo={p.vazio.titulo} descricao={p.vazio.descricao} />
  return (
    <div className="space-y-2 p-3">
      {agruparReceitas(p.itens, hoje).map(g => (
        <section key={g.titulo} aria-label={g.titulo} className="space-y-2">
          <h3 className={cn('px-1 pt-2 text-[13px] font-bold uppercase tracking-wide', g.alerta ? 'text-red-800' : 'text-slate-600')}>{g.titulo}</h3>
          {g.itens.map(r => {
            const s = situacaoReceita(r, hoje)
            const manual = r.origem === 'manual'
            return (
              <article key={r.id} className={cn(cartaoCls, s.atrasada ? 'border-red-200' : 'border-gray-200')}>
                <button type="button" disabled={!manual} onClick={() => p.onAbrir(r)}
                  className="focus-ring -m-1 flex flex-col gap-1 rounded-lg p-1 text-left disabled:cursor-default">
                  <span className="flex justify-between gap-3">
                    <span className="text-[15px] font-semibold text-slate-900">{r.descricao}<MarcaAnexos n={p.anexos[r.id]} /></span>
                    <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-green-700">{fmtBRL(r.valor)}</span>
                  </span>
                  <span className="text-[13px] text-slate-600">
                    {[manual ? p.catSub(r.tipo_lancamento_id, r.tipo_nome) : 'Comissão de apólice',
                      r.centro_custo ? nomeCentro(r.centro_custo, p.centros) : null, r.banco_nome].filter(Boolean).join(' · ')}
                  </span>
                </button>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5"><Selo texto={s.texto} tom={s.tom} />{r.somente_dre && <EtiquetaSoDre />}</span>
                  {selecionavelReceita(r) && p.onMarcar && (
                    <button type="button" onClick={() => p.onMarcar!(r)} className={botaoCartao}>Marcar como recebida</button>
                  )}
                </span>
              </article>
            )
          })}
        </section>
      ))}
    </div>
  )
}

// ── Ordens de compra ────────────────────────────────────────────
export function TabelaOrdens<C extends string>(p: Omit<PropsLista<OrdemCompra, C>, 'sel' | 'onSel' | 'onSelTodos' | 'anexos' | 'catSub'> & { campoData: C; campoValor: C }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <ThOrd campo={p.campoData} ord={p.ord}>Pedido em</ThOrd>
          <th scope="col" className={th}>Ordem</th>
          <th scope="col" className={th}>Quem pediu</th>
          <th scope="col" className={th}>Centro</th>
          <th scope="col" className={th}>Situação</th>
          <ThOrd campo={p.campoValor} ord={p.ord} direita>Valor</ThOrd>
        </tr>
      </thead>
      <tbody>
        {p.itens.map(o => {
          const s = situacaoOrdem(o.status)
          return (
            <tr key={o.id} onClick={() => p.onAbrir(o)} className="h-[60px] cursor-pointer border-t border-gray-200 hover:bg-slate-50">
              <td className={cn(td, 'whitespace-nowrap pl-4 tabular-nums text-slate-700')}>{ddmm(o.data_solicitacao)}</td>
              <td className={td}>
                <Titulo texto={o.assunto} onAbrir={() => p.onAbrir(o)} />
                <span className="block max-w-[28rem] truncate text-[13px] text-slate-600">{o.descricao}</span>
              </td>
              <td className={cn(td, 'text-slate-700')}>{o.solicitante}</td>
              <td className={cn(td, 'text-slate-700')}>{o.centro_custo ? nomeCentro(o.centro_custo, p.centros) : '—'}</td>
              <td className={td}><span className="flex flex-wrap items-center gap-1.5"><Selo texto={s.texto} tom={s.tom} /><SeloRecibo status={o.recibo_status} /></span></td>
              <td className={cn(td, 'whitespace-nowrap text-right font-semibold tabular-nums text-slate-900')}>{o.valor != null ? fmtBRL(o.valor) : '—'}</td>
            </tr>
          )
        })}
        {p.itens.length === 0 && <tr><td colSpan={6}><EmptyState titulo={p.vazio.titulo} descricao={p.vazio.descricao} /></td></tr>}
      </tbody>
    </table>
  )
}

export function CartoesOrdens({ itens, centros, onAbrir, vazio }: {
  itens: OrdemCompra[]; centros: CentroCusto[]; onAbrir: (o: OrdemCompra) => void; vazio: { titulo: string; descricao?: string }
}) {
  if (itens.length === 0) return <EmptyState titulo={vazio.titulo} descricao={vazio.descricao} />
  return (
    <div className="space-y-2 p-3">
      {itens.map(o => {
        const s = situacaoOrdem(o.status)
        return (
          <button key={o.id} type="button" onClick={() => onAbrir(o)} className={cn(cartaoCls, 'focus-ring w-full border-gray-200 text-left')}>
            <span className="flex justify-between gap-3">
              <span className="text-[15px] font-semibold text-slate-900">{o.assunto}</span>
              <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-slate-900">{o.valor != null ? fmtBRL(o.valor) : '—'}</span>
            </span>
            <span className="text-[13px] text-slate-600">
              {[o.solicitante, o.centro_custo ? nomeCentro(o.centro_custo, centros) : null, `pedido em ${ddmm(o.data_solicitacao)}`].filter(Boolean).join(' · ')}
            </span>
            <span className="flex flex-wrap items-center gap-1.5"><Selo texto={s.texto} tom={s.tom} /><SeloRecibo status={o.recibo_status} /></span>
          </button>
        )
      })}
    </div>
  )
}
