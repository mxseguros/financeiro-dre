import { useEffect, useState, useCallback, Fragment } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { inputCls, BtnExcluir } from './shared'
import { arvoreCentros, proximoNumeroSub, rotuloCentro, type CentroCusto } from '@/lib/centros'

// Centros em grupos e subgrupos (24/11/2026): "1.00 - Venda Nova" › "1.21 - Saúde e Vida".
// Dois níveis. Grupo com subgrupos não recebe lançamento; filtrar pelo grupo
// traz os lançamentos de todos os subgrupos.

type Form = { numero: string; nome: string; parent_id: string }
const VAZIO: Form = { numero: '', nome: '', parent_id: '' }

export function SecaoCentros({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [items, setItems] = useState<CentroCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [criando, setCriando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmExcluir, setConfirmExcluir] = useState<CentroCusto | null>(null)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(VAZIO)
  const [edit, setEdit] = useState<Form & { ativo: boolean }>({ ...VAZIO, ativo: true })
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<CentroCusto[]>('/configuracoes/centros-custo', token)
      .then(setItems).catch(() => {}).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { carregar() }, [carregar])

  // Numeração automática do subgrupo (24/11/2026): ao escolher o grupo, o Nº
  // vem preenchido (1.10 → 1.11, 1.12…). Dá para trocar; editado à mão, fica.
  const [numeroManual, setNumeroManual] = useState(false)
  const grupoDoForm = items.find(c => c.id === form.parent_id)
  const sugestao = proximoNumeroSub(grupoDoForm, items)
  useEffect(() => {
    if (!numeroManual) setForm(f => ({ ...f, numero: f.parent_id ? sugestao : '' }))
  }, [sugestao, numeroManual, form.parent_id])

  const arvore = arvoreCentros(items)
  // Só centro raiz pode ser grupo (dois níveis).
  const gruposPossiveis = (excetoId?: string) => items.filter(c => !c.parent_id && c.id !== excetoId)
  const temFilhos = (id: string) => items.some(c => c.parent_id === id)

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      await api.post('/configuracoes/centros-custo', token, {
        nome: form.nome, numero: form.numero || null, parent_id: form.parent_id || null,
      })
      setForm(f => ({ ...VAZIO, parent_id: f.parent_id })); setNumeroManual(false); carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro') }
    finally { setCriando(false) }
  }

  function iniciarEdicao(c: CentroCusto) {
    setEditId(c.id)
    setEdit({ numero: c.numero ?? '', nome: c.nome, parent_id: c.parent_id ?? '', ativo: c.ativo })
  }

  async function salvarEdicao(c: CentroCusto) {
    try {
      await api.put(`/configuracoes/centros-custo/${c.id}`, token, {
        nome: edit.nome, numero: edit.numero, ativo: edit.ativo,
        ...(edit.parent_id ? { parent_id: edit.parent_id } : { sem_grupo: true }),
      })
      setEditId(null); carregar()
      toast.sucesso('Centro de custo atualizado.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar centro de custo.')
    }
  }

  async function excluir(c: CentroCusto) {
    // Erro no diálogo: "em uso" / "tem subgrupos" é resposta esperada e precisa ser lida.
    setErroExclusao(null); setExcluindo(true)
    try {
      await api.delete(`/configuracoes/centros-custo/${c.id}`, token)
      setConfirmExcluir(null); carregar()
      toast.sucesso(`Centro "${c.nome}" excluído.`)
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : 'Erro ao excluir centro de custo.')
    } finally {
      setExcluindo(false)
    }
  }

  const linha = (c: CentroCusto, sub: boolean) => (
    <tr key={c.id} className={`border-t border-gray-50 hover:bg-gray-50 ${c.ativo ? '' : 'opacity-50'}`}>
      {editId === c.id ? (
        <>
          <td className="px-4 py-1.5">
            <div className="flex gap-2">
              <input value={edit.numero} onChange={e => setEdit(f => ({ ...f, numero: e.target.value }))}
                placeholder="Nº" aria-label="Número"
                className="w-20 rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
              <input value={edit.nome} onChange={e => setEdit(f => ({ ...f, nome: e.target.value }))}
                aria-label="Nome"
                className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
            </div>
          </td>
          <td className="px-4 py-1.5">
            <select value={edit.parent_id} disabled={temFilhos(c.id)}
              onChange={e => {
                const pid = e.target.value
                // Atrelou a outro grupo: renumera pelo grupo novo.
                const num = pid && pid !== c.parent_id ? proximoNumeroSub(items.find(x => x.id === pid), items, c.id) : null
                setEdit(f => ({ ...f, parent_id: pid, ...(num !== null ? { numero: num } : {}) }))
              }} aria-label="Grupo"
              className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none disabled:bg-gray-50">
              <option value="">— Grupo principal —</option>
              {gruposPossiveis(c.id).map(g => <option key={g.id} value={g.id}>{rotuloCentro(g)}</option>)}
            </select>
          </td>
          <td className="px-4 py-1.5">
            <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={edit.ativo} onChange={e => setEdit(f => ({ ...f, ativo: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
              Ativo
            </label>
          </td>
          <td className="px-4 py-1.5 text-right">
            <span className="inline-flex gap-2">
              <button onClick={() => salvarEdicao(c)} className="text-xs font-medium text-green-600 hover:underline">Salvar</button>
              <button onClick={() => setEditId(null)} className="text-xs text-gray-400 hover:underline">Cancelar</button>
            </span>
          </td>
        </>
      ) : (
        <>
          <td className={`py-2.5 pr-4 ${sub ? 'pl-10 text-gray-700' : 'pl-4 font-semibold text-gray-800'}`}>
            {sub && <span className="mr-1.5 text-gray-300" aria-hidden>└</span>}
            {rotuloCentro(c)}
          </td>
          <td className="px-4 py-2.5 text-xs text-gray-500">
            {sub ? 'Subgrupo' : temFilhos(c.id) ? 'Grupo' : 'Centro'}
          </td>
          <td className="px-4 py-2.5 text-xs text-gray-500">{c.ativo ? 'Ativo' : 'Inativo'}</td>
          {(podeEditar || podeExcluir) && (
            <td className="px-4 py-2.5 text-right">
              <span className="inline-flex gap-3">
                {podeEditar && (
                  <button onClick={() => iniciarEdicao(c)} className="text-xs text-blue-500 hover:underline">Editar</button>
                )}
                {podeExcluir && <BtnExcluir onClick={() => setConfirmExcluir(c)} />}
              </span>
            </td>
          )}
        </>
      )}
    </tr>
  )

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={!!confirmExcluir}
        titulo="Excluir centro de custo?"
        mensagem={<><strong>{confirmExcluir && rotuloCentro(confirmExcluir)}</strong> será excluído permanentemente.</>}
        erro={erroExclusao}
        loading={excluindo}
        onCancelar={() => { setConfirmExcluir(null); setErroExclusao(null) }}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      {podeCriar && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Novo Centro de Custo</h3>
          <form onSubmit={criar} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <input value={form.numero} onChange={e => { setNumeroManual(true); setForm(f => ({ ...f, numero: e.target.value })) }}
              placeholder={form.parent_id ? 'Nº' : 'Nº (ex.: 1.10)'} aria-label="Número" className={`${inputCls} sm:w-32`} />
            <input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Nome (ex.: Saúde e Vida)" aria-label="Nome" className={`${inputCls} flex-1`} />
            <select value={form.parent_id} onChange={e => { setNumeroManual(false); setForm(f => ({ ...f, parent_id: e.target.value })) }}
              aria-label="Grupo" className={`${inputCls} sm:w-60`}>
              <option value="">— Grupo principal —</option>
              {gruposPossiveis().map(g => <option key={g.id} value={g.id}>Subgrupo de {rotuloCentro(g)}</option>)}
            </select>
            <button type="submit" disabled={criando}
              className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50 whitespace-nowrap">
              {criando ? 'Criando…' : '+ Criar Centro'}
            </button>
          </form>
          {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
          {grupoDoForm && !sugestao && (
            <p className="mt-2 text-xs text-amber-600">
              {grupoDoForm.numero ? 'Não há mais número livre neste grupo: informe o Nº à mão.'
                : `Dê um número ao grupo "${grupoDoForm.nome}" (ex.: 1.10) para os subgrupos serem numerados sozinhos.`}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-400">
            Ao escolher o grupo, o subgrupo é numerado sozinho (1.10 → 1.11, 1.12…). Lançamentos vão nos subgrupos; o grupo soma e filtra.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-10 text-center text-sm text-gray-400">Carregando…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                <th className="px-4 py-3">Centro</th>
                <th className="px-4 py-3">Nível</th>
                <th className="px-4 py-3">Situação</th>
                {(podeEditar || podeExcluir) && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {arvore.map(({ grupo, filhos }) => (
                <Fragment key={grupo.id}>
                  {linha(grupo, false)}
                  {filhos.map(f => linha(f, true))}
                </Fragment>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-sm text-gray-400">Nenhum centro cadastrado</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
