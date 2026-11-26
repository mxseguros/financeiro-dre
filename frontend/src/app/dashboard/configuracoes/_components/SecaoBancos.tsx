import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { inputCls } from './shared'

interface BancoItem { id: string; nome: string; ativo: boolean }

const corBanco = (nome: string) => {
  const n = nome.toLowerCase()
  return n.includes('ita') ? 'bg-itau' : n.includes('santander') ? 'bg-santander' : 'bg-slate-400'
}

/**
 * Bancos (redesenho UX, fase 7): lista com o ponto da cor do banco, "+ Novo
 * banco" e edição em painel lateral (tela cheia no celular), com Excluir no
 * rodapé. O servidor recusa excluir banco que já tem lançamentos.
 */
export function SecaoBancos({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [items, setItems] = useState<BancoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [painel, setPainel] = useState<{ modo: 'novo' } | { modo: 'editar'; b: BancoItem } | null>(null)
  const [nome, setNome] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmExcluir, setConfirmExcluir] = useState<BancoItem | null>(null)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<BancoItem[]>('/configuracoes/bancos', token)
      .then(setItems).catch(() => {}).finally(() => setLoading(false))
  }, [token])
  useEffect(() => { carregar() }, [carregar])

  function abrir(p: { modo: 'novo' } | { modo: 'editar'; b: BancoItem }) {
    setErro(null); setNome(p.modo === 'editar' ? p.b.nome : ''); setPainel(p)
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!painel) return
    if (!nome.trim()) { setErro('Informe o nome do banco.'); return }
    setSalvando(true); setErro(null)
    try {
      if (painel.modo === 'novo') await api.post('/configuracoes/bancos', token, { nome: nome.trim() })
      else await api.put(`/configuracoes/bancos/${painel.b.id}`, token, { nome: nome.trim() })
      toast.sucesso(painel.modo === 'novo' ? 'Banco criado.' : 'Banco atualizado.')
      setPainel(null); carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao salvar o banco.') }
    finally { setSalvando(false) }
  }

  async function excluir(b: BancoItem) {
    setExcluindo(true); setErroExclusao(null)
    try {
      await api.delete(`/configuracoes/bancos/${b.id}`, token)
      setConfirmExcluir(null); setPainel(null); carregar()
      toast.sucesso(`Banco "${b.nome}" excluído.`)
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : 'Erro ao excluir banco.')
    } finally { setExcluindo(false) }
  }

  return (
    <div className="space-y-3">
      <ConfirmDialog
        open={!!confirmExcluir}
        titulo="Excluir banco?"
        mensagem={<><strong>{confirmExcluir?.nome}</strong> será excluído permanentemente. Banco com lançamentos não pode ser excluído.</>}
        erro={erroExclusao}
        loading={excluindo}
        onCancelar={() => { setConfirmExcluir(null); setErroExclusao(null) }}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      <Modal open={!!painel} onClose={() => setPainel(null)} variant="painel" dismissable={!salvando}
        title={painel?.modo === 'novo' ? 'Novo banco' : 'Editar banco'}
        footer={
          <div className="flex items-center gap-2">
            {painel?.modo === 'editar' && podeExcluir && (
              <Button variant="ghost" tone="danger" disabled={salvando}
                onClick={() => painel.modo === 'editar' && setConfirmExcluir(painel.b)}>Excluir</Button>
            )}
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setPainel(null)} disabled={salvando}>Cancelar</Button>
            <Button type="submit" form="form-banco" loading={salvando}>Salvar</Button>
          </div>
        }>
        <form id="form-banco" onSubmit={salvar} noValidate className="space-y-2">
          <label htmlFor="banco-nome" className="block text-sm font-semibold text-slate-700">Nome do banco</label>
          <input id="banco-nome" value={nome} onChange={e => setNome(e.target.value)} className={inputCls} autoFocus />
          {erro && <p role="alert" className="text-[13px] text-red-800">{erro}</p>}
        </form>
      </Modal>

      {podeCriar && (
        <div className="flex justify-end">
          <button type="button" onClick={() => abrir({ modo: 'novo' })}
            className="focus-ring inline-flex h-12 items-center rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-light md:h-11">
            + Novo banco
          </button>
        </div>
      )}

      <ul className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {loading && <li className="py-10 text-center text-sm text-slate-600">Carregando…</li>}
        {!loading && items.map(b => (
          <li key={b.id} className="border-t border-slate-100 first:border-t-0">
            <button type="button" disabled={!podeEditar && !podeExcluir} onClick={() => abrir({ modo: 'editar', b })}
              className={cn('focus-ring flex min-h-[56px] w-full items-center gap-3 px-4 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent', b.ativo === false && 'opacity-60')}>
              <span className={cn('h-3 w-3 rounded-full', corBanco(b.nome))} aria-hidden="true" />
              <span className="flex-1 text-[15px] font-medium text-slate-900 md:text-sm">{b.nome}</span>
              {b.ativo === false && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-600">inativo</span>}
              {(podeEditar || podeExcluir) && <span aria-hidden="true" className="text-slate-400">›</span>}
            </button>
          </li>
        ))}
        {!loading && items.length === 0 && <li className="py-8 text-center text-sm text-slate-600">Nenhum banco cadastrado.</li>}
      </ul>
    </div>
  )
}
