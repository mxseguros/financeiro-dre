import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { inputCls, BtnExcluir } from './shared'

interface CentroItem { id: string; nome: string; codigo: string; ativo: boolean }

export function SecaoCentros({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [items, setItems] = useState<CentroItem[]>([])
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmExcluir, setConfirmExcluir] = useState<CentroItem | null>(null)
  const [form, setForm] = useState({ nome: '', codigo: '' })
  const [editNome, setEditNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<CentroItem[]>('/configuracoes/centros-custo', token)
      .then(setItems).catch(() => {}).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      await api.post('/configuracoes/centros-custo', token, form)
      setForm({ nome: '', codigo: '' }); carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro') }
    finally { setCriando(false) }
  }

  async function salvarEdicao(id: string) {
    try {
      await api.put(`/configuracoes/centros-custo/${id}`, token, { nome: editNome })
      setEditId(null); carregar()
      toast.sucesso('Centro de custo atualizado.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar centro de custo.')
    }
  }

  async function excluir(c: CentroItem) {
    setExcluindo(true)
    try {
      await api.delete(`/configuracoes/centros-custo/${c.id}`, token)
      setConfirmExcluir(null); carregar()
      toast.sucesso(`Centro "${c.nome}" excluído.`)
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao excluir centro de custo.')
    } finally {
      setExcluindo(false)
    }
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={!!confirmExcluir}
        titulo="Excluir centro de custo?"
        mensagem={<><strong>{confirmExcluir?.nome}</strong> será excluído permanentemente.</>}
        loading={excluindo}
        onCancelar={() => setConfirmExcluir(null)}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      {podeCriar && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Novo Centro de Custo</h3>
          <form onSubmit={criar} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <input required value={form.nome} onChange={e => set('nome', e.target.value)}
              placeholder="Nome" className={`${inputCls} flex-1`} />
            <input required value={form.codigo} onChange={e => set('codigo', e.target.value)}
              placeholder="Código" className={`${inputCls} sm:w-36`} />
            {erro && <p className="self-center text-xs text-red-600">{erro}</p>}
            <button type="submit" disabled={criando}
              className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50 whitespace-nowrap">
              {criando ? 'Criando…' : '+ Criar Centro'}
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
                <th className="px-4 py-3">Código</th>
                {(podeEditar || podeExcluir) && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50">
                  {editId === c.id ? (
                    <>
                      <td className="px-4 py-1.5">
                        <input value={editNome} onChange={e => setEditNome(e.target.value)}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
                      </td>
                      <td className="px-4 py-1.5 text-gray-500">{c.codigo}</td>
                      <td className="px-4 py-1.5 text-right">
                        <span className="inline-flex gap-2">
                          <button onClick={() => salvarEdicao(c.id)} className="text-xs font-medium text-green-600 hover:underline">Salvar</button>
                          <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:underline">Cancelar</button>
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{c.nome}</td>
                      <td className="px-4 py-2.5 text-gray-500">{c.codigo}</td>
                      {(podeEditar || podeExcluir) && (
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex gap-3">
                            {podeEditar && (
                              <button onClick={() => { setEditId(c.id); setEditNome(c.nome) }}
                                className="text-xs text-blue-500 hover:underline">Editar</button>
                            )}
                            {podeExcluir && <BtnExcluir onClick={() => setConfirmExcluir(c)} />}
                          </span>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={3} className="py-8 text-center text-sm text-gray-400">Nenhum centro cadastrado</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
