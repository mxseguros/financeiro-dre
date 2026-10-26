import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { inputCls, BtnExcluir } from './shared'

interface CategoriaItem { id: string; nome: string; natureza: string; ordem: number; ativo: boolean }
interface SubitemItem {
  id: string; nome: string; natureza: string
  categoria_id: string | null; categoria_nome: string | null
  custo_tipo: string | null; ativo: boolean
  somente_dre?: boolean
}

export function SecaoCategoriasSubitens({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [natureza, setNatureza] = useState<'despesa' | 'receita'>('despesa')
  const [categorias, setCategorias] = useState<CategoriaItem[]>([])
  const [subitens, setSubitens] = useState<SubitemItem[]>([])
  const [loading, setLoading] = useState(true)
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const toast = useToast()

  const [formCategoria, setFormCategoria] = useState({ nome: '', ordem: 0 })
  const [criandoCategoria, setCriandoCategoria] = useState(false)
  const [erroCategoria, setErroCategoria] = useState<string | null>(null)
  const [editCategoriaId, setEditCategoriaId] = useState<string | null>(null)
  const [editCategoriaForm, setEditCategoriaForm] = useState({ nome: '', ordem: 0 })
  const [confirmExcluirCategoria, setConfirmExcluirCategoria] = useState<CategoriaItem | null>(null)
  const [erroExclusaoCategoria, setErroExclusaoCategoria] = useState<string | null>(null)

  const [formSubitem, setFormSubitem] = useState({ nome: '' })
  const [criandoSubitem, setCriandoSubitem] = useState(false)
  const [erroSubitem, setErroSubitem] = useState<string | null>(null)
  const [editSubitemId, setEditSubitemId] = useState<string | null>(null)
  const [editSubitemForm, setEditSubitemForm] = useState({ nome: '', categoria_id: '' })
  const [confirmExcluirSubitem, setConfirmExcluirSubitem] = useState<SubitemItem | null>(null)
  const [erroExclusaoSubitem, setErroExclusaoSubitem] = useState<string | null>(null)

  const carregar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<CategoriaItem[]>('/configuracoes/categorias', token),
      api.get<SubitemItem[]>('/configuracoes/tipos', token),
    ]).then(([cats, subs]) => { setCategorias(cats); setSubitens(subs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  // Ao trocar de natureza, a categoria selecionada de outra natureza deixa de fazer sentido
  useEffect(() => { setCategoriaSelecionada(null) }, [natureza])

  const categoriasDaNatureza = categorias.filter(c => c.natureza === natureza).sort((a, b) => a.ordem - b.ordem)
  const subitensDaNatureza = subitens.filter(s => s.natureza === natureza)
  const subitensExibidos = categoriaSelecionada
    ? subitensDaNatureza.filter(s => s.categoria_id === categoriaSelecionada)
    : subitensDaNatureza

  async function criarCategoria(e: React.FormEvent) {
    e.preventDefault()
    setCriandoCategoria(true); setErroCategoria(null)
    try {
      await api.post('/configuracoes/categorias', token, {
        nome: formCategoria.nome, natureza, ordem: formCategoria.ordem,
      })
      setFormCategoria({ nome: '', ordem: 0 })
      carregar()
    } catch (err) { setErroCategoria(err instanceof Error ? err.message : 'Erro ao criar categoria') }
    finally { setCriandoCategoria(false) }
  }

  function iniciarEdicaoCategoria(c: CategoriaItem) {
    setEditCategoriaId(c.id)
    setEditCategoriaForm({ nome: c.nome, ordem: c.ordem })
  }

  async function salvarEdicaoCategoria(id: string) {
    try {
      await api.put(`/configuracoes/categorias/${id}`, token, {
        nome: editCategoriaForm.nome, ordem: editCategoriaForm.ordem,
      })
      setEditCategoriaId(null); carregar()
      toast.sucesso('Categoria atualizada.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar categoria.')
    }
  }

  async function excluirCategoria(c: CategoriaItem) {
    // O erro fica NO diálogo, não em toast: "categoria em uso" é a resposta
    // esperada aqui e o usuário precisa lê-la antes de decidir o que fazer.
    setErroExclusaoCategoria(null); setExcluindo(true)
    try {
      await api.delete(`/configuracoes/categorias/${c.id}`, token)
      setConfirmExcluirCategoria(null)
      if (categoriaSelecionada === c.id) setCategoriaSelecionada(null)
      carregar()
      toast.sucesso(`Categoria "${c.nome}" excluída.`)
    } catch (err) {
      setErroExclusaoCategoria(err instanceof Error ? err.message : 'Erro ao excluir categoria')
    } finally {
      setExcluindo(false)
    }
  }

  async function criarSubitem(e: React.FormEvent) {
    e.preventDefault()
    if (!categoriaSelecionada) {
      setErroSubitem('Selecione uma categoria à esquerda antes de criar o subitem.')
      return
    }
    setCriandoSubitem(true); setErroSubitem(null)
    try {
      await api.post('/configuracoes/tipos', token, {
        nome: formSubitem.nome, natureza, categoria_id: categoriaSelecionada,
      })
      setFormSubitem({ nome: '' })
      carregar()
    } catch (err) { setErroSubitem(err instanceof Error ? err.message : 'Erro ao criar subitem') }
    finally { setCriandoSubitem(false) }
  }

  function iniciarEdicaoSubitem(s: SubitemItem) {
    setEditSubitemId(s.id)
    setEditSubitemForm({ nome: s.nome, categoria_id: s.categoria_id ?? '' })
  }

  async function salvarEdicaoSubitem(id: string) {
    try {
      await api.put(`/configuracoes/tipos/${id}`, token, {
        nome: editSubitemForm.nome,
        categoria_id: editSubitemForm.categoria_id,
      })
      setEditSubitemId(null); carregar()
      toast.sucesso('Subitem atualizado.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar subitem.')
    }
  }

  // "Constar apenas na DRE" (22/10/2026): grava na hora, sem entrar em edição.
  async function alternarSomenteDre(s: SubitemItem) {
    const novo = !s.somente_dre
    setSubitens(prev => prev.map(x => x.id === s.id ? { ...x, somente_dre: novo } : x))
    try {
      await api.put(`/configuracoes/tipos/${s.id}`, token, { somente_dre: novo })
      toast.sucesso(novo ? `"${s.nome}" passa a constar apenas na DRE.` : `"${s.nome}" volta a constar em todo o sistema.`)
    } catch (err) {
      setSubitens(prev => prev.map(x => x.id === s.id ? { ...x, somente_dre: !novo } : x))
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar subitem.')
    }
  }

  async function excluirSubitem(s: SubitemItem) {
    setErroExclusaoSubitem(null); setExcluindo(true)
    try {
      await api.delete(`/configuracoes/tipos/${s.id}`, token)
      setConfirmExcluirSubitem(null)
      carregar()
      toast.sucesso(`Subitem "${s.nome}" excluído.`)
    } catch (err) {
      setErroExclusaoSubitem(err instanceof Error ? err.message : 'Erro ao excluir subitem')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={!!confirmExcluirCategoria}
        titulo="Excluir categoria?"
        mensagem={<><strong>{confirmExcluirCategoria?.nome}</strong> será excluída permanentemente.</>}
        erro={erroExclusaoCategoria}
        loading={excluindo}
        onCancelar={() => { setConfirmExcluirCategoria(null); setErroExclusaoCategoria(null) }}
        onConfirmar={() => confirmExcluirCategoria && excluirCategoria(confirmExcluirCategoria)}
      />

      <ConfirmDialog
        open={!!confirmExcluirSubitem}
        titulo="Excluir subitem?"
        mensagem={<><strong>{confirmExcluirSubitem?.nome}</strong> será excluído permanentemente.</>}
        erro={erroExclusaoSubitem}
        loading={excluindo}
        onCancelar={() => { setConfirmExcluirSubitem(null); setErroExclusaoSubitem(null) }}
        onConfirmar={() => confirmExcluirSubitem && excluirSubitem(confirmExcluirSubitem)}
      />

      {/* Tabs despesa/receita */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm w-fit">
        {(['despesa', 'receita'] as const).map(n => (
          <button key={n} onClick={() => setNatureza(n)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              natureza === n ? 'bg-navy text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}>
            {n === 'despesa' ? 'Despesas' : 'Receitas'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        {/* ── Coluna: Categorias ── */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Categorias</h3>

          {podeCriar && (
            <form onSubmit={criarCategoria} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
              <input required value={formCategoria.nome}
                onChange={e => setFormCategoria(f => ({ ...f, nome: e.target.value }))}
                placeholder="Nova categoria" className={inputCls} />
              <div className="flex items-center gap-2">
                <input type="number" value={formCategoria.ordem}
                  onChange={e => setFormCategoria(f => ({ ...f, ordem: Number(e.target.value) }))}
                  placeholder="Ordem" className={`${inputCls} w-20`} />
                <button type="submit" disabled={criandoCategoria}
                  className="ml-auto rounded-lg bg-navy px-4 py-2 text-xs font-medium text-white hover:bg-navy-light disabled:opacity-50">
                  {criandoCategoria ? 'Criando…' : '+ Categoria'}
                </button>
              </div>
              {erroCategoria && <p className="text-xs text-red-600">{erroCategoria}</p>}
            </form>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {loading ? (
              <div className="py-8 text-center text-sm text-gray-400">Carregando…</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                <li>
                  <button onClick={() => setCategoriaSelecionada(null)}
                    className={`w-full px-3 py-2.5 text-left text-sm ${categoriaSelecionada === null ? 'bg-gray-50 font-medium text-gray-800' : 'text-gray-500 hover:bg-gray-50'}`}>
                    Todas
                  </button>
                </li>
                {categoriasDaNatureza.map(c => (
                  <li key={c.id} className={categoriaSelecionada === c.id ? 'bg-gray-50' : ''}>
                    {editCategoriaId === c.id ? (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <input value={editCategoriaForm.nome}
                          onChange={e => setEditCategoriaForm(f => ({ ...f, nome: e.target.value }))}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
                        <input type="number" value={editCategoriaForm.ordem}
                          onChange={e => setEditCategoriaForm(f => ({ ...f, ordem: Number(e.target.value) }))}
                          className="w-14 rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
                        <button onClick={() => salvarEdicaoCategoria(c.id)} className="text-xs font-medium text-green-600 hover:underline whitespace-nowrap">Salvar</button>
                        <button onClick={() => setEditCategoriaId(null)} className="text-xs text-gray-400 hover:underline whitespace-nowrap">Cancelar</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button onClick={() => setCategoriaSelecionada(c.id)}
                          className={`flex-1 text-left text-sm ${categoriaSelecionada === c.id ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                          {c.nome}
                        </button>
                        {(podeEditar || podeExcluir) && (
                          <span className="flex shrink-0 gap-2">
                            {podeEditar && (
                              <button onClick={() => iniciarEdicaoCategoria(c)} className="text-xs text-blue-500 hover:underline">Editar</button>
                            )}
                            {podeExcluir && <BtnExcluir onClick={() => setConfirmExcluirCategoria(c)} />}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
                {categoriasDaNatureza.length === 0 && (
                  <li className="py-6 text-center text-sm text-gray-400">Nenhuma categoria</li>
                )}
              </ul>
            )}
          </div>
        </div>

        {/* ── Coluna: Subitens ── */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Subitens {categoriaSelecionada && `— ${categoriasDaNatureza.find(c => c.id === categoriaSelecionada)?.nome ?? ''}`}
          </h3>

          {podeCriar && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <form onSubmit={criarSubitem} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input required value={formSubitem.nome}
                  onChange={e => setFormSubitem(f => ({ ...f, nome: e.target.value }))}
                  placeholder="Nome do subitem" className={`${inputCls} sm:col-span-3`} />
                <div className="col-span-1 flex items-center gap-3 sm:col-span-3">
                  {erroSubitem && <p className="text-xs text-red-600">{erroSubitem}</p>}
                  <button type="submit" disabled={criandoSubitem || !categoriaSelecionada}
                    className="ml-auto rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50">
                    {criandoSubitem ? 'Criando…' : '+ Criar Subitem'}
                  </button>
                </div>
                {!categoriaSelecionada && (
                  <p className="col-span-1 text-xs text-gray-400 sm:col-span-3">
                    Selecione uma categoria à esquerda para criar um subitem nela.
                  </p>
                )}
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
                    <th className="px-4 py-3">Categoria</th>
                    {natureza === 'receita' && (
                      <th className="px-4 py-3" title="Receitas deste subitem aparecem só na DRE: fora da Visão Geral e dos totais de Lançamentos.">
                        Constar apenas na DRE
                      </th>
                    )}
                    {(podeEditar || podeExcluir) && <th className="px-4 py-3 text-right">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {subitensExibidos.map(s => (
                    <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50">
                      {editSubitemId === s.id ? (
                        <>
                          <td className="px-4 py-1.5">
                            <input value={editSubitemForm.nome}
                              onChange={e => setEditSubitemForm(f => ({ ...f, nome: e.target.value }))}
                              className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
                          </td>
                          <td className="px-4 py-1.5">
                            <select value={editSubitemForm.categoria_id}
                              onChange={e => setEditSubitemForm(f => ({ ...f, categoria_id: e.target.value }))}
                              className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none">
                              {categoriasDaNatureza.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                          </td>
                          {natureza === 'receita' && <td className="px-4 py-1.5" />}
                          <td className="px-4 py-1.5 text-right">
                            <span className="inline-flex gap-2">
                              <button onClick={() => salvarEdicaoSubitem(s.id)} className="text-xs font-medium text-green-600 hover:underline">Salvar</button>
                              <button onClick={() => setEditSubitemId(null)} className="text-xs text-gray-400 hover:underline">Cancelar</button>
                            </span>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{s.nome}</td>
                          <td className="px-4 py-2.5 text-gray-500">{s.categoria_nome ?? '—'}</td>
                          {natureza === 'receita' && (
                            <td className="px-4 py-2.5">
                              <input type="checkbox" checked={!!s.somente_dre} disabled={!podeEditar}
                                onChange={() => alternarSomenteDre(s)}
                                aria-label={`Constar apenas na DRE: ${s.nome}`}
                                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy disabled:opacity-50" />
                            </td>
                          )}
                          {(podeEditar || podeExcluir) && (
                            <td className="px-4 py-2.5 text-right">
                              <span className="inline-flex gap-3">
                                {podeEditar && (
                                  <button onClick={() => iniciarEdicaoSubitem(s)} className="text-xs text-blue-500 hover:underline">Editar</button>
                                )}
                                {podeExcluir && <BtnExcluir onClick={() => setConfirmExcluirSubitem(s)} />}
                              </span>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  ))}
                  {subitensExibidos.length === 0 && (
                    <tr><td colSpan={4} className="py-8 text-center text-sm text-gray-400">Nenhum subitem cadastrado</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
