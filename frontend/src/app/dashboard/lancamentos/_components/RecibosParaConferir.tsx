// Recibos das Ordens de Compra aprovadas, enviados pelo funcionário no /oc,
// esperando a conferência do financeiro (migration 0048, 24/11/2026):
// "Recibo OK" conclui; "Devolver" pede outro, com o motivo.
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { fmtBRL, fmtData } from '@/lib/utils'
import { abrirAnexo, type Anexo } from '@/components/anexos/CampoAnexos'
import { Spinner } from '@/components/ui/Button'
import type { OrdemCompra, OrdensCompraResp } from './shared'

function somarDias(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}

function CartaoRecibo({ ordem, token, onConferido }: {
  ordem: OrdemCompra; token: string; onConferido: (msg: string) => void
}) {
  const [recibo, setRecibo] = useState<Anexo | null>(null)
  const [imagem, setImagem] = useState<string | null>(null)
  const [devolvendo, setDevolvendo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    api.get<Anexo[]>(`/anexos?entidade=ordem_compra&entidade_id=${ordem.id}`, token)
      .then(async lista => {
        // O último comprovante é o que foi enviado para conferência.
        const ultimo = [...lista].reverse().find(a => a.tipo_documento === 'comprovante') ?? null
        if (!vivo) return
        setRecibo(ultimo)
        if (ultimo?.mime?.startsWith('image/')) {
          const { url } = await api.get<{ url: string }>(`/anexos/${ultimo.id}/url`, token)
          if (vivo) setImagem(url)
        }
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [ordem.id, token])

  async function conferir(ok: boolean) {
    if (!ok && motivo.trim().length < 3) { setErro('Diga ao funcionário o que está errado.'); return }
    setOcupado(true); setErro(null)
    try {
      await api.post(`/ordens-compra/${ordem.id}/recibo/conferir`, token, ok ? { ok } : { ok, motivo: motivo.trim() })
      onConferido(ok ? `Recibo de "${ordem.assunto}" conferido.` : `Recibo de "${ordem.assunto}" devolvido ao funcionário.`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível conferir.')
      setOcupado(false)
    }
  }

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-amber-200 bg-white">
      <button type="button" onClick={() => recibo && abrirAnexo(token, recibo.id).catch(() => {})}
        disabled={!recibo} title="Abrir o recibo"
        className="focus-ring flex h-40 items-center justify-center bg-slate-50 text-sm text-slate-600 hover:bg-slate-100">
        {imagem
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={imagem} alt={`Recibo de ${ordem.assunto}`} className="h-full w-full object-contain" />
          : recibo ? <span>📄 {recibo.nome_arquivo}</span> : <Spinner className="text-navy" />}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-1 text-[15px] font-semibold text-slate-900">{ordem.assunto}</p>
          <span className="whitespace-nowrap text-[15px] font-bold tabular-nums text-slate-900">{ordem.valor != null ? fmtBRL(ordem.valor) : '—'}</span>
        </div>
        <p className="text-[13px] text-slate-600">{ordem.solicitante} · {fmtData(ordem.data_prevista ?? ordem.data_solicitacao)}</p>

        {devolvendo ? (
          <div className="space-y-2">
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} autoFocus maxLength={500}
              placeholder="Ex.: foto cortada, falta o CNPJ, valor diferente…" aria-label="Motivo da devolução"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-navy focus-ring focus:outline-none" />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setDevolvendo(false); setErro(null) }} disabled={ocupado}
                className="focus-ring h-11 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-slate-700 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={() => conferir(false)} disabled={ocupado}
                className="focus-ring h-11 flex-1 rounded-lg bg-red-700 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">Devolver</button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex gap-2">
            <button type="button" onClick={() => conferir(true)} disabled={ocupado || !recibo}
              className="focus-ring h-11 flex-1 rounded-lg bg-navy text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50">
              Recibo OK
            </button>
            <button type="button" onClick={() => setDevolvendo(true)} disabled={ocupado}
              className="focus-ring h-11 flex-1 rounded-lg border border-gray-300 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">
              Devolver
            </button>
          </div>
        )}
        {erro && <p role="alert" className="text-[13px] text-red-800">{erro}</p>}
      </div>
    </li>
  )
}

/** Seção de Aprovações. Olha os últimos 12 meses, independente do período
 *  escolhido: recibo pendente de conferência não pode sumir da tela. */
export function RecibosParaConferir({ token, onMudou }: { token: string; onMudou?: () => void }) {
  const [ordens, setOrdens] = useState<OrdemCompra[]>([])
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(() => {
    api.get<OrdensCompraResp>(`/ordens-compra?inicio=${somarDias(-365)}&fim=${somarDias(0)}&status=aprovada`, token)
      .then(r => setOrdens(r.items.filter(o => o.recibo_status === 'enviado')))
      .catch(() => {})
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  const [aberta, setAberta] = useState(false)
  if (!ordens.length && !aviso) return null
  return (
    <section aria-labelledby="recibos-conferir" className="rounded-xl border border-amber-300 bg-amber-50">
      <h2 id="recibos-conferir">
        <button type="button" onClick={() => setAberta(v => !v)} aria-expanded={aberta} disabled={!ordens.length}
          className="focus-ring flex min-h-12 w-full items-center gap-2.5 rounded-xl px-4 text-left text-sm text-amber-900 md:min-h-11">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 shrink-0" aria-hidden="true">
            <path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" />
          </svg>
          <span className="flex-1">
            {ordens.length
              ? <><b>{ordens.length} recibo{ordens.length > 1 ? 's' : ''}</b> de ordens aprovadas para conferir · enviados pelos funcionários no /oc</>
              : 'Nenhum recibo para conferir agora.'}
          </span>
          {ordens.length > 0 && <span className="shrink-0 font-semibold">{aberta ? 'Fechar' : 'Conferir'}</span>}
        </button>
      </h2>
      {aviso && <p role="status" className="px-4 pb-2 text-[13px] text-green-800">{aviso}</p>}
      {aberta && ordens.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {ordens.map(o => (
            <CartaoRecibo key={o.id} ordem={o} token={token}
              onConferido={msg => { setAviso(msg); carregar(); onMudou?.() }} />
          ))}
        </ul>
      )}
    </section>
  )
}
