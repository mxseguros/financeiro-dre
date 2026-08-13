import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { inputCls, BtnExcluir } from './shared'

interface BancoItem { id: string; nome: string; ativo: boolean }

export function SecaoBancos({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [items, setItems] = useState<BancoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmExcluir, setConfirmExcluir] = useState<BancoItem | null>(null)
  const [nome, setNome] = useState('')
  const [editNome, setEditNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<BancoItem[]>('/configuracoes/bancos', token)
      .then(setItems).catch(() => {}).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      await api.post('/configuracoes/bancos', token, { nome })
      setNome(''); carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro') }
    finally { setCriando(false) }
  }

  async function salvarEdicao(id: string) {
    try {
      await api.put(`/configuracoes/bancos/${id}`, token, { nome: editNome })
      setEditId(null); carregar()
      toast.sucesso('Banco atualizado.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar banco.')
    }
  }

  async function excluir(b: BancoItem) {
    setExcluindo(true)
    try {
      await api.delete(`/configuracoes/bancos/${b.id}`, token)
      setConfirmExcluir(null); carregar()
      toast.sucesso(`Banco "${b.nome}" excluído.`)
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao excluir banco.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={!!confirmExcluir}
        titulo="Excluir banco?"
        mensagem={<><strong>{confirmExcluir?.nome}</strong> será excluído permanentemente.</>}
        loading={excluindo}
        onCancelar={() => setConfirmExcluir(null)}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      {podeCriar && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Novo Banco</h3>
          <form onSubmit={criar} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <input required value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Nome do banco" className={`${inputCls} flex-1`} />
            {erro && <p className="self-center text-xs text-red-600">{erro}</p>}
            <button type="submit" disabled={criando}
              className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50 whitespace-nowrap">
              {criando ? 'Criando…' : '+ Criar Banco'}
            </button>
          </form>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-10 text-center text-sm text-gray-400">Carregando…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                <th className="px-4 py-3">Nome</th>
                {(podeEditar || podeExcluir) && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(b => (
                <tr key={b.id} className="border-t border-gray-50 hover:bg-gray-50">
                  {editId === b.id ? (
                    <>
                      <td className="px-4 py-1.5">
                        <input value={editNome} onChange={e => setEditNome(e.target.value)}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <span className="inline-flex gap-2">
                          <button onClick={() => salvarEdicao(b.id)} className="text-xs font-medium text-green-600 hover:underline">Salvar</button>
                          <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:underline">Cancelar</button>
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{b.nome}</td>
                      {(podeEditar || podeExcluir) && (
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex gap-3">
                            {podeEditar && (
                              <button onClick={() => { setEditId(b.id); setEditNome(b.nome) }}
                                className="text-xs text-blue-500 hover:underline">Editar</button>
                            )}
                            {podeExcluir && <BtnExcluir onClick={() => setConfirmExcluir(b)} />}
                          </span>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={2} className="py-8 text-center text-sm text-gray-400">Nenhum banco cadastrado</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
