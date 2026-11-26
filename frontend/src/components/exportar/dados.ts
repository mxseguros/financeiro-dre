import { api, API_BASE } from '@/lib/api'
import { fmtBRL } from '@/lib/utils'

/**
 * Dados da janela Exportar (redesenho UX, fase 8). Cada alvo vira uma tabela
 * simples (colunas + linhas + total) que serve à prévia, à imagem, ao WhatsApp
 * e ao CSV. A DRE em Excel/PDF continua saindo do servidor (/exports/dre/*).
 */

export type Alvo = 'dre' | 'visao' | 'lancamentos'
export type Formato = 'xlsx' | 'pdf' | 'png' | 'whatsapp'

export interface Tabela {
  titulo: string
  colunas: string[]
  /** Valores numéricos ficam como número (CSV e alinhamento à direita). */
  linhas: (string | number)[][]
  total?: { rotulo: string; valor: number }
  /** Linhas de resumo para o topo do texto do WhatsApp. */
  resumo?: { rotulo: string; valor: string }[]
}

/** Filtros da tela de Lançamentos, que a página registra para o Exportar levar junto. */
export const filtrosExport = { lancamentos: '' }

const n = (v: unknown) => Number(v ?? 0) || 0

export async function carregarTabela(alvo: Alvo, token: string, qs: string, mesRef: string, esconderConfidencial: boolean): Promise<Tabela> {
  if (alvo === 'dre') {
    const [ano, mes] = [Number(mesRef.slice(0, 4)), Number(mesRef.slice(5, 7))]
    const d = await api.get<{
      kpis: Record<string, { realizado: number | null; previsto: number | null }>
      linhas: { tipo: string; codigo: string; nome: string; previsto?: number | null; realizado?: number | null }[]
    }>(`/dre/previsto-realizado?ano=${ano}&mes=${mes}&visao=mes`, token)
    const linhas = d.linhas.filter(l => l.tipo !== 'secao')
      .map(l => [`${l.tipo === 'resultado' ? '= ' : ''}${l.nome}`, n(l.previsto), n(l.realizado), n(l.realizado) - n(l.previsto)])
    const rl = d.kpis.resultado_liquido
    return {
      titulo: 'DRE', colunas: ['Conta', 'Previsto', 'Realizado', 'Diferença'], linhas,
      total: { rotulo: 'Resultado líquido', valor: n(rl?.realizado) },
      resumo: [
        { rotulo: 'Receita', valor: fmtBRL(n(d.kpis.receita?.realizado)) },
        { rotulo: 'Margem de contribuição', valor: fmtBRL(n(d.kpis.margem?.realizado)) },
        { rotulo: 'Resultado líquido', valor: fmtBRL(n(rl?.realizado)) },
      ],
    }
  }
  if (alvo === 'visao') {
    const [pb, cl] = await Promise.all([
      api.get<{ bancos: { banco_nome: string; receitas: string; despesas: string; saldo: string }[] }>(`/dashboard/por-banco?${qs}`, token),
      api.get<{ fixas: number; variaveis: number; impostos: number; nao_operacionais: number; nao_classificadas: number; total: number }>(`/dashboard/despesas-por-classificacao?${qs}`, token).catch(() => null),
    ])
    const linhas: (string | number)[][] = pb.bancos.map(b => [b.banco_nome, n(b.receitas), n(b.despesas), n(b.saldo)])
    const tr = linhas.reduce((a, l) => a + n(l[1]), 0), td = linhas.reduce((a, l) => a + n(l[2]), 0)
    return {
      titulo: 'Visão Geral · por banco', colunas: ['Banco', 'Receitas', 'Despesas', 'Saldo'], linhas,
      total: { rotulo: 'Saldo (todos os bancos)', valor: tr - td },
      resumo: [
        { rotulo: 'Receitas', valor: fmtBRL(tr) }, { rotulo: 'Despesas', valor: fmtBRL(td) },
        ...(cl ? [{ rotulo: 'Fixas', valor: fmtBRL(n(cl.fixas)) }, { rotulo: 'Variáveis', valor: fmtBRL(n(cl.variaveis)) }] : []),
      ],
    }
  }
  // Lançamentos: despesas e receitas do período, com os filtros da tela.
  const filtros = filtrosExport.lancamentos || qs
  const [desp, rec, tipos] = await Promise.all([
    api.get<{ items: { descricao: string; tipo_nome: string | null; tipo_lancamento_id: string | null; centro_custo: string; banco_nome: string | null; valor: number; data_vencimento: string | null; paga_em: string | null; agregado?: boolean }[] }>(`/lancamentos/despesas?${filtros}&limit=1000&offset=0`, token),
    api.get<{ items: { descricao: string; tipo_nome: string | null; tipo_lancamento_id: string | null; banco_nome: string | null; valor: number; data_vencimento: string | null; recebido_em: string | null; somente_dre?: boolean }[] }>(`/lancamentos/receitas?${filtros}`, token),
    esconderConfidencial ? api.get<{ id: string; confidencial?: boolean }[]>('/configuracoes/tipos', token).catch(() => []) : Promise.resolve([]),
  ])
  const confid = new Set(tipos.filter(t => t.confidencial).map(t => t.id))
  const ddmmaa = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
  const linhas: (string | number)[][] = []
  let salarios = 0
  for (const d of desp.items) {
    if (confid.has(d.tipo_lancamento_id ?? '')) { salarios += n(d.valor); continue }
    linhas.push([ddmmaa(d.paga_em ?? d.data_vencimento), 'Despesa', d.descricao, d.tipo_nome ?? '', d.banco_nome ?? '', d.paga_em ? 'Paga' : 'A pagar', -n(d.valor)])
  }
  if (salarios) linhas.push(['', 'Despesa', 'Total Salários Funcionários', 'Salários', '', '', -salarios])
  for (const r of rec.items) {
    linhas.push([ddmmaa(r.recebido_em ?? r.data_vencimento), 'Receita', r.descricao + (r.somente_dre ? ' (só DRE)' : ''), r.tipo_nome ?? '', r.banco_nome ?? '', r.recebido_em ? 'Recebida' : 'A receber', n(r.valor)])
  }
  const soma = linhas.reduce((a, l) => a + n(l[6]), 0)
  const td = linhas.filter(l => l[1] === 'Despesa').reduce((a, l) => a - n(l[6]), 0)
  const tr = linhas.filter(l => l[1] === 'Receita').reduce((a, l) => a + n(l[6]), 0)
  return {
    titulo: 'Lançamentos', colunas: ['Data', 'Tipo', 'Descrição', 'Subitem', 'Banco', 'Situação', 'Valor'], linhas,
    total: { rotulo: 'Saldo (receitas − despesas)', valor: soma },
    resumo: [{ rotulo: 'Receitas', valor: fmtBRL(tr) }, { rotulo: 'Despesas', valor: fmtBRL(td) }],
  }
}

/** CSV que o Excel abre (UTF-8 com BOM, ponto e vírgula, decimal com vírgula). */
export function paraCsv(t: Tabela): Blob {
  const cel = (v: string | number) => typeof v === 'number'
    ? v.toFixed(2).replace('.', ',')
    : `"${String(v).replace(/"/g, '""')}"`
  const linhas = [t.colunas.map(cel).join(';'), ...t.linhas.map(l => l.map(cel).join(';'))]
  if (t.total) linhas.push([cel(t.total.rotulo), ...t.colunas.slice(2).map(() => ''), cel(t.total.valor)].join(';'))
  return new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

/** PDF pela impressão do navegador ("Salvar como PDF"). */
export function imprimir(t: Tabela, periodo: string) {
  const w = window.open('', '_blank', 'noopener=no,width=1000,height=800')
  if (!w) throw new Error('O navegador bloqueou a janela de impressão. Libere pop-ups para este site.')
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const td = (v: string | number) => typeof v === 'number'
    ? `<td style="text-align:right">${esc(fmtBRL(v))}</td>` : `<td>${esc(String(v))}</td>`
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(t.titulo)} · ${esc(periodo)}</title>
<style>body{font:13px Inter,system-ui,sans-serif;color:#0f172a;margin:24px}h1{font-size:18px;margin:0}p{color:#475569;margin:4px 0 16px}
table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}th{background:#f8fafc}
tfoot td{font-weight:700;border-top:2px solid #0f172a}</style></head><body>
<h1>MX Seguros · ${esc(t.titulo)}</h1><p>${esc(periodo)}</p>
<table><thead><tr>${t.colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>${t.linhas.map(l => `<tr>${l.map(td).join('')}</tr>`).join('')}</tbody>
${t.total ? `<tfoot><tr><td colspan="${t.colunas.length - 1}">${esc(t.total.rotulo)}</td><td style="text-align:right">${esc(fmtBRL(t.total.valor))}</td></tr></tfoot>` : ''}
</table></body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

export async function baixarDoServidor(formato: 'xlsx' | 'pdf', token: string, inicio: string, fim: string, nome: string) {
  const res = await fetch(`${API_BASE}/exports/dre/${formato}?inicio=${inicio}&fim=${fim}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.detail ?? `Não foi possível gerar o arquivo (HTTP ${res.status}).`)
  }
  baixarBlob(await res.blob(), nome)
}

export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function textoWhatsApp(t: Tabela, periodo: string): string {
  const linha = '─────────────────────'
  const topo = t.resumo?.length ? t.resumo.map(r => `${r.rotulo}: ${r.valor}`).join('\n') + `\n${linha}\n` : ''
  const corpo = t.linhas.slice(0, 12).map(l => `• ${l.filter(v => typeof v === 'string' && v).slice(0, 2).join(' — ')} — ${fmtBRL(Number(l[l.length - 1]) || 0)}`).join('\n')
  const mais = t.linhas.length > 12 ? `\n…e mais ${t.linhas.length - 12} linha(s)` : ''
  const total = t.total ? `\n${linha}\n${t.total.rotulo}: ${fmtBRL(t.total.valor)}` : ''
  return `📊 ${t.titulo} — ${periodo}\n${linha}\n${topo}${corpo}${mais}${total}`
}
