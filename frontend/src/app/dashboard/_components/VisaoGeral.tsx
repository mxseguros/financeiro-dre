'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { cn, fmtBRL } from '@/lib/utils'
import { ValorClicavel, type AbrirDetalhe } from './DetalheValor'

/**
 * Peças da Visão Geral no redesenho UX (fase 4, 26/11/2026). Os números e as
 * regras de cálculo são os mesmos de antes; muda a leitura: extrato por banco,
 * barra única de classificação, tabelas com total e as listas num card só.
 */

export const corBanco = (nome: string) => {
  const n = nome.toLowerCase()
  return n.includes('ita') ? 'bg-itau' : n.includes('santander') ? 'bg-santander' : 'bg-slate-400'
}

/** Valor com sinal escrito: negativo em vermelho com "−"; `positivoVerde` pinta o positivo. */
export function corValor(v: number, positivoVerde = false) {
  return v < 0 ? 'text-red-700' : positivoVerde && v > 0 ? 'text-green-700' : 'text-slate-900'
}

export function Secao({ titulo, id, acao, nota, children, className, tour }: {
  titulo: string; id: string; acao?: React.ReactNode; nota?: React.ReactNode; children: React.ReactNode
  className?: string; tour?: string
}) {
  return (
    <section aria-labelledby={id} data-tour={tour} className={cn('rounded-2xl border border-gray-200 bg-white p-4 md:p-5', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base font-bold text-slate-900">{titulo}</h2>
        {acao}
      </div>
      {children}
      {nota && <p className="mt-3 text-[13px] text-slate-600">{nota}</p>}
    </section>
  )
}

// ── Saldo do período por banco ───────────────────────────────────
export interface SaldoBanco {
  banco: string; saldoInicial: number; emprestimo: number | null; aplicacao: number | null; saldoBanco: number
}

export function ExtratoBanco({ s, abrir }: { s: SaldoBanco; abrir?: AbrirDetalhe }) {
  const linhas: [string, number | null, string, boolean][] = [
    ['Saldo inicial', s.saldoInicial, 'saldo_inicial', false],
    ['+ Empréstimo (acumulado)', s.emprestimo, 'box_emprestimo', false],
    ['+ Aplicação (acumulado)', s.aplicacao, 'box_aplicacao', false],
    ['+ Movimento do período', s.saldoBanco, 'box_banco', true],
  ]
  const resultado = s.emprestimo == null || s.aplicacao == null ? null : s.saldoInicial + s.emprestimo + s.aplicacao + s.saldoBanco
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <div className="space-y-2 p-4 md:p-5">
        <div className="flex items-center gap-2">
          <span className={cn('h-3 w-3 rounded-[3px]', corBanco(s.banco))} aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-900">{s.banco}</h3>
        </div>
        {linhas.map(([rotulo, valor, bloco, verde]) => (
          <div key={bloco} className="flex min-h-12 items-center justify-between gap-3 text-sm md:min-h-[28px]">
            <span className="text-slate-600">{rotulo}</span>
            {valor == null ? <span className="tabular-nums text-slate-400">—</span> : (
              <ValorClicavel valor={valor} abrir={abrir} className={cn('inline-flex min-h-12 items-center md:min-h-0 font-medium tabular-nums', corValor(valor, verde))}
                pedido={{ titulo: bloco === 'saldo_inicial' ? `Saldo inicial ${s.banco}` : `${rotulo.replace('+ ', '')} · ${s.banco}`, params: { bloco, banco: s.banco } }} />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 bg-navy px-4 py-3.5 text-white md:px-5">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-slate-300">Resultado</span>
        {resultado == null ? <span className="text-xl font-bold tabular-nums text-slate-400">—</span> : (
          <ValorClicavel valor={resultado} abrir={abrir} className="inline-flex min-h-12 items-center md:min-h-0 text-xl font-bold tabular-nums text-white md:text-[22px]"
            pedido={{ titulo: `Resultado ${s.banco}`, params: { bloco: 'resultado', banco: s.banco } }} />
        )}
      </div>
    </article>
  )
}

/** Botão "Como é calculado" com o texto explicativo num balão (sai de dentro dos cards). */
export function ComoCalculado() {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])
  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={() => setAberto(v => !v)} aria-expanded={aberto} aria-controls="como-calculado"
        className="focus-ring inline-flex h-12 items-center rounded-lg px-2 text-sm font-semibold text-sel hover:underline md:h-11">
        Como é calculado
      </button>
      {aberto && (
        <div id="como-calculado" role="dialog" aria-label="Como é calculado"
          className="absolute right-0 z-30 mt-1 w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-4 text-[13px] leading-relaxed text-slate-700 shadow-lg">
          <p><strong>Resultado</strong> = saldo inicial + empréstimo + aplicação + movimento do período, cada um com o próprio sinal (negativo reduz).</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>O <strong>saldo inicial</strong> soma o lançamento de Saldo Inicial e o movimento do banco dos meses anteriores, desde outubro/2026.</li>
            <li><strong>Empréstimo</strong> e <strong>aplicação</strong> também acumulam desde outubro/2026.</li>
            <li>O <strong>movimento</strong> é só do período escolhido.</li>
            <li>Só entram lançamentos com data de pagamento ou de recebimento.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Pagamentos ──────────────────────────────────────────────────
export interface SomaPag { qtd: number; valor: string }
export interface ResumoPagamentos { habilitado: boolean; a_pagar_hoje?: SomaPag; rejeitados?: SomaPag; autorizar?: SomaPag; com_o_banco?: Record<string, SomaPag> }

function BlocoPag({ titulo, s, sub, tom = 'neutro' }: { titulo: string; s?: SomaPag; sub: string; tom?: 'neutro' | 'ambar' | 'vermelho' }) {
  const ativo = !!s?.qtd
  const cls = !ativo ? 'border-gray-200 bg-white' : tom === 'ambar' ? 'border-amber-300 bg-amber-50' : tom === 'vermelho' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
  const corTexto = ativo && tom === 'ambar' ? 'font-semibold text-amber-900' : ativo && tom === 'vermelho' ? 'font-semibold text-red-800' : 'text-slate-600'
  return (
    <Link href="/dashboard/lancamentos/pagamentos" className={cn('focus-ring flex flex-col gap-0.5 rounded-xl border px-4 py-3.5 hover:border-navy/40', cls)}>
      <span className={cn('text-[13px]', corTexto)}>{titulo}</span>
      <span className="text-lg font-bold tabular-nums text-slate-900">{fmtBRL(s?.valor ?? 0)}</span>
      <span className={cn('text-[13px]', ativo && tom !== 'neutro' ? corTexto.replace('font-semibold ', '') : 'text-slate-600')}>
        {s?.qtd ?? 0} pagamento{s?.qtd === 1 ? '' : 's'}{sub ? ` · ${sub}` : ''}
      </span>
    </Link>
  )
}

export function FaixaPagamentos({ r }: { r: ResumoPagamentos }) {
  const bancos = Object.entries(r.com_o_banco ?? {})
  const comBanco: [string, SomaPag | undefined] = bancos.length === 1 ? [`Com o ${bancos[0][0]}`, bancos[0][1]]
    : ['Com os bancos', bancos.length ? { qtd: bancos.reduce((a, [, s]) => a + s.qtd, 0), valor: String(bancos.reduce((a, [, s]) => a + Number(s.valor), 0)) } : undefined]
  return (
    <section aria-labelledby="pag-titulo" data-tour="pagamentos-resumo" className="space-y-2.5">
      <h2 id="pag-titulo" className="text-base font-bold text-slate-900">Pagamentos</h2>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <BlocoPag titulo="A pagar até hoje" s={r.a_pagar_hoje} sub="" />
        <BlocoPag titulo={`${comBanco[0]}, aguardando retorno`} s={comBanco[1]} sub="" />
        <BlocoPag titulo="Autorizar no banco" s={r.autorizar} sub="" tom="ambar" />
        <BlocoPag titulo="Rejeitados ou devolvidos" s={r.rejeitados} sub="voltaram para A pagar" tom="vermelho" />
      </div>
    </section>
  )
}

// ── Despesas por classificação (barra única) ─────────────────────
export interface FatiaClass { codigo: string; nome: string; valor: number; cor: string; revisar?: boolean }

export function BarraClassificacao({ fatias, total, abrir }: { fatias: FatiaClass[]; total: number; abrir?: AbrirDetalhe }) {
  const visiveis = fatias.filter(f => f.valor > 0)
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0)
  return (
    <>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {visiveis.map(f => <span key={f.codigo} className={f.cor} style={{ width: `${(f.valor / (total || 1)) * 100}%` }} />)}
      </div>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {visiveis.map(f => (
          <li key={f.codigo} className="flex min-h-12 items-center gap-3 md:min-h-11">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', f.cor)} aria-hidden="true" />
            <span className="flex-1 text-slate-800">
              {f.nome}{f.revisar && <span className="text-[13px] font-semibold text-red-700"> · classificar</span>}
            </span>
            <span className="w-12 text-right tabular-nums text-slate-600">{pct(f.valor)}%</span>
            <ValorClicavel valor={f.valor} abrir={abrir} className="inline-flex min-h-12 items-center md:min-h-0 w-32 justify-end text-right font-semibold tabular-nums text-slate-900"
              pedido={{ titulo: `Despesas: ${f.nome}`, params: { bloco: 'classificacao', classificacao: f.codigo } }} />
          </li>
        ))}
        {visiveis.length === 0 && <li className="py-3 text-slate-600">Nenhuma despesa classificada no período.</li>}
      </ul>
    </>
  )
}

// ── Tabelas com linha de total ───────────────────────────────────
export interface LinhaTabela { chave: string; banco: string; valores: { v: number; pedido: { titulo: string; params: Record<string, string> }; verde?: boolean }[] }

export function TabelaTotal({ colunas, linhas, total, abrir }: {
  colunas: string[]; linhas: LinhaTabela[]; total?: LinhaTabela; abrir?: AbrirDetalhe
}) {
  const th = 'px-3 py-2.5 text-[13px] font-semibold text-slate-600'
  const celula = (l: LinhaTabela, negrito = false) => l.valores.map((c, i) => (
    <td key={i} className="px-3 py-2.5 text-right">
      <ValorClicavel valor={c.v} abrir={abrir} pedido={c.pedido}
        className={cn('tabular-nums', negrito ? 'font-bold' : 'font-medium', corValor(c.v, c.verde))} />
    </td>
  ))
  return (
    <div className="-mx-4 overflow-x-auto md:-mx-5">
      <table className="w-full min-w-[30rem] text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className={cn(th, 'pl-4 text-left md:pl-5')}>Banco</th>
            {colunas.map(c => <th key={c} scope="col" className={cn(th, 'text-right last:pr-4 md:last:pr-5')}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.chave} className="border-t border-slate-100">
              <td className="py-2.5 pl-4 pr-3 md:pl-5">
                <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                  <span className={cn('h-2.5 w-2.5 rounded-full', corBanco(l.banco))} aria-hidden="true" />{l.banco}
                </span>
              </td>
              {celula(l)}
            </tr>
          ))}
          {total && (
            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="py-2.5 pl-4 pr-3 font-bold text-slate-900 md:pl-5">Total</td>
              {celula(total, true)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
