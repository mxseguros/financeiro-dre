// Favorecidos de pagamento (0050): fornecedores com CPF/CNPJ, conta e chave
// Pix. Os funcionários aparecem aqui só para consulta — os dados deles são
// editados no contrato (Configurações → Funcionários).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { CamposBancarios, formBancarioVazio, paraFormBancario, paraPayloadBancario, type FormBancario } from '@/components/pagamentos/CamposBancarios'
import { nomeForma, type Fornecedor } from '@/lib/pagamentos'
import { BtnExcluir, Chip, inputCls } from './shared'

function ModalFornecedor({ token, item, onClose, onSaved }: {
  token: string; item: Fornecedor | null; onClose: () => void; onSaved: () => void
}) {
  const [nome, setNome] = useState(item?.nome ?? '')
  const [doc, setDoc] = useState(item?.cpf_cnpj ?? '')
  const [ativo, setAtivo] = useState(item?.ativo ?? true)
  const [banc, setBanc] = useState<FormBancario>(item ? paraFormBancario(item) : formBancarioVazio())
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true); setErro(null)
    const corpo = { nome, cpf_cnpj: doc.trim() || null, ativo, ...paraPayloadBancario(banc) }
    try {
      if (item) await api.put(`/pagamentos/fornecedores/${item.id}`, token, corpo)
      else await api.post('/pagamentos/fornecedores', token, corpo)
      toast.sucesso(item ? 'Favorecido atualizado.' : 'Favorecido cadastrado.')
      onSaved(); onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
      setSalvando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={item ? `Favorecido — ${item.nome}` : 'Novo favorecido'}
      maxWidth="sm:max-w-2xl" dismissable={!salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
          <label className="block">
            <span className="mb-0.5 block text-xs font-medium text-gray-600">Nome / razão social</span>
            <input required minLength={2} value={nome} onChange={e => setNome(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs font-medium text-gray-600">CPF ou CNPJ</span>
            <input value={doc} onChange={e => setDoc(e.target.value)} placeholder="Aceita CNPJ com letras"
              className={inputCls} autoComplete="off" />
          </label>
        </div>
        <CamposBancarios form={banc} onChange={setBanc} />
        {item && (
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
            Ativo (aparece na busca do lançamento)
          </label>
        )}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando}>Salvar</Button>
        </div>
      </form>
    </Modal>
  )
}

export function SecaoFornecedores({ token, podeGerenciar }: { token: string; podeGerenciar: boolean }) {
  const [items, setItems] = useState<Fornecedor[]>([])
  const [loading, setLoading] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Fornecedor | null | 'novo'>(null)
  const [excluir, setExcluir] = useState<Fornecedor | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<Fornecedor[]>('/pagamentos/fornecedores?inativos=true', token)
      .then(r => { setItems(r); setAviso(null) })
      .catch(e => setAviso(e instanceof Error ? e.message : 'Não foi possível carregar.'))
      .finally(() => setLoading(false))
  }, [token])
  useEffect(() => { carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return t ? items.filter(i => i.nome.toLowerCase().includes(t)) : items
  }, [items, busca])

  async function confirmarExclusao(f: Fornecedor) {
    setExcluindo(true)
    try {
      await api.delete(`/pagamentos/fornecedores/${f.id}`, token)
      toast.sucesso(`${f.nome} excluído.`)
      setExcluir(null); carregar()
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir.')
    } finally { setExcluindo(false) }
  }

  return (
    <div className="space-y-4">
      {editando && (
        <ModalFornecedor token={token} item={editando === 'novo' ? null : editando}
          onClose={() => setEditando(null)} onSaved={carregar} />
      )}
      <ConfirmDialog open={!!excluir} titulo="Excluir favorecido?"
        mensagem={<><strong>{excluir?.nome}</strong> será excluído. Se já tiver despesas, desative em vez de excluir.</>}
        loading={excluindo} onCancelar={() => setExcluir(null)} onConfirmar={() => excluir && confirmarExclusao(excluir)} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar favorecido"
          className={`${inputCls} sm:max-w-xs`} />
        <div className="flex-1" />
        {podeGerenciar && <Button type="button" onClick={() => setEditando('novo')}>+ Novo favorecido</Button>}
      </div>
      {aviso && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{aviso}</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-10 text-center text-sm text-gray-400">Carregando…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                <th className="px-4 py-3">Favorecido</th>
                <th className="px-4 py-3">CPF/CNPJ</th>
                <th className="px-4 py-3">Pix</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Forma padrão</th>
                {podeGerenciar && <th className="px-4 py-3 text-right">Ações</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(f => (
                <tr key={f.id} className={`border-t border-gray-50 hover:bg-gray-50 ${f.ativo ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">
                    {f.nome}{' '}
                    {f.funcionario_id && <Chip label="Funcionário" cor="bg-purple-50 text-purple-700" />}
                    {!f.ativo && <Chip label="Inativo" cor="bg-gray-100 text-gray-500" />}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{f.documento_mascarado ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{f.pix_mascarada ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{f.conta_mascarada ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{nomeForma(f.forma_pagamento_padrao)}</td>
                  {podeGerenciar && (
                    <td className="px-4 py-2.5 text-right">
                      {f.funcionario_id ? (
                        <span className="text-[11px] text-gray-400">Editar no contrato</span>
                      ) : (
                        <span className="inline-flex gap-3">
                          <button onClick={() => setEditando(f)} className="text-xs text-blue-500 hover:underline">Editar</button>
                          <BtnExcluir onClick={() => setExcluir(f)} />
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                  {busca ? 'Nenhum favorecido encontrado' : 'Nenhum favorecido cadastrado'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
