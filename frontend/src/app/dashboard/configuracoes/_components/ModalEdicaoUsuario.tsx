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
  onExcluir,
}: {
  usuario: UsuarioItem
  token: string
  onSalvo: () => void
  onFechar: () => void
  /** Mostra "Excluir" no rodapé do painel (redesenho UX, fase 7). */
  onExcluir?: () => void
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
    <Modal open onClose={onFechar} title={usuario.nome} subtitle="Perfil e permissões" variant="painel" dismissable={!salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-slate-700">E-mail</label>
          <p className="flex h-11 items-center rounded-lg border border-gray-200 bg-slate-50 px-3 text-sm text-slate-600">{usuario.email}</p>
        </div>
        <div>
          <label htmlFor="edit-usuario-nome" className="mb-1.5 block text-sm font-semibold text-slate-700">Nome</label>
          <input id="edit-usuario-nome" required value={form.nome}
            onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label htmlFor="edit-usuario-role" className="mb-1.5 block text-sm font-semibold text-slate-700">Perfil</label>
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
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[13px] text-indigo-700">
            Colaborador só acessa o link de Ordem de Compra (<strong>/oc</strong>): lança as próprias despesas, com foto da nota, e acompanha a aprovação.
          </p>
        ) : (
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Permissões de Acesso</label>
            <PermissoesSelector permissions={form.permissions} role={form.role} onChange={p => setForm(f => ({ ...f, permissions: p }))} />
          </div>
        )}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-[13px] text-red-600">{erro}</p>}
        <div className="sticky bottom-0 -mx-5 flex items-center gap-2 border-t border-gray-100 bg-white px-5 pt-3">
          {onExcluir && <Button type="button" variant="ghost" tone="danger" onClick={onExcluir} disabled={salvando}>Excluir</Button>}
          <span className="flex-1" />
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  )
}
