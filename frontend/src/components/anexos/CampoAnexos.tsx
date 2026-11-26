'use client'
// Anexos de lançamento — Nota Fiscal, Boleto, comprovante (24/11/2026).
//
// O arquivo vai direto do navegador para o Storage do Supabase por uma URL
// assinada que a API gera depois de conferir o acesso ao lançamento (a função
// da Vercel limita o corpo a 4,5 MB, então ele não passa pela API).
//
// Dois modos:
//  * lançamento já salvo (entidadeId): envia e remove na hora;
//  * lançamento novo: guarda os arquivos em `pendentes`; quem chama envia com
//    enviarAnexos() depois que o save devolve o id.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { createClient } from '@/lib/supabase'

export type EntidadeAnexo = 'despesa' | 'receita' | 'ordem_compra'
export type TipoDocumento = 'nota_fiscal' | 'boleto' | 'comprovante' | 'outro'

export interface Anexo {
  id: string; tipo_documento: TipoDocumento; nome_arquivo: string
  mime: string | null; tamanho: number | null; criado_por: string | null; criado_em: string
}
export interface AnexoPendente { arquivo: File; tipo: TipoDocumento }

export const TIPOS_DOCUMENTO: { id: TipoDocumento; nome: string }[] = [
  { id: 'nota_fiscal', nome: 'Nota Fiscal' },
  { id: 'boleto',      nome: 'Boleto' },
  { id: 'comprovante', nome: 'Comprovante' },
  { id: 'outro',       nome: 'Outro' },
]
const NOME_TIPO = Object.fromEntries(TIPOS_DOCUMENTO.map(t => [t.id, t.nome])) as Record<TipoDocumento, string>
const TAMANHO_MAX = 10 * 1024 * 1024
const ACEITOS = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'

/** iPhone às vezes manda HEIC sem tipo. */
function mimeDe(f: File): string {
  if (f.type) return f.type
  const ext = f.name.toLowerCase().split('.').pop()
  return ext === 'heic' ? 'image/heic' : ext === 'heif' ? 'image/heif' : ext === 'pdf' ? 'application/pdf' : ''
}

function validarArquivo(f: File): string | null {
  const mime = mimeDe(f)
  if (!(mime === 'application/pdf' || mime.startsWith('image/'))) return `"${f.name}": envie PDF ou imagem.`
  if (f.size > TAMANHO_MAX) return `"${f.name}" passa de 10 MB.`
  if (f.size === 0) return `"${f.name}" está vazio.`
  return null
}

function fmtTamanho(n: number | null): string {
  if (!n) return ''
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Envia um arquivo: URL assinada → Storage → registro. */
export async function enviarAnexo(
  token: string, entidade: EntidadeAnexo, entidadeId: string, arquivo: File, tipo: TipoDocumento,
): Promise<Anexo> {
  const meta = { entidade, entidade_id: entidadeId, nome_arquivo: arquivo.name, mime: mimeDe(arquivo), tamanho: arquivo.size }
  const up = await api.post<{ bucket: string; path: string; token: string }>('/anexos/upload-url', token, meta)
  const { error } = await createClient().storage.from(up.bucket)
    .uploadToSignedUrl(up.path, up.token, arquivo, { contentType: meta.mime })
  if (error) throw new Error(`Falha ao enviar "${arquivo.name}": ${error.message}`)
  return api.post<Anexo>('/anexos', token, { ...meta, path: up.path, tipo_documento: tipo })
}

/** Envia os pendentes de um lançamento recém-criado. Devolve as mensagens de erro (vazio = tudo certo). */
export async function enviarAnexos(
  token: string, entidade: EntidadeAnexo, entidadeId: string, pendentes: AnexoPendente[],
): Promise<string[]> {
  const erros: string[] = []
  for (const p of pendentes) {
    try { await enviarAnexo(token, entidade, entidadeId, p.arquivo, p.tipo) }
    catch (e) { erros.push(e instanceof Error ? e.message : `Falha ao enviar "${p.arquivo.name}".`) }
  }
  return erros
}

/** Abre o anexo numa aba nova (URL assinada de 5 min). */
export async function abrirAnexo(token: string, anexoId: string): Promise<void> {
  // Abre a aba antes do await: depois dele o navegador trata como pop-up.
  const aba = typeof window !== 'undefined' ? window.open('', '_blank') : null
  try {
    const { url } = await api.get<{ url: string }>(`/anexos/${anexoId}/url`, token)
    if (aba) aba.location.href = url
    else window.location.href = url
  } catch (e) {
    aba?.close()
    throw e
  }
}

interface Props {
  token: string
  entidade: EntidadeAnexo
  /** Lançamento já salvo: envia na hora. Sem id: usa pendentes/onPendentes. */
  entidadeId?: string
  pendentes?: AnexoPendente[]
  onPendentes?: (p: AnexoPendente[]) => void
  /** Tipo sugerido ao anexar (ex.: Ordem de Compra → Nota Fiscal). */
  tipoPadrao?: TipoDocumento
  somenteLeitura?: boolean
  rotulo?: string
}

export function CampoAnexos({
  token, entidade, entidadeId, pendentes = [], onPendentes, tipoPadrao = 'nota_fiscal',
  somenteLeitura = false, rotulo = 'Anexos (Nota Fiscal, Boleto)',
}: Props) {
  const [anexos, setAnexos] = useState<Anexo[]>([])
  const [tipo, setTipo] = useState<TipoDocumento>(tipoPadrao)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    if (!entidadeId) return
    try {
      setAnexos(await api.get<Anexo[]>(`/anexos?entidade=${entidade}&entidade_id=${entidadeId}`, token))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os anexos.')
    }
  }, [token, entidade, entidadeId])

  useEffect(() => { carregar() }, [carregar])

  async function escolher(lista: FileList | null) {
    const arquivos = Array.from(lista ?? [])
    if (inputRef.current) inputRef.current.value = ''
    if (!arquivos.length) return
    const invalidos = arquivos.map(validarArquivo).filter(Boolean) as string[]
    const validos = arquivos.filter(f => !validarArquivo(f))
    setErro(invalidos.length ? invalidos.join(' ') : null)
    if (!validos.length) return
    if (!entidadeId) {
      onPendentes?.([...pendentes, ...validos.map(arquivo => ({ arquivo, tipo }))])
      return
    }
    setOcupado(true)
    const falhas = await enviarAnexos(token, entidade, entidadeId, validos.map(arquivo => ({ arquivo, tipo })))
    if (falhas.length) setErro([...invalidos, ...falhas].join(' '))
    await carregar()
    setOcupado(false)
  }

  async function remover(a: Anexo) {
    setOcupado(true); setErro(null)
    try {
      await api.delete(`/anexos/${a.id}`, token)
      setAnexos(lista => lista.filter(x => x.id !== a.id))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível remover o anexo.')
    } finally {
      setOcupado(false)
    }
  }

  async function abrir(a: Anexo) {
    setErro(null)
    try { await abrirAnexo(token, a.id) }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível abrir o anexo.') }
  }

  const vazio = anexos.length === 0 && pendentes.length === 0

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-600">{rotulo}</span>
        {!somenteLeitura && (
          <div className="ml-auto flex items-center gap-2">
            <select value={tipo} onChange={e => setTipo(e.target.value as TipoDocumento)} aria-label="Tipo do documento"
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus-ring focus:outline-none">
              {TIPOS_DOCUMENTO.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <button type="button" disabled={ocupado} onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-gray-100 disabled:opacity-50">
              <span aria-hidden>📎</span> {ocupado ? 'Enviando…' : 'Anexar arquivo'}
            </button>
            <input ref={inputRef} type="file" multiple accept={ACEITOS} className="hidden"
              onChange={e => escolher(e.target.files)} />
          </div>
        )}
      </div>

      {!vazio && (
        <ul className="mt-2 space-y-1">
          {anexos.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-xs">
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{NOME_TIPO[a.tipo_documento] ?? 'Anexo'}</span>
              <button type="button" onClick={() => abrir(a)} className="min-w-0 flex-1 truncate text-left text-blue-600 hover:underline" title={a.nome_arquivo}>
                {a.nome_arquivo}
              </button>
              <span className="shrink-0 text-gray-400">{fmtTamanho(a.tamanho)}</span>
              {!somenteLeitura && (
                <button type="button" disabled={ocupado} onClick={() => remover(a)}
                  className="shrink-0 text-red-500 hover:text-red-700 disabled:opacity-50" aria-label={`Remover ${a.nome_arquivo}`}>
                  Remover
                </button>
              )}
            </li>
          ))}
          {pendentes.map((p, i) => (
            <li key={`p-${i}`} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1 text-xs">
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-600">{NOME_TIPO[p.tipo]}</span>
              <span className="min-w-0 flex-1 truncate text-gray-700" title={p.arquivo.name}>{p.arquivo.name}</span>
              <span className="shrink-0 text-gray-400">{fmtTamanho(p.arquivo.size)} · enviado ao salvar</span>
              <button type="button" onClick={() => onPendentes?.(pendentes.filter((_, j) => j !== i))}
                className="shrink-0 text-red-500 hover:text-red-700" aria-label={`Remover ${p.arquivo.name}`}>
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {vazio && somenteLeitura && <p className="mt-1 text-xs text-gray-400">Nenhum anexo.</p>}
      {erro && <p role="alert" className="mt-1.5 text-xs text-red-600">{erro}</p>}
    </div>
  )
}

/** Quantos anexos cada lançamento da lista tem (para o clipe). Falha = sem clipe. */
export function useContagemAnexos(token: string | null | undefined, entidade: EntidadeAnexo, ids: string[] | undefined) {
  const [contagem, setContagem] = useState<Record<string, number>>({})
  const chave = (ids ?? []).join(',')
  useEffect(() => {
    if (!token || !chave) { setContagem({}); return }
    let vivo = true
    api.post<Record<string, number>>('/anexos/contagem', token, { entidade, ids: chave.split(',') })
      .then(c => { if (vivo) setContagem(c ?? {}) })
      .catch(() => { if (vivo) setContagem({}) })
    return () => { vivo = false }
  }, [token, entidade, chave])
  return contagem
}

/** Clipe com a quantidade de anexos, ao lado da descrição. */
export function MarcaAnexos({ n }: { n?: number }) {
  if (!n) return null
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center text-[13px] font-normal text-slate-500"
      title={`${n} anexo${n > 1 ? 's' : ''}`} aria-label={`${n} anexo${n > 1 ? 's' : ''}`}>
      📎{n > 1 ? n : ''}
    </span>
  )
}
