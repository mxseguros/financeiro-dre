'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { api, API_BASE } from '@/lib/api'
import { cn } from '@/lib/utils'
import { filtroDoPeriodo, usePeriodo } from '@/contexts/PeriodoContext'
import { useTopBar } from '@/contexts/TopBarContext'
import { Modal } from '@/components/ui/Modal'
import { Markdown } from '@/components/assistente/Markdown'

interface Conversa { id: string; titulo: string | null; criada_em: string; atualizada_em: string | null }
interface Mensagem { role: 'user' | 'assistant'; texto: string; erro?: boolean }

const SUGESTOES = [
  'Quanto gastamos com despesas fixas neste período?',
  'Qual foi o resultado líquido em relação à meta?',
  'Quais despesas estão vencidas e ainda não foram pagas?',
  'Como estão as receitas por banco no período?',
]
const PROXIMAS = ['Compare com o mês anterior', 'Quais foram as 5 maiores despesas?', 'Explique a diferença para a meta']

/** O backend só recebe o texto: o período vai escrito no começo da pergunta. */
function comPeriodo(pergunta: string, rotulo: string, inicio: string, fim: string) {
  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
  return `[Período da tela: ${rotulo} (${br(inicio)} a ${br(fim)}), todos os centros de custo]\n${pergunta}`
}
const semPeriodo = (t: string) => t.replace(/^\[Período da tela:[^\]]*\]\n/, '')

function grupoData(iso: string | null): 'Hoje' | 'Esta semana' | 'Antes' {
  if (!iso) return 'Antes'
  const d = new Date(iso), h = new Date()
  if (d.toDateString() === h.toDateString()) return 'Hoje'
  return h.getTime() - d.getTime() < 7 * 86_400_000 ? 'Esta semana' : 'Antes'
}

/**
 * Assistente IA (redesenho UX, fase 9 — spec §9): conversa com o POST /chat
 * (SSE), histórico de GET /chat/conversas, período global no texto da
 * pergunta. Limite do backend: 10 mensagens por minuto.
 */
export default function AssistentePage() {
  const { token } = useAuth()
  const periodo = usePeriodo()
  const filtro = filtroDoPeriodo(periodo, true)
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [conversaId, setConversaId] = useState<string | null>(null)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [historicoCelular, setHistoricoCelular] = useState(false)
  const [copiado, setCopiado] = useState<number | null>(null)
  const fim = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  const carregarConversas = useCallback(() => {
    if (!token) return
    api.get<{ items: Conversa[] }>('/chat/conversas', token).then(r => setConversas(r.items)).catch(() => {})
  }, [token])
  useEffect(() => { carregarConversas() }, [carregarConversas])
  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [mensagens, consultando])

  // Celular: histórico atrás do ícone de relógio no cabeçalho.
  useTopBar({
    acao: (
      <button type="button" onClick={() => setHistoricoCelular(true)} aria-label="Histórico de conversas"
        className="focus-ring flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 bg-white text-slate-700 md:hidden">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      </button>
    ),
  }, [])

  function novaConversa() {
    setConversaId(null); setMensagens([]); setHistoricoCelular(false)
    setTimeout(() => campo.current?.focus(), 0)
  }

  async function abrirConversa(id: string) {
    if (!token) return
    setHistoricoCelular(false)
    try {
      const r = await api.get<{ mensagens: { role: string; content?: string; conteudo?: string }[] }>(`/chat/conversas/${id}/mensagens`, token)
      setConversaId(id)
      setMensagens(r.mensagens.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', texto: semPeriodo(m.content ?? m.conteudo ?? '') })))
    } catch { /* conversa sumiu: segue na atual */ }
  }

  async function enviar(pergunta: string) {
    const p = pergunta.trim()
    if (!p || !token || enviando) return
    setTexto('')
    setEnviando(true)
    setMensagens(m => [...m, { role: 'user', texto: p }, { role: 'assistant', texto: '' }])
    const escrever = (f: (t: string) => string, erro = false) =>
      setMensagens(m => { const n = [...m]; const u = n[n.length - 1]; n[n.length - 1] = { ...u, texto: f(u.texto), erro: erro || u.erro }; return n })
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mensagem: comPeriodo(p, filtro.rotulo, filtro.inicio, filtro.fim), conversa_id: conversaId }),
      })
      if (res.status === 429) throw new Error('Você enviou muitas perguntas seguidas (limite de 10 por minuto). Espere um minuto e tente de novo.')
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({}))
        throw new Error(typeof b?.detail === 'string' ? b.detail : 'Não foi possível falar com o assistente agora.')
      }
      let recebeu = false
      const leitor = res.body.getReader()
      const dec = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await leitor.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })
        const eventos = buffer.split('\n\n')
        buffer = eventos.pop() ?? ''
        for (const ev of eventos) {
          const linha = ev.split('\n').find(l => l.startsWith('data:'))
          if (!linha) continue
          let d: { tipo: string; conteudo?: string; conversa_id?: string; status?: string; mensagem?: string }
          try { d = JSON.parse(linha.slice(5).trim()) } catch { continue }
          if (d.tipo === 'conversa_id' && d.conversa_id) setConversaId(d.conversa_id)
          else if (d.tipo === 'texto' && d.conteudo) { const c = d.conteudo; recebeu = true; setConsultando(false); escrever(t => t + c) }
          else if (d.tipo === 'tool') setConsultando(d.status === 'chamando')
          else if (d.tipo === 'erro') { const msg = d.mensagem ?? 'Erro no assistente.'; recebeu = true; escrever(t => t + (t ? '\n\n' : '') + msg, true) }
        }
      }
      if (!recebeu) throw new Error('O assistente não respondeu. Tente de novo em instantes.')
    } catch (e) {
      escrever(() => e instanceof Error ? e.message : 'Não foi possível falar com o assistente.', true)
    } finally {
      setEnviando(false); setConsultando(false)
      carregarConversas()
    }
  }

  async function copiar(i: number, t: string) {
    try { await navigator.clipboard.writeText(t); setCopiado(i); setTimeout(() => setCopiado(null), 2000) } catch { /* sem permissão */ }
  }

  const grupos = (['Hoje', 'Esta semana', 'Antes'] as const)
    .map(g => ({ g, itens: conversas.filter(c => grupoData(c.atualizada_em ?? c.criada_em) === g) }))
    .filter(x => x.itens.length)

  const Historico = (
    <div className="flex h-full flex-col">
      <button type="button" onClick={novaConversa}
        className="focus-ring mb-3 inline-flex h-12 items-center justify-center rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-light md:h-11">
        + Nova conversa
      </button>
      <nav aria-label="Conversas anteriores" className="flex-1 overflow-y-auto">
        {grupos.length === 0 && <p className="px-2 text-[13px] text-slate-600">As conversas aparecem aqui.</p>}
        {grupos.map(({ g, itens }) => (
          <div key={g} className="mb-3">
            <p className="px-2 pb-1 text-[13px] font-semibold text-slate-500">{g}</p>
            <ul>
              {itens.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => abrirConversa(c.id)} aria-current={c.id === conversaId ? 'page' : undefined}
                    className={cn('focus-ring flex min-h-12 w-full items-center rounded-lg px-2 text-left text-sm md:min-h-11',
                      c.id === conversaId ? 'bg-sel-bg font-semibold text-sel-text' : 'text-slate-700 hover:bg-slate-50')}>
                    <span className="line-clamp-2">{semPeriodo(c.titulo ?? '') || 'Conversa sem título'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )

  const ultimaResposta = [...mensagens].reverse().find(m => m.role === 'assistant' && m.texto && !m.erro)

  return (
    <div className="flex gap-5">
      <aside className="hidden w-[280px] shrink-0 md:block">
        <div className="sticky top-24 h-[calc(100vh-8rem)] rounded-2xl border border-gray-200 bg-white p-3">{Historico}</div>
      </aside>
      <Modal open={historicoCelular} onClose={() => setHistoricoCelular(false)} title="Conversas" variant="sheet">{Historico}</Modal>

      <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
        <p className="mb-3 inline-flex self-start rounded-full border border-sel bg-sel-bg px-3 py-1.5 text-[13px] font-semibold text-sel-text">
          Respondendo sobre {filtro.rotulo} · todos os centros
        </p>

        {mensagens.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <h2 className="text-2xl font-bold text-slate-900">O que você quer saber?</h2>
            <p className="mt-1 text-sm text-slate-600">Pergunte sobre lançamentos, DRE, bancos e metas.</p>
            <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGESTOES.map(s => (
                <button key={s} type="button" onClick={() => enviar(s)} disabled={enviando}
                  className="focus-ring min-h-12 rounded-xl border border-gray-300 bg-white px-4 py-3 text-left text-sm text-slate-800 hover:bg-gray-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 space-y-4 pb-4" aria-live="polite">
            {mensagens.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-navy px-4 py-2.5 text-[15px] text-white">{m.texto}</p>
              </div>
            ) : (
              <div key={i} className={cn('rounded-2xl border bg-white px-4 py-3', m.erro ? 'border-red-200' : 'border-gray-200')}>
                {m.texto ? (m.erro ? <p role="alert" className="text-sm text-red-800">{m.texto}</p> : <Markdown texto={m.texto} />)
                  : <p className="text-sm text-slate-600">{consultando ? 'Consultando lançamentos…' : 'Pensando…'}</p>}
                {m.texto && consultando && i === mensagens.length - 1 && <p className="mt-2 text-[13px] text-slate-600">Consultando lançamentos…</p>}
                {m.texto && !m.erro && !(enviando && i === mensagens.length - 1) && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                    {/dre|resultado|margem|meta/i.test(m.texto) && <Link href="/dashboard/dre" className="focus-ring inline-flex h-12 items-center rounded-lg px-2 text-sm font-semibold md:h-11 text-sel hover:underline">Abrir na DRE</Link>}
                    {/lançamento|despesa|receita|vencid/i.test(m.texto) && <Link href="/dashboard/lancamentos" className="focus-ring inline-flex h-12 items-center rounded-lg px-2 text-sm font-semibold md:h-11 text-sel hover:underline">Ver lançamentos</Link>}
                    <button type="button" onClick={() => copiar(i, m.texto)} className="focus-ring inline-flex h-12 items-center rounded-lg px-2 text-sm font-semibold md:h-11 text-slate-700 hover:underline">
                      {copiado === i ? 'Copiado ✓' : 'Copiar resposta'}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {ultimaResposta && !enviando && (
              <div className="flex flex-wrap gap-2" aria-label="Próximas perguntas">
                {PROXIMAS.map(s => (
                  <button key={s} type="button" onClick={() => enviar(s)}
                    className="focus-ring h-12 rounded-full border border-gray-300 bg-white px-4 text-sm md:h-11 text-slate-700 hover:bg-gray-50">{s}</button>
                ))}
              </div>
            )}
            <div ref={fim} />
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); enviar(texto) }}
          className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] mt-2 rounded-2xl border border-gray-300 bg-white p-2 shadow-sm md:bottom-4">
          <label htmlFor="pergunta" className="sr-only">Sua pergunta</label>
          <div className="flex items-end gap-2">
            <textarea ref={campo} id="pergunta" rows={1} value={texto} maxLength={1800} disabled={enviando}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(texto) } }}
              placeholder="Pergunte sobre os números do período…"
              className="max-h-40 min-h-12 flex-1 resize-none rounded-xl px-3 py-3 text-base text-slate-900 outline-none md:min-h-11 md:text-[15px]" />
            <button type="submit" disabled={enviando || !texto.trim()}
              className="focus-ring h-12 shrink-0 rounded-xl bg-navy px-5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50 md:h-11">
              {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
          <p className="px-3 pb-1 pt-1 text-[13px] text-slate-600">O assistente só vê o que o seu perfil pode ver. Enter envia; Shift+Enter quebra a linha.</p>
        </form>
      </section>
    </div>
  )
}
