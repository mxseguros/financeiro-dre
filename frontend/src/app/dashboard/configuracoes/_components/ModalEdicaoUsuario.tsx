import { useState } from 'react'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import type { Role, Permissions } from '@/types'
import { getDefaultPermissions } from '@/types'
import { inputCls, selectCls } from './shared'
import { PermissoesSelector } from './PermissoesSelector'

export interface UsuarioItem { id: string; nome: string; email: string; role: Role; ativo: boolean; permissions?: Permissions | null }

export function ModalEdicaoUsuario({
  usuario,
  token,
  onSalvo,
  onFechar,
}: {
  usuario: UsuarioItem
  token: string
  onSalvo: () => void
  onFechar: () => void
}) {
  const [form, setForm] = useState({
    nome:        usuario.nome,
    role:        usuario.role,
    permissions: (usuario.permissions as Permissions) ?? getDefaultPermissions(usuario.role),
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true); setErro(null)
    try {
      await api.patch(`/usuarios/${usuario.id}`, token, {
        nome:        form.nome,
        role:        form.role,
        permissions: form.permissions,
      })
      onSalvo()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao salvar') }
    finally { setSalvando(false) }
  }

  function handleRoleChange(newRole: Role) {
    setForm(f => ({ ...f, role: newRole, permissions: getDefaultPermissions(newRole) }))
  }

  return (
    // Botões de ação ficam DENTRO do <form>, não no `footer` do Modal: assim a
    // validação nativa (`required`) continua disparando no submit.
    <Modal open onClose={onFechar} title="Editar Usuário" dismissable={!salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">E-mail</label>
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">{usuario.email}</p>
        </div>
        <div>
          <label htmlFor="edit-usuario-nome" className="mb-1 block text-xs font-medium text-gray-600">Nome</label>
          <input id="edit-usuario-nome" required value={form.nome}
            onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label htmlFor="edit-usuario-role" className="mb-1 block text-xs font-medium text-gray-600">Perfil</label>
          <select id="edit-usuario-role" value={form.role}
            onChange={e => handleRoleChange(e.target.value as Role)} className={selectCls}>
            <option value="comercial">Comercial</option>
            <option value="contador">Contador</option>
            <option value="gestor">Gestor</option>
            <option value="admin">Admin</option>
            <option value="colaborador">Colaborador (só Ordem de Compra)</option>
          </select>
        </div>
        {form.role === 'colaborador' ? (
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            Colaborador só acessa o link de Ordem de Compra (<strong>/oc</strong>): lança as próprias despesas, com foto da nota, e acompanha a aprovação.
          </p>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Permissões de Acesso</label>
            <PermissoesSelector permissions={form.permissions} onChange={p => setForm(f => ({ ...f, permissions: p }))} />
          </div>
        )}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
