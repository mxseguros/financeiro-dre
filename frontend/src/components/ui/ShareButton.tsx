'use client'
import { useRef, useState, useEffect } from 'react'
import { toPng } from 'html-to-image'
import { fmtBRL, fmtData } from '@/lib/utils'

export interface ShareItem {
  nome: string
  valor?: number | null
  data?: string | null
  status?: string | null
}

/** Total em destaque no topo do compartilhamento (ex.: Despesas/Receitas/Saldo). */
export interface ShareResumoItem {
  rotulo: string
  valor: string
  /** Cor do valor no PNG (hex). O texto do WhatsApp é puro e ignora isto. */
  cor?: string
}

interface ShareButtonProps {
  titulo: string
  periodoLabel: string
  itens: ShareItem[]
  resumo?: ShareResumoItem[]
  totalTexto?: string
  emoji?: string
}

const STATUS_LABEL: Record<string, string> = { pendente: 'Pendente', aprovada: 'Aprovada', rejeitada: 'Rejeitada' }
const STATUS_COR: Record<string, string> = {
  pendente: '#b45309', aprovada: '#15803d', rejeitada: '#dc2626',
}

const IconShare = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
)

export function ShareButton({ titulo, periodoLabel, itens, resumo, totalTexto, emoji = '📋' }: ShareButtonProps) {
  const [aberto, setAberto] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Fecha o popover ao clicar fora
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  function montarTexto(): string {
    const linha = '─────────────────────'
    const top = itens.slice(0, 10)
    const corpo = top.map(it => {
      const st = it.status ? `[${STATUS_LABEL[it.status] ?? it.status}] ` : ''
      const val = it.valor && it.valor > 0 ? ` — ${fmtBRL(it.valor)}` : ''
      const dt = it.data ? ` — ${fmtData(it.data)}` : ''
      return `• ${st}${it.nome}${val}${dt}`
    }).join('\n')
    const maisItens = itens.length > 10 ? `\n…e mais ${itens.length - 10} item(ns)` : ''
    const rodape = totalTexto ? `\n${linha}\n${totalTexto}` : `\n${linha}\nTotal: ${itens.length} item(ns)`
    // Os totais vêm antes da lista: é a informação que se lê primeiro no WhatsApp.
    const topo = resumo?.length
      ? `${resumo.map(r => `${r.rotulo}: ${r.valor}`).join('\n')}\n${linha}\n`
      : ''
    return `${emoji} ${titulo} — ${periodoLabel}\n${linha}\n${topo}${corpo}${maisItens}${rodape}`
  }

  function enviarWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(montarTexto())}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setAberto(false)
  }

  async function compartilharImagem() {
    if (!cardRef.current) return
    setGerando(true)
    setFeedback(null)
    try {
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true })
      const blob = await (await fetch(dataUrl)).blob()
      const fileName = `${titulo.toLowerCase().replace(/\s+/g, '-')}-${periodoLabel.replace(/\W+/g, '-')}.png`
      const file = new File([blob], fileName, { type: 'image/png' })

      // Mobile com Web Share API + arquivos: share nativo (inclui WhatsApp).
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: titulo })
        setAberto(false)
      } else {
        // Desktop: download do PNG.
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = fileName
        a.click()
        setFeedback('Imagem baixada ✓')
      }
    } catch {
      setFeedback('Não foi possível gerar a imagem.')
    } finally {
      setGerando(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setAberto(a => !a)}
        title="Compartilhar"
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-navy transition-colors"
      >
        <IconShare />
        Compartilhar
      </button>

      {aberto && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-xl border border-gray-100 bg-white p-1.5 shadow-lg">
          <button
            onClick={enviarWhatsApp}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-green-600">
              <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.6.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.6-1.5-.9-2-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 2.8 4.4 3.9.6.3 1.1.4 1.5.5.6.2 1.2.2 1.6.1.5-.1 1.7-.7 1.9-1.3.2-.7.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.9-1.3A10 10 0 1 0 12 2z"/>
            </svg>
            Enviar por WhatsApp
          </button>
          <button
            onClick={compartilharImagem}
            disabled={gerando}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 text-blue-500">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            {gerando ? 'Gerando…' : 'Compartilhar como imagem'}
          </button>
          {feedback && <p className="px-2.5 py-1 text-[11px] text-gray-400">{feedback}</p>}
        </div>
      )}

      {/* Card oculto usado para gerar o PNG (fundo sólido + logo + itens) */}
      <div style={{ position: 'fixed', left: -9999, top: 0, pointerEvents: 'none' }} aria-hidden>
        <div ref={cardRef} style={{ width: 380, background: '#ffffff', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo_navy.png" alt="MX" width={120} height={40} style={{ objectFit: 'contain', marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#071934' }}>{titulo}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>{periodoLabel}</div>
          {resumo && resumo.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, padding: '8px 10px', borderRadius: 10, background: '#f9fafb' }}>
              {resumo.map((r, i) => (
                <div key={i} style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: '#9ca3af' }}>{r.rotulo}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: r.cor ?? '#071934', whiteSpace: 'nowrap' }}>{r.valor}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: '1px solid #eef1f6' }}>
            {itens.slice(0, 15).map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.status ? <span style={{ color: STATUS_COR[it.status] ?? '#6b7280', fontWeight: 600 }}>[{STATUS_LABEL[it.status] ?? it.status}] </span> : null}
                  {it.nome}
                </span>
                <span style={{ color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {it.valor && it.valor > 0 ? fmtBRL(it.valor) : it.data ? fmtData(it.data) : ''}
                </span>
              </div>
            ))}
            {itens.length > 15 && (
              <div style={{ padding: '6px 0', fontSize: 11, color: '#9ca3af' }}>…e mais {itens.length - 15} item(ns)</div>
            )}
          </div>
          {totalTexto && (
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: '#071934' }}>{totalTexto}</div>
          )}
        </div>
      </div>
    </div>
  )
}
