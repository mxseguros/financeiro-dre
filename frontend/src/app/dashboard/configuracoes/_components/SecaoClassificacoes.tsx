import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { inputCls, selectCls, Chip, BtnExcluir } from './shared'
import { CLASSIFICACOES_PADRAO, type Classificacao } from '../../lancamentos/_components/shared'

// Lista do campo Classificação dos lançamentos (migrations 0039/0040).
// "Usada na DRE" (0041) desmarcada: os lançamentos com a classificação ficam
// fora da DRE, mas seguem em Lançamentos e na Visão Geral. Excluir é barrado
// pelo backend quando algum lançamento ou subitem usa a classificação.

const NATUREZA_LABEL: Record<string, string> = { ambas: 'Despesa e receita', despesa: 'Despesa', receita: 'Receita' }

export function SecaoClassificacoes({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [items, setItems] = useState<Classificacao[]>([])
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [editCodigo, setEditCodigo] = useState<string | null>(null)
  const [confirmExcluir, setConfirmExcluir] = useState<Classificacao | null>(null)
  const [form, setForm] = useState({ nome: '', natureza: 'ambas', usada_dre: true })
  const [editForm, setEditForm] = useState({ nome: '', natureza: 'ambas' })
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<Classificacao[]>('/configuracoes/classificacoes', token)
      .then(setItems).catch(() => setItems(CLASSIFICACOES_PADRAO)).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      const ordem = items.reduce((m, c) => Math.max(m, c.ordem), 0) + 1
      await api.post('/configuracoes/classificacoes', token, { ...form, ordem })
      setForm({ nome: '', natureza: 'ambas', usada_dre: true }); carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro') }
    finally { setCriando(false) }
  }

  async function salvarEdicao(c: Classificacao) {
    try {
      await api.put(`/configuracoes/classificacoes/${c.codigo}`, token, editForm)
      setEditCodigo(null); carregar()
      toast.sucesso('Classificação atualizada.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar classificação.')
    }
  }

  async function alternarAtivo(c: Classificacao) {
    try {
      await api.put(`/configuracoes/classificacoes/${c.codigo}`, token, { ativo: !c.ativo })
      carregar()
      toast.sucesso(c.ativo ? `"${c.nome}" desativada.` : `"${c.nome}" reativada.`)
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar classificação.')
    }
  }

  async function alternarDre(c: Classificacao) {
    const usada = c.usada_dre === false
    try {
      await api.put(`/configuracoes/classificacoes/${c.codigo}`, token, { usada_dre: usada })
      carregar()
      toast.sucesso(usada ? `"${c.nome}" volta a entrar na DRE.` : `Lançamentos "${c.nome}" saem da DRE.`)
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar classificação.')
    }
  }

  async function excluir(c: Classificacao) {
    setExcluindo(true)
    try {
      await api.delete(`/configuracoes/classificacoes/${c.codigo}`, token)
      setConfirmExcluir(null); carregar()
      toast.sucesso(`Classificação "${c.nome}" excluída.`)
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao excluir classificação.')
      setConfirmExcluir(null)
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={!!confirmExcluir}
        titulo="Excluir classificação?"
        mensagem={<><strong>{confirmExcluir?.nome}</strong> será excluída permanentemente. Se algum lançamento a usar, desative-a em vez de excluir.</>}
        loading={excluindo}
        onCancelar={() => setConfirmExcluir(null)}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      {podeCriar && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Nova Classificação</h3>
          <form onSubmit={criar} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Nome da classificação" className={`${inputCls} flex-1`} />
            <select value={form.natureza} onChange={e => setForm(f => ({ ...f, natureza: e.target.value }))}
              className={`${selectCls} sm:w-48`}>
              {Object.entries(NATUREZA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="flex items-center gap-2 self-center whitespace-nowrap text-sm text-gray-600">
              <input type="checkbox" checked={form.usada_dre} onChange={e => setForm(f => ({ ...f, usada_dre: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
              Usada na DRE
            </label>
            {erro && <p className="self-center text-xs text-red-600">{erro}</p>}
            <button type="submit" disabled={criando}
              className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50 whitespace-nowrap">
              {criando ? 'Criando…' : '+ Criar Classificação'}
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
                <th className="px-4 py-3">Vale para</th>
                <th className="px-4 py-3" title="Desmarcada: os lançamentos com esta classificação ficam fora da DRE (seguem em Lançamentos e na Visão Geral).">
                  Usada na DRE
                </th>
                <th className="px-4 py-3">Situação</th>
                {(podeEditar || podeExcluir) && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.codigo} className={`border-t border-gray-50 hover:bg-gray-50 ${c.ativo ? '' : 'opacity-60'}`}>
                  {editCodigo === c.codigo ? (
                    <>
                      <td className="px-4 py-1.5">
                        <input value={editForm.nome} onChange={e => setEditForm(f => ({ ...f, nome: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
                      </td>
                      <td className="px-4 py-1.5">
                        <select value={editForm.natureza} onChange={e => setEditForm(f => ({ ...f, natureza: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none">
                          {Object.entries(NATUREZA_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5" />
                      <td className="px-4 py-1.5 text-right">
                        <span className="inline-flex gap-2">
                          <button onClick={() => salvarEdicao(c)} className="text-xs font-medium text-green-600 hover:underline">Salvar</button>
                          <button onClick={() => setEditCodigo(null)} className="text-xs text-gray-400 hover:underline">Cancelar</button>
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{c.nome}</td>
                      <td className="px-4 py-2.5 text-gray-500">{NATUREZA_LABEL[c.natureza] ?? c.natureza}</td>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={c.usada_dre !== false} disabled={!podeEditar}
                          onChange={() => alternarDre(c)}
                          aria-label={`Usada na DRE: ${c.nome}`}
                          className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy disabled:opacity-50" />
                      </td>
                      <td className="px-4 py-2.5">
                        <Chip label={c.ativo ? 'Ativa' : 'Inativa'} cor={c.ativo ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'} />
                      </td>
                      {(podeEditar || podeExcluir) && (
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex gap-3">
                            {podeEditar && (
                              <button onClick={() => { setEditCodigo(c.codigo); setEditForm({ nome: c.nome, natureza: c.natureza }) }}
                                className="text-xs text-blue-500 hover:underline">Editar</button>
                            )}
                            {podeEditar && (
                              <button onClick={() => alternarAtivo(c)} className="text-xs text-gray-500 hover:underline">
                                {c.ativo ? 'Desativar' : 'Reativar'}
                              </button>
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
                <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">Nenhuma classificação cadastrada</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
