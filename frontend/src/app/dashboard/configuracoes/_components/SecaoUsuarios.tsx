import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import type { Role, Permissions } from '@/types'
import { getDefaultPermissions } from '@/types'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { FILTRO_CAMPO } from '@/components/ui/filtros'
import { inputCls, selectCls } from './shared'
import { PermissoesSelector } from './PermissoesSelector'
import { ModalEdicaoUsuario, type UsuarioItem } from './ModalEdicaoUsuario'

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', gestor: 'Gestor', contador: 'Contador', comercial: 'Comercial', colaborador: 'Colaborador' }
// Vermelho é só para negativos e ações destrutivas: perfil usa tons neutros.
const ROLE_COLOR: Record<string, string> = {
  admin: 'bg-navy text-white', gestor: 'bg-sel-bg text-sel-text',
  contador: 'bg-slate-100 text-slate-700', comercial: 'bg-slate-100 text-slate-700',
  colaborador: 'bg-indigo-100 text-indigo-800',
}
const iniciais = (nome: string, email: string) => {
  const p = (nome || email).trim().split(/[\s._@-]+/).filter(Boolean)
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
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
  const [novoAberto, setNovoAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)

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
      setNovoAberto(false)
      toast.sucesso('Usuário criado. Informe a senha a ele.')
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
          onExcluir={podeExcluir ? () => { const u = editandoUsuario; setEditandoUsuario(null); setConfirmExcluir(u) } : undefined}
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

      {/* Painel: novo usuário (a senha é criada pelo Admin e informada à pessoa) */}
      <Modal open={novoAberto} onClose={() => setNovoAberto(false)} title="Novo usuário" variant="painel" dismissable={!criando}>
        <form onSubmit={criar} className="space-y-4">
          <div>
            <label htmlFor="novo-nome" className="mb-1.5 block text-sm font-semibold text-slate-700">Nome completo</label>
            <input id="novo-nome" required value={form.nome} onChange={e => set('nome', e.target.value)} className={inputCls} autoFocus />
          </div>
          <div>
            <label htmlFor="novo-email" className="mb-1.5 block text-sm font-semibold text-slate-700">E-mail</label>
            <input id="novo-email" required type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="novo-senha" className="mb-1.5 block text-sm font-semibold text-slate-700">Senha</label>
            <input id="novo-senha" required type="password" autoComplete="new-password" value={form.senha} onChange={e => set('senha', e.target.value)} className={inputCls} />
            <p className="mt-1 text-[13px] text-slate-600">Você informa essa senha à pessoa. Não há troca de senha por e-mail.</p>
          </div>
          <div>
            <label htmlFor="novo-perfil" className="mb-1.5 block text-sm font-semibold text-slate-700">Perfil</label>
            <select id="novo-perfil" value={form.role} onChange={e => handleRoleChange(e.target.value as Role)} className={selectCls}>
              <option value="comercial">Comercial</option>
              <option value="contador">Contador</option>
              <option value="gestor">Gestor</option>
              <option value="admin">Admin</option>
              <option value="colaborador">Colaborador (só Ordem de Compra)</option>
            </select>
          </div>
          {form.role === 'colaborador' ? (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[13px] text-indigo-800">
              Colaborador só acessa o link de Ordem de Compra (<strong>/oc</strong>): lança as próprias despesas, com foto da nota, e acompanha a aprovação.
            </p>
          ) : (
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Permissões de acesso</p>
              <PermissoesSelector permissions={form.permissions} role={form.role} onChange={p => setForm(f => ({ ...f, permissions: p }))} />
            </div>
          )}
          {erro && <p role="alert" className="text-[13px] text-red-800">{erro}</p>}
          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-gray-100 bg-white px-5 pt-3">
            <Button type="button" variant="secondary" onClick={() => setNovoAberto(false)} disabled={criando}>Cancelar</Button>
            <Button type="submit" loading={criando}>{criando ? 'Criando…' : 'Criar usuário'}</Button>
          </div>
        </form>
      </Modal>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block flex-1 md:max-w-xs">
            <span className="sr-only">Buscar usuário</span>
            <input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou e-mail" className={cn(FILTRO_CAMPO, 'w-full')} />
          </label>
          <label className="inline-flex min-h-12 items-center gap-2 text-sm text-slate-700 md:min-h-11">
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} className="h-5 w-5 accent-navy" />
            Mostrar inativos
          </label>
          <span className="flex-1" />
          {isAdminOuGestor && (
            <button type="button" onClick={() => { setErro(null); setNovoAberto(true) }}
              className="focus-ring inline-flex h-12 items-center rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-light md:h-11">
              + Novo usuário
            </button>
          )}
        </div>

        {(() => {
          const t = busca.trim().toLowerCase()
          const lista = items.filter(u => (mostrarInativos || u.ativo !== false) && (!t || `${u.nome} ${u.email}`.toLowerCase().includes(t)))
          if (loading) return <div className="rounded-2xl border border-gray-200 bg-white py-10 text-center text-sm text-slate-600">Carregando…</div>
          const situacao = (u: UsuarioItem) => (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
              <span className={cn('h-2 w-2 rounded-full', u.ativo === false ? 'bg-slate-400' : 'bg-green-600')} aria-hidden="true" />
              {u.ativo === false ? 'Inativo' : 'Ativo'}
            </span>
          )
          const avatar = (u: UsuarioItem) => (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[13px] font-semibold text-slate-700">{iniciais(u.nome, u.email)}</span>
          )
          return (
            <>
              <div className="hidden overflow-x-auto rounded-2xl border border-gray-200 bg-white md:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-[13px] font-semibold text-slate-600">
                      <th scope="col" className="px-4 py-2.5">Pessoa</th>
                      <th scope="col" className="px-4 py-2.5">Perfil</th>
                      <th scope="col" className="px-4 py-2.5">Situação</th>
                      {isAdminOuGestor && <th scope="col" className="px-4 py-2.5 text-right"><span className="sr-only">Ações</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map(u => (
                      <tr key={u.id} className={cn('border-t border-slate-100', u.ativo === false && 'opacity-70')}>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-3">
                            {avatar(u)}
                            <span className="min-w-0">
                              <span className="block font-semibold text-slate-900">{u.nome}{isSelf(u) && <span className="font-normal text-slate-500"> (você)</span>}</span>
                              <span className="block truncate text-[13px] text-slate-600">{u.email}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5"><span className={cn('rounded-full px-2.5 py-0.5 text-[13px] font-semibold', ROLE_COLOR[u.role])}>{ROLE_LABEL[u.role]}</span></td>
                        <td className="px-4 py-2.5">{situacao(u)}</td>
                        {isAdminOuGestor && (
                          <td className="px-4 py-2.5 text-right">
                            <button type="button" onClick={() => setEditandoUsuario(u)}
                              className="focus-ring h-11 rounded-lg border border-gray-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-gray-50">
                              Permissões
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {lista.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-600">Nenhum usuário encontrado.</td></tr>}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-2 md:hidden">
                {lista.map(u => (
                  <li key={u.id}>
                    <button type="button" disabled={!isAdminOuGestor} onClick={() => setEditandoUsuario(u)}
                      className={cn('focus-ring flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white p-3.5 text-left', u.ativo === false && 'opacity-70')}>
                      {avatar(u)}
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-slate-900">{u.nome}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-full px-2 py-0.5 text-[13px] font-semibold', ROLE_COLOR[u.role])}>{ROLE_LABEL[u.role]}</span>
                          {situacao(u)}
                        </span>
                      </span>
                      {isAdminOuGestor && <span aria-hidden="true" className="text-slate-400">›</span>}
                    </button>
                  </li>
                ))}
                {lista.length === 0 && <li className="py-8 text-center text-sm text-slate-600">Nenhum usuário encontrado.</li>}
              </ul>
            </>
          )
        })()}
      </div>
    </>
  )
}
