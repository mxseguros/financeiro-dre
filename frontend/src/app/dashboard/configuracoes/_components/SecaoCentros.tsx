import { useEffect, useState, useCallback, Fragment } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { inputCls, BtnExcluir } from './shared'
import { arvoreCentros, numeroSub, proximoNumeroSub, rotuloCentro, type CentroCusto } from '@/lib/centros'

// Centros em grupos e subgrupos (24/11/2026): "1 - Matriz" › "1.11 - Financeiro".
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

  // Numeração automática do subgrupo (28/11/2026): uma só sequência por grupo,
  // começando em 11 (1 → 1.11, 1.12…; 2 → 2.11…). O backend renumera ao criar,
  // excluir ou mover. Só o número do grupo é digitado.
  const grupoDoForm = items.find(c => c.id === form.parent_id)
  const sugestao = proximoNumeroSub(grupoDoForm, items)
  const numerado = (grupoId: string | null | undefined) => !!numeroSub(items.find(g => g.id === grupoId)?.numero, 1)
  const [movendo, setMovendo] = useState<string | null>(null)
  const [confirmRenumerar, setConfirmRenumerar] = useState(false)
  const [renumerando, setRenumerando] = useState(false)

  // Subgrupos cujo número não bate com a sequência do grupo (ex.: dados
  // numerados pela regra antiga, 1.9 → 2.0). Mostra o aviso com o botão.
  const foraDeSequencia = arvoreCentros(items).flatMap(({ grupo, filhos }) =>
    filhos.filter((f, i) => {
      const esperado = numeroSub(grupo.numero, i + 1)
      return esperado && (f.numero ?? '') !== esperado
    }))

  async function renumerar() {
    setRenumerando(true)
    try {
      const lista = await api.post<CentroCusto[]>('/configuracoes/centros-custo/renumerar', token, {})
      setItems(lista); setConfirmRenumerar(false)
      toast.sucesso('Numeração reorganizada.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Não foi possível reorganizar a numeração.')
    } finally {
      setRenumerando(false)
    }
  }

  async function mover(c: CentroCusto, direcao: 'cima' | 'baixo') {
    setMovendo(c.id)
    try {
      await api.post(`/configuracoes/centros-custo/${c.id}/mover`, token, { direcao })
      carregar()
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Não foi possível mover.')
    } finally {
      setMovendo(null)
    }
  }

  const arvore = arvoreCentros(items)
  // Só centro raiz pode ser grupo (dois níveis).
  const gruposPossiveis = (excetoId?: string) => items.filter(c => !c.parent_id && c.id !== excetoId)
  const temFilhos = (id: string) => items.some(c => c.parent_id === id)

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      await api.post('/configuracoes/centros-custo', token, {
        nome: form.nome, numero: (!form.parent_id && form.numero) || null, parent_id: form.parent_id || null,
      })
      setForm(f => ({ ...VAZIO, parent_id: f.parent_id })); carregar()
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
        nome: edit.nome, ativo: edit.ativo,
        // Subgrupo de grupo numerado: número automático (o backend ignora).
        ...(edit.parent_id && numerado(edit.parent_id) ? {} : { numero: edit.numero }),
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
              {edit.parent_id && numerado(edit.parent_id) ? (
                <span className="w-20 shrink-0 self-center text-[13px] text-slate-500" title="Número automático pelo grupo">
                  {edit.parent_id === c.parent_id ? c.numero : 'auto'}
                </span>
              ) : (
                <input value={edit.numero} onChange={e => setEdit(f => ({ ...f, numero: e.target.value }))}
                  placeholder="Nº" aria-label="Número"
                  className="w-20 rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
              )}
              <input value={edit.nome} onChange={e => setEdit(f => ({ ...f, nome: e.target.value }))}
                aria-label="Nome"
                className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none" />
            </div>
          </td>
          <td className="px-4 py-1.5">
            <select value={edit.parent_id} disabled={temFilhos(c.id)}
              onChange={e => setEdit(f => ({ ...f, parent_id: e.target.value }))} aria-label="Grupo"
              className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none disabled:bg-gray-50">
              <option value="">— Grupo principal —</option>
              {gruposPossiveis(c.id).map(g => <option key={g.id} value={g.id}>{rotuloCentro(g)}</option>)}
            </select>
          </td>
          <td className="px-4 py-1.5">
            <label className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
              <input type="checkbox" checked={edit.ativo} onChange={e => setEdit(f => ({ ...f, ativo: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
              Ativo
            </label>
          </td>
          <td className="px-4 py-1.5 text-right">
            <span className="inline-flex gap-2">
              <button onClick={() => salvarEdicao(c)} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] font-medium text-green-800 hover:underline">Salvar</button>
              <button onClick={() => setEditId(null)} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] text-slate-500 hover:underline">Cancelar</button>
            </span>
          </td>
        </>
      ) : (
        <>
          <td className={`py-2.5 pr-4 ${sub ? 'pl-10 text-gray-700' : 'pl-4 font-semibold text-gray-800'}`}>
            {sub && <span className="mr-1.5 text-gray-300" aria-hidden>└</span>}
            {rotuloCentro(c)}
          </td>
          <td className="px-4 py-2.5 text-[13px] text-gray-500">
            {sub ? 'Subgrupo' : temFilhos(c.id) ? 'Grupo' : 'Centro'}
          </td>
          <td className="px-4 py-2.5 text-[13px] text-gray-500">{c.ativo ? 'Ativo' : 'Inativo'}</td>
          {(podeEditar || podeExcluir) && (
            <td className="px-4 py-2.5 text-right">
              <span className="inline-flex items-center gap-3">
                {podeEditar && sub && numerado(c.parent_id) && (
                  <span className="inline-flex gap-0.5">
                    {(['cima', 'baixo'] as const).map(d => (
                      <button key={d} type="button" onClick={() => mover(c, d)} disabled={movendo !== null}
                        aria-label={d === 'cima' ? 'Subir' : 'Descer'} title={d === 'cima' ? 'Subir' : 'Descer'}
                        className="rounded px-1 text-[13px] text-slate-500 hover:bg-gray-100 hover:text-navy disabled:opacity-40">
                        {d === 'cima' ? '↑' : '↓'}
                      </button>
                    ))}
                  </span>
                )}
                {podeEditar && (
                  <button onClick={() => iniciarEdicao(c)} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] text-sel hover:underline">Editar</button>
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
      <ConfirmDialog
        open={confirmRenumerar}
        titulo="Reorganizar a numeração?"
        mensagem={<>Os subgrupos de cada grupo passam a seguir uma só sequência, na ordem atual
          (1.11, 1.12, 1.13…). Os lançamentos não mudam: eles guardam o centro, não o número.</>}
        confirmarLabel="Reorganizar"
        confirmarVariant="primary"
        loading={renumerando}
        onCancelar={() => setConfirmRenumerar(false)}
        onConfirmar={renumerar}
      />

      {podeEditar && foraDeSequencia.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-amber-800">
            <strong>{foraDeSequencia.length} subgrupo{foraDeSequencia.length > 1 ? 's' : ''}</strong> fora da sequência do grupo
            ({foraDeSequencia.slice(0, 3).map(c => c.numero || 's/ nº').join(', ')}{foraDeSequencia.length > 3 ? '…' : ''}).
          </p>
          <button type="button" onClick={() => setConfirmRenumerar(true)}
            className="focus-ring min-h-10 shrink-0 rounded-lg bg-navy px-4 text-sm font-medium text-white hover:bg-navy-light">
            Reorganizar numeração
          </button>
        </div>
      )}

      {podeCriar && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-gray-500">Novo Centro de Custo</h3>
          <form onSubmit={criar} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <input value={form.parent_id ? (sugestao ? `${sugestao} (auto)` : '') : form.numero}
              disabled={!!form.parent_id}
              onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
              placeholder={form.parent_id ? 'Nº auto' : 'Nº (ex.: 5)'} aria-label="Número"
              title={form.parent_id ? 'Número automático pelo grupo' : undefined}
              className={`${inputCls} sm:w-32 disabled:bg-gray-100 disabled:text-gray-500`} />
            <input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Nome (ex.: Saúde e Vida)" aria-label="Nome" className={`${inputCls} flex-1`} />
            <select value={form.parent_id} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
              aria-label="Grupo" className={`${inputCls} sm:w-60`}>
              <option value="">— Grupo principal —</option>
              {gruposPossiveis().map(g => <option key={g.id} value={g.id}>Subgrupo de {rotuloCentro(g)}</option>)}
            </select>
            <button type="submit" disabled={criando}
              className="rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50 whitespace-nowrap">
              {criando ? 'Criando…' : '+ Criar Centro'}
            </button>
          </form>
          {erro && <p className="mt-2 text-[13px] text-red-600">{erro}</p>}
          {grupoDoForm && !sugestao && (
            <p className="mt-2 text-[13px] text-amber-600">
              Dê um número ao grupo &quot;{grupoDoForm.nome}&quot; (ex.: 5) para os subgrupos serem numerados sozinhos.
            </p>
          )}
          <p className="mt-2 text-[13px] text-slate-500">
            Numeração automática: cada grupo tem uma só sequência, começando em 11 (1 → 1.11, 1.12, 1.13…; 2 → 2.11…) e, ao excluir, os seguintes sobem.
            Use ↑ ↓ para mudar a ordem. Lançamentos vão nos subgrupos; o grupo soma e filtra.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-10 text-center text-sm text-slate-500">Carregando…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[13px] font-medium text-gray-500">
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
                <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-500">Nenhum centro cadastrado</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
