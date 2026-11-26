// Importar retorno do banco (CNAB, fase 3): arrastar e soltar, resumo da baixa
// e a lista dos retornos já importados.
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, api } from '@/lib/api'
import { fmtBRL, fmtData } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button, Spinner } from '@/components/ui/Button'
import type { LinhaRetorno, ResultadoRetorno, RetornoImportado } from '@/lib/pagamentos'

async function enviar(token: string, arquivo: File): Promise<ResultadoRetorno> {
  const form = new FormData()
  form.append('arquivo', arquivo)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/pagamentos/retornos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  } catch {
    throw new Error('Não foi possível conectar ao servidor.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`)
  return body as ResultadoRetorno
}

function Grupo({ titulo, cor, itens }: { titulo: string; cor: string; itens: LinhaRetorno[] }) {
  if (!itens.length) return null
  return (
    <div>
      <p className={`mb-1 text-sm font-semibold ${cor}`}>{titulo} ({itens.length})</p>
      <ul className="space-y-1 text-xs text-gray-600">
        {itens.map(i => (
          <li key={i.despesa_id + i.motivo} className="flex justify-between gap-3 border-b border-gray-50 pb-1">
            <span>{i.descricao}{i.motivo && <span className="block text-[11px] text-gray-400">{i.motivo}</span>}</span>
            <span className="whitespace-nowrap font-medium text-gray-800">{fmtBRL(i.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Retornos({ token, podeImportar, onImportado }: { token: string; podeImportar: boolean; onImportado: () => void }) {
  const [lista, setLista] = useState<RetornoImportado[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoRetorno | null>(null)
  const [arrastando, setArrastando] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const carregar = useCallback(() => {
    api.get<RetornoImportado[]>('/pagamentos/retornos', token).then(setLista).catch(() => setLista([]))
  }, [token])
  useEffect(() => { carregar() }, [carregar])

  async function processar(arquivos: FileList | null) {
    const arq = arquivos?.[0]
    if (input.current) input.current.value = ''
    if (!arq) return
    setEnviando(true); setErro(null)
    try {
      setResultado(await enviar(token, arq))
      carregar(); onImportado()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao importar.') }
    finally { setEnviando(false) }
  }

  return (
    <div className="space-y-4">
      {podeImportar && (
        <div
          data-tour="pag-retorno"
          onDragOver={e => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={e => { e.preventDefault(); setArrastando(false); processar(e.dataTransfer.files) }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            arrastando ? 'border-navy bg-navy/5' : 'border-gray-200 bg-white'}`}>
          {enviando ? <Spinner className="text-navy" /> : (
            <>
              <p className="text-sm text-gray-600">Arraste aqui o arquivo de retorno do banco (Santander ou Itaú)</p>
              <Button type="button" variant="secondary" onClick={() => input.current?.click()}>Escolher arquivo</Button>
              <p className="text-[11px] text-gray-400">Vale o retorno de crítica (agendamento/rejeição) e o de movimento (pagamentos efetuados).</p>
            </>
          )}
          <input ref={input} type="file" className="hidden" onChange={e => processar(e.target.files)} />
        </div>
      )}
      {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {!lista ? <div className="flex h-24 items-center justify-center"><Spinner className="text-navy" /></div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                <th className="px-3 py-3">Importado em</th><th className="px-3 py-3">Arquivo</th><th className="px-3 py-3">Banco</th>
                <th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(r => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="px-3 py-2.5 text-gray-600">{fmtData(r.importado_em)}</td>
                  <td className="px-3 py-2.5 text-gray-700">{r.nome_arquivo}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.codigo_banco === '033' ? 'Santander' : 'Itaú'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.tipo === 'movimento' ? 'Movimento' : 'Crítica'}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">
                    {[['pagos', 'pago(s)'], ['agendados', 'agendado(s)'], ['bloqueados', 'a autorizar'], ['rejeitados', 'rejeitado(s)'],
                      ['devolvidos', 'devolvido(s)'], ['nao_encontrados', 'não encontrado(s)']]
                      .filter(([k]) => r.resumo?.[k]).map(([k, n]) => `${r.resumo[k]} ${n}`).join(' · ') || 'sem mudanças'}
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">Nenhum retorno importado.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {resultado && (
        <Modal open onClose={() => setResultado(null)} title="Retorno importado" variant="sheet" maxWidth="sm:max-w-2xl">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {resultado.banco === '033' ? 'Santander' : 'Itaú'} · retorno de {resultado.tipo === 'movimento' ? 'movimento' : 'crítica'}
              {resultado.nsa ? ` · arquivo nº ${resultado.nsa}` : ''}
            </p>
            {resultado.ocorrencias_arquivo && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">
                <strong>Arquivo não processado pelo banco</strong> — nenhum pagamento dele foi incluído. Corrija e gere uma nova remessa.
                <span className="block">{resultado.ocorrencias_arquivo}</span>
              </p>
            )}
            {Object.entries(resultado.ocorrencias_lote).map(([lote, m]) => (
              <p key={lote} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">Lote {lote}: {m}</p>
            ))}
            <Grupo titulo="Pagos" cor="text-green-700" itens={resultado.pagos} />
            <Grupo titulo="Agendados no banco" cor="text-indigo-700" itens={resultado.agendados} />
            <Grupo titulo="Aguardando autorização no banco" cor="text-amber-700" itens={resultado.bloqueados} />
            <Grupo titulo="Rejeitados — voltaram para A pagar" cor="text-red-700" itens={resultado.rejeitados} />
            <Grupo titulo="Devolvidos — voltaram para A pagar" cor="text-red-700" itens={resultado.devolvidos} />
            {resultado.nao_encontrados.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
                {resultado.nao_encontrados.length} registro(s) sem remessa correspondente neste sistema
                ({resultado.nao_encontrados.map(n => n.seu_numero || 'sem número').slice(0, 5).join(', ')}).
              </p>
            )}
            {resultado.contagem.sem_mudanca > 0 && (
              <p className="text-xs text-gray-400">{resultado.contagem.sem_mudanca} registro(s) sem mudança de situação.</p>
            )}
            <div className="flex justify-end"><Button type="button" onClick={() => setResultado(null)}>Fechar</Button></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
