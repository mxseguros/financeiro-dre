import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import type { Role, Permissions } from '@/types'
import { getDefaultPermissions } from '@/types'
import { inputCls, selectCls, Chip, BtnExcluir } from './shared'
import { PermissoesSelector } from './PermissoesSelector'
import { ModalEdicaoUsuario, type UsuarioItem } from './ModalEdicaoUsuario'

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', gestor: 'Gestor', contador: 'Contador', comercial: 'Comercial', colaborador: 'Colaborador' }
const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-red-50 text-red-700', gestor: 'bg-amber-50 text-amber-700',
  contador: 'bg-blue-50 text-blue-700', comercial: 'bg-gray-100 text-gray-600',
  colaborador: 'bg-indigo-50 text-indigo-700',
}

export function SecaoUsuarios({
  token, role, podeExcluir, currentUserId, onSelfDeleted,
}: {
  token: string; role: Role; podeExcluir: boolean
  currentUserId: string | null
  onSelfDeleted: () => void
}) {
  const isAdminOuGestor = role === 'admin' || role === 'gestor'

  const [items, setItems] = useState<UsuarioItem[]>([])
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [editandoUsuario, setEditandoUsuario] = useState<UsuarioItem | null>(null)
  const [confirmExcluir, setConfirmExcluir] = useState<UsuarioItem | null>(null)
  const toast = useToast()
  const [form, setForm] = useState({
    nome: '', email: '', senha: '', role: 'comercial' as Role,
    permissions: getDefaultPermissions('comercial'),
  })
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(() => {
    api.get<{ total: number; items: UsuarioItem[] }>('/usuarios', token)
      .then(r => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      await api.post('/usuarios', token, {
        nome: form.nome, email: form.email, senha: form.senha,
        role: form.role, permissions: form.permissions,
      })
      setForm({ nome: '', email: '', senha: '', role: 'comercial', permissions: getDefaultPermissions('comercial') })
      carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao criar') }
    finally { setCriando(false) }
  }

  async function excluir(u: UsuarioItem) {
    setExcluindo(true)
    try {
      await api.delete(`/usuarios/${u.id}`, token)
      setConfirmExcluir(null)
      if (u.id === currentUserId) {
        // Sai antes do toast — a sessão do próprio usuário deixou de existir.
        onSelfDeleted()
      } else {
        carregar()
        toast.sucesso(`Usuário "${u.nome}" excluído.`)
      }
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao excluir usuário.')
    } finally {
      setExcluindo(false)
    }
  }

  function handleRoleChange(newRole: Role) {
    setForm(f => ({ ...f, role: newRole, permissions: getDefaultPermissions(newRole) }))
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const isSelf = (u: UsuarioItem) => u.id === currentUserId

  return (
    <>
      {editandoUsuario && (
        <ModalEdicaoUsuario
          usuario={editandoUsuario}
          token={token}
          onSalvo={() => { setEditandoUsuario(null); carregar() }}
          onFechar={() => setEditandoUsuario(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmExcluir}
        titulo={confirmExcluir && isSelf(confirmExcluir) ? 'Atenção' : 'Excluir usuário?'}
        confirmarLabel={confirmExcluir && isSelf(confirmExcluir) ? 'Excluir e sair' : 'Excluir'}
        loading={excluindo}
        mensagem={
          confirmExcluir && isSelf(confirmExcluir) ? (
            <span className="flex items-start gap-2">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                  <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
              </span>
              <span className="text-gray-600">Este é seu usuário atual, ao excluí-lo você perderá acesso ao sistema.</span>
            </span>
          ) : (
            <><strong>{confirmExcluir?.nome}</strong> será excluído permanentemente e não poderá mais acessar o sistema.</>
          )
        }
        onCancelar={() => setConfirmExcluir(null)}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      <div className="space-y-5">
        {isAdminOuGestor && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Novo Usuário</h3>
            <form onSubmit={criar} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input required value={form.nome} onChange={e => set('nome', e.target.value)}
                placeholder="Nome completo" className={inputCls} />
              <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="E-mail" className={inputCls} />
              <input required type="password" value={form.senha} onChange={e => set('senha', e.target.value)}
                placeholder="Senha" className={inputCls} />
              <select value={form.role} onChange={e => handleRoleChange(e.target.value as Role)} className={selectCls}>
                <option value="comercial">Comercial</option>
                <option value="contador">Contador</option>
                <option value="gestor">Gestor</option>
                <option value="admin">Admin</option>
                <option value="colaborador">Colaborador (só Ordem de Compra)</option>
              </select>
              {form.role === 'colaborador' ? (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                  Colaborador só acessa o link de Ordem de Compra (<strong>/oc</strong>): lança as próprias despesas, com foto da nota, e acompanha a aprovação.
                </p>
              ) : (
                <PermissoesSelector
                  permissions={form.permissions}
                  onChange={p => setForm(f => ({ ...f, permissions: p }))}
                />
              )}
              <div className="col-span-1 flex items-center gap-3 sm:col-span-2 lg:col-span-4">
                {erro && <p className="text-xs text-red-600">{erro}</p>}
                <button type="submit" disabled={criando}
                  className="ml-auto rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50">
                  {criando ? 'Criando…' : '+ Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Carregando…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">E-mail</th>
                  <th className="px-4 py-3">Perfil</th>
                  {isAdminOuGestor && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {items.map(u => (
                  <tr key={u.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{u.nome}</td>
                    <td className="px-4 py-2.5 text-gray-500">{u.email}</td>
                    <td className="px-4 py-2.5"><Chip label={ROLE_LABEL[u.role]} cor={ROLE_COLOR[u.role]} /></td>
                    {isAdminOuGestor && (
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex gap-3">
                          <button onClick={() => setEditandoUsuario(u)}
                            className="text-xs text-blue-500 hover:underline">Editar</button>
                          {podeExcluir && (
                            <BtnExcluir onClick={() => setConfirmExcluir(u)} />
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-sm text-gray-400">Nenhum usuário</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
