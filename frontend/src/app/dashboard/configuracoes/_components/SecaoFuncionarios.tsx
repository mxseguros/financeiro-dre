import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { OpcoesCentro, nomeCentro, type CentroCusto } from '@/lib/centros'
import type { Funcionario } from '@/lib/funcionarios'
import { inputCls, BtnExcluir } from './shared'
import { ModalRemuneracao } from './ModalRemuneracao'
import { fmtBRL } from '@/lib/utils'
import type { CustosPessoal } from '@/lib/remuneracao'

// Funcionários (24/11/2026): nome completo e centro de custo. Aparecem no
// "Quem é você?" do link /oc — a Ordem de Compra fica no nome do funcionário
// e já vem com o centro dele.

const VAZIO = { nome: '', centro_custo: '' }

export function SecaoFuncionarios({ token, podeCriar, podeEditar, podeExcluir, ehAdmin = false }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
  /** Remuneração e custo mensal (0052) só aparecem para o Admin. */
  ehAdmin?: boolean
}) {
  const [items, setItems] = useState<Funcionario[]>([])
  const [centros, setCentros] = useState<CentroCusto[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(VAZIO)
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ ...VAZIO, ativo: true })
  const [confirmExcluir, setConfirmExcluir] = useState<Funcionario | null>(null)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const toast = useToast()
  const [contratoDe, setContratoDe] = useState<Funcionario | null>(null)
  const [custos, setCustos] = useState<CustosPessoal | null>(null)

  const carregar = useCallback(() => {
    api.get<Funcionario[]>('/configuracoes/funcionarios', token)
      .then(setItems).catch(() => {}).finally(() => setLoading(false))
    if (ehAdmin) api.get<CustosPessoal>('/configuracoes/funcionarios/custos', token).then(setCustos).catch(() => setCustos(null))
  }, [token, ehAdmin])

  useEffect(() => {
    carregar()
    api.get<CentroCusto[]>('/configuracoes/centros-custo', token).then(setCentros).catch(() => {})
  }, [carregar, token])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setCriando(true); setErro(null)
    try {
      await api.post('/configuracoes/funcionarios', token, {
        nome: form.nome, centro_custo: form.centro_custo || null,
      })
      setForm(f => ({ ...VAZIO, centro_custo: f.centro_custo })); carregar()
    } catch (err) { setErro(err instanceof Error ? err.message : 'Erro ao cadastrar.') }
    finally { setCriando(false) }
  }

  async function salvar(f: Funcionario) {
    try {
      await api.put(`/configuracoes/funcionarios/${f.id}`, token, {
        nome: edit.nome, centro_custo: edit.centro_custo || null, ativo: edit.ativo,
      })
      setEditId(null); carregar()
      toast.sucesso('Funcionário atualizado.')
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar.')
    }
  }

  async function excluir(f: Funcionario) {
    setErroExclusao(null); setExcluindo(true)
    try {
      await api.delete(`/configuracoes/funcionarios/${f.id}`, token)
      setConfirmExcluir(null); carregar()
      toast.sucesso(`${f.nome} excluído.`)
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : 'Erro ao excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const cel = 'rounded border border-gray-200 px-2 py-1 text-sm focus-ring focus:outline-none'

  return (
    <div className="space-y-5">
      {contratoDe && (
        <ModalRemuneracao token={token} funcionario={contratoDe} onClose={() => setContratoDe(null)} onSaved={carregar} />
      )}
      <ConfirmDialog
        open={!!confirmExcluir}
        titulo="Excluir funcionário?"
        mensagem={<><strong>{confirmExcluir?.nome}</strong> será excluído. Se ele já tem Ordens de Compra, desative em vez de excluir.</>}
        erro={erroExclusao}
        loading={excluindo}
        onCancelar={() => { setConfirmExcluir(null); setErroExclusao(null) }}
        onConfirmar={() => confirmExcluir && excluir(confirmExcluir)}
      />

      {podeCriar && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-gray-500">Novo Funcionário</h3>
          <form onSubmit={criar} className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <input required minLength={3} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              placeholder="Nome completo" aria-label="Nome completo" className={`${inputCls} flex-1`} />
            <select value={form.centro_custo} onChange={e => setForm(f => ({ ...f, centro_custo: e.target.value }))}
              aria-label="Centro de custo" className={`${inputCls} sm:w-64`}>
              <option value="">Centro de custo…</option>
              <OpcoesCentro centros={centros} atual={form.centro_custo} />
            </select>
            <button type="submit" disabled={criando}
              className="whitespace-nowrap rounded-lg bg-navy px-5 py-2 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50">
              {criando ? 'Salvando…' : '+ Cadastrar'}
            </button>
          </form>
          {erro && <p className="mt-2 text-[13px] text-red-600">{erro}</p>}
          <p className="mt-2 text-[13px] text-slate-500">
            Quem estiver aqui aparece em &quot;Quem é você?&quot; no link da Ordem de Compra (/oc).
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-10 text-center text-sm text-slate-500">Carregando…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[13px] font-medium text-gray-500">
                <th className="px-4 py-3">Nome completo</th>
                <th className="px-4 py-3">Centro de custo</th>
                <th className="px-4 py-3">Situação</th>
                {ehAdmin && <th className="px-4 py-3 text-right" title="Salário + FGTS + benefícios">Custo/mês</th>}
                {(podeEditar || podeExcluir || ehAdmin) && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(f => (
                <tr key={f.id} className={`border-t border-gray-50 hover:bg-gray-50 ${f.ativo ? '' : 'opacity-50'}`}>
                  {editId === f.id ? (
                    <>
                      <td className="px-4 py-1.5">
                        <input value={edit.nome} onChange={e => setEdit(x => ({ ...x, nome: e.target.value }))}
                          aria-label="Nome completo" className={`w-full ${cel}`} />
                      </td>
                      <td className="px-4 py-1.5">
                        <select value={edit.centro_custo} onChange={e => setEdit(x => ({ ...x, centro_custo: e.target.value }))}
                          aria-label="Centro de custo" className={`w-full ${cel}`}>
                          <option value="">—</option>
                          <OpcoesCentro centros={centros} atual={edit.centro_custo} />
                        </select>
                      </td>
                      <td className="px-4 py-1.5">
                        <label className="inline-flex items-center gap-1.5 text-[13px] text-gray-600">
                          <input type="checkbox" checked={edit.ativo} onChange={e => setEdit(x => ({ ...x, ativo: e.target.checked }))}
                            className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
                          Ativo
                        </label>
                      </td>
                      {ehAdmin && <td />}
                      <td className="px-4 py-1.5 text-right">
                        <span className="inline-flex gap-2">
                          <button onClick={() => salvar(f)} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] font-medium text-green-800 hover:underline">Salvar</button>
                          <button onClick={() => setEditId(null)} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] text-slate-500 hover:underline">Cancelar</button>
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{f.nome}</td>
                      <td className="px-4 py-2.5 text-gray-600">{f.centro_custo ? nomeCentro(f.centro_custo, centros) : '—'}</td>
                      <td className="px-4 py-2.5 text-[13px] text-gray-500">{f.ativo ? 'Ativo' : 'Inativo'}</td>
                      {ehAdmin && (
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                          {custos?.por_funcionario[f.id] ? fmtBRL(custos.por_funcionario[f.id].custo_mensal) : <span className="text-[13px] text-gray-300">—</span>}
                        </td>
                      )}
                      {(podeEditar || podeExcluir || ehAdmin) && (
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex gap-3">
                            {ehAdmin && (
                              <button onClick={() => setContratoDe(f)} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] font-medium text-navy hover:underline">
                                Pagamento
                              </button>
                            )}
                            {podeEditar && (
                              <button onClick={() => { setEditId(f.id); setEdit({ nome: f.nome, centro_custo: f.centro_custo ?? '', ativo: f.ativo }) }}
                                className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] text-sel hover:underline">Editar</button>
                            )}
                            {podeExcluir && <BtnExcluir onClick={() => setConfirmExcluir(f)} />}
                          </span>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-slate-500">Nenhum funcionário cadastrado</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {ehAdmin && custos && Object.keys(custos.por_centro).length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-navy">Custo mensal de pessoal por centro</h3>
            <p className="text-sm font-semibold tabular-nums text-navy">Total {fmtBRL(custos.total_mes)}</p>
          </div>
          <p className="mt-1 text-[13px] text-slate-500">Salário + FGTS + benefícios (13º, férias, abono e rescisão ficam de fora).</p>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-[13px] text-gray-500">
                <th className="py-1">Centro</th><th className="py-1 text-right">Pessoas</th>
                <th className="py-1 text-right">Custo mensal</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(custos.por_centro).sort((a, b) => b[1].custo_mensal - a[1].custo_mensal).map(([cod, v]) => (
                <tr key={cod} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{cod === 'sem_centro' ? 'Sem centro' : nomeCentro(cod, centros)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-600">{v.pessoas}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800">{fmtBRL(v.custo_mensal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[13px] text-slate-500">Só funcionários ativos com valores preenchidos em Pagamento.</p>
        </div>
      )}
    </div>
  )
}
