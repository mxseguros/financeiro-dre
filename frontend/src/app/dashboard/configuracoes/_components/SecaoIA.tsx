import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { inputCls } from './shared'

interface SituacaoIA {
  configurada: boolean
  origem: 'configuracoes' | 'ambiente' | null
  mascara: string | null
  atualizada_em: string | null
  legivel: boolean
}

/**
 * Chave da API da Anthropic usada pelo Assistente de IA, Copiloto e sugestões
 * do extrato (0051). Só o Admin vê esta seção. A chave é gravada cifrada no
 * servidor e nunca volta para a tela: aparece só mascarada (sk-ant-…QAA).
 */
export function SecaoIA({ token }: { token: string }) {
  const [sit, setSit] = useState<SituacaoIA | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [editando, setEditando] = useState(false)
  const [chave, setChave] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmRemover, setConfirmRemover] = useState(false)
  const [removendo, setRemovendo] = useState(false)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<SituacaoIA>('/configuracoes/ia', token)
      .then(setSit).catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar.'))
      .finally(() => setCarregando(false))
  }, [token])
  useEffect(() => { carregar() }, [carregar])

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    const v = chave.trim()
    if (!v.startsWith('sk-ant-')) { setErro('A chave da Anthropic começa com "sk-ant-".'); return }
    setSalvando(true); setErro(null)
    try {
      setSit(await api.put<SituacaoIA>('/configuracoes/ia', token, { chave: v }))
      setChave(''); setEditando(false)
      toast.sucesso('Chave salva e testada. O Assistente de IA já usa a nova chave.')
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao salvar a chave.') }
    finally { setSalvando(false) }
  }

  async function testar() {
    setTestando(true)
    try {
      const r = await api.post<{ ok: boolean; mensagem: string }>('/configuracoes/ia/testar', token, {})
      if (r.ok) toast.sucesso(r.mensagem); else toast.erro(r.mensagem)
    } catch (err) { toast.erro(err instanceof Error ? err.message : 'Erro ao testar.') }
    finally { setTestando(false) }
  }

  async function remover() {
    setRemovendo(true)
    try {
      setSit(await api.delete<SituacaoIA>('/configuracoes/ia', token))
      setConfirmRemover(false); toast.sucesso('Chave removida.')
    } catch (err) { toast.erro(err instanceof Error ? err.message : 'Erro ao remover.') }
    finally { setRemovendo(false) }
  }

  if (carregando) return <p className="py-10 text-center text-sm text-slate-600">Carregando…</p>

  const daTela = sit?.origem === 'configuracoes'
  return (
    <div className="max-w-2xl space-y-4">
      <ConfirmDialog open={confirmRemover} titulo="Remover a chave da IA?"
        mensagem={<>O Assistente de IA, o Copiloto e as sugestões do extrato param de funcionar até uma nova chave ser cadastrada.</>}
        loading={removendo} onCancelar={() => setConfirmRemover(false)} onConfirmar={remover} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="text-[15px] font-semibold text-slate-900">Chave da API (Anthropic)</h3>
        <p className="mt-1 text-[13px] text-slate-600">
          Usada pelo Assistente de IA, pelo Copiloto dos lançamentos e pelas sugestões do extrato. Fica guardada
          criptografada no servidor e nunca é exibida por inteiro: nem o Admin consegue ver a chave depois de salva.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {sit?.configurada ? (
            <>
              <span className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm text-slate-800" aria-label="Chave mascarada">
                {sit.mascara}
              </span>
              <span className="text-[13px] text-slate-600">
                {daTela
                  ? `Cadastrada aqui${sit.atualizada_em ? ` em ${new Date(sit.atualizada_em).toLocaleString('pt-BR')}` : ''}`
                  : 'Vem da configuração do servidor (ANTHROPIC_API_KEY)'}
              </span>
            </>
          ) : (
            <span className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">Nenhuma chave cadastrada: a IA está desligada.</span>
          )}
        </div>

        {sit && !sit.legivel && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">
            A chave salva não pode mais ser lida (o segredo do servidor mudou). Cadastre a chave de novo.
          </p>
        )}

        {editando ? (
          <form onSubmit={salvar} noValidate className="mt-4 space-y-2">
            <label htmlFor="ia-chave" className="block text-sm font-semibold text-slate-700">
              {sit?.configurada ? 'Nova chave' : 'Chave'}
            </label>
            <input id="ia-chave" type="password" autoComplete="off" spellCheck={false} value={chave}
              onChange={e => setChave(e.target.value)} placeholder="sk-ant-…" className={`${inputCls} font-mono`} autoFocus />
            <p className="text-[13px] text-slate-600">Ao salvar, o sistema testa a chave com a Anthropic antes de guardar.</p>
            {erro && <p role="alert" className="text-[13px] text-red-800">{erro}</p>}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => { setEditando(false); setChave(''); setErro(null) }} disabled={salvando}>Cancelar</Button>
              <Button type="submit" loading={salvando}>Salvar chave</Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {daTela && (
              <Button variant="ghost" tone="danger" onClick={() => setConfirmRemover(true)}>Remover</Button>
            )}
            <span className="flex-1" />
            {sit?.configurada && <Button variant="secondary" onClick={testar} loading={testando}>Testar conexão</Button>}
            <Button onClick={() => { setEditando(true); setErro(null) }}>{sit?.configurada ? 'Trocar chave' : 'Cadastrar chave'}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
