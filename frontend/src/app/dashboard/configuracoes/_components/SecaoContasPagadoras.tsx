// Contas pagadoras (0050, só Admin): conta da MX de onde sai o pagamento por
// CNAB, com o convênio e as opções que o banco contratou com a MX.
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import type { ContaPagadora, OpcoesConvenio } from '@/lib/pagamentos'
import { BtnExcluir, Chip, inputCls } from './shared'

type Form = {
  codigo_banco: '033' | '341'; apelido: string; agencia: string; agencia_dv: string; conta: string; conta_dv: string
  cnpj_empresa: string; razao_social: string; codigo_convenio: string; proximo_nsa: string
  ambiente: 'homologacao' | 'producao'; ativa: boolean; opcoes: OpcoesConvenio
  logradouro: string; numero: string; complemento: string; cidade: string; cep: string; uf: string
}

const OPCOES_PADRAO: OpcoesConvenio = { sequencial_teste: false, seu_numero_obrigatorio: false, sequencia: 'nenhuma', enviar_bloqueado: true }

function paraForm(c: ContaPagadora | null): Form {
  const e = c?.endereco ?? {}
  return {
    codigo_banco: c?.codigo_banco ?? '033', apelido: c?.apelido ?? '', agencia: c?.agencia ?? '', agencia_dv: c?.agencia_dv ?? '',
    conta: c?.conta ?? '', conta_dv: c?.conta_dv ?? '', cnpj_empresa: c?.cnpj_empresa ?? '', razao_social: c?.razao_social ?? '',
    codigo_convenio: c?.codigo_convenio ?? '', proximo_nsa: String(c?.proximo_nsa ?? 1), ambiente: c?.ambiente ?? 'homologacao',
    ativa: c?.ativa ?? true, opcoes: { ...OPCOES_PADRAO, ...(c?.opcoes ?? {}) },
    logradouro: e.logradouro ?? '', numero: e.numero ?? '', complemento: e.complemento ?? '', cidade: e.cidade ?? '',
    cep: e.cep ?? '', uf: e.uf ?? '',
  }
}

function Campo({ rotulo, dica, children, className = '' }: { rotulo: string; dica?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs font-medium text-gray-600">{rotulo}</span>
      {children}
      {dica && <span className="mt-0.5 block text-[11px] text-gray-400">{dica}</span>}
    </label>
  )
}

function Opcao({ checked, onChange, titulo, children }: { checked: boolean; onChange: (v: boolean) => void; titulo: string; children: React.ReactNode }) {
  return (
    <label className="flex gap-2 rounded-lg border border-gray-100 p-2.5 hover:bg-gray-50">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-navy focus:ring-navy" />
      <span>
        <span className="block text-sm font-medium text-gray-700">{titulo}</span>
        <span className="block text-xs text-gray-500">{children}</span>
      </span>
    </label>
  )
}

function ModalConta({ token, item, onClose, onSaved }: { token: string; item: ContaPagadora | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(paraForm(item))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }))
  const setOp = <K extends keyof OpcoesConvenio>(k: K, v: OpcoesConvenio[K]) => setF(x => ({ ...x, opcoes: { ...x.opcoes, [k]: v } }))
  const santander = f.codigo_banco === '033'

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setSalvando(true); setErro(null)
    const corpo = {
      codigo_banco: f.codigo_banco, apelido: f.apelido.trim() || null, agencia: f.agencia, agencia_dv: f.agencia_dv || null,
      conta: f.conta, conta_dv: f.conta_dv || null, cnpj_empresa: f.cnpj_empresa, razao_social: f.razao_social,
      codigo_convenio: f.codigo_convenio.trim() || null, proximo_nsa: parseInt(f.proximo_nsa) || 1,
      ambiente: f.ambiente, ativa: f.ativa, opcoes: f.opcoes,
      endereco: Object.fromEntries((['logradouro', 'numero', 'complemento', 'cidade', 'cep', 'uf'] as const)
        .map(k => [k, f[k].trim()]).filter(([, v]) => v)),
    }
    try {
      if (item) await api.put(`/pagamentos/contas/${item.id}`, token, corpo)
      else await api.post('/pagamentos/contas', token, corpo)
      toast.sucesso('Conta pagadora salva.')
      onSaved(); onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar.')
      setSalvando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Conta pagadora' : 'Nova conta pagadora'} variant="sheet"
      maxWidth="sm:max-w-2xl" dismissable={!salvando}>
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Campo rotulo="Banco">
            <select value={f.codigo_banco} onChange={e => set('codigo_banco', e.target.value as Form['codigo_banco'])} className={inputCls}>
              <option value="033">Santander (033)</option>
              <option value="341">Itaú (341)</option>
            </select>
          </Campo>
          <Campo rotulo="Apelido" className="sm:col-span-2">
            <input value={f.apelido} onChange={e => set('apelido', e.target.value)} placeholder="Ex.: Santander matriz" className={inputCls} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <Campo rotulo="Agência"><input required value={f.agencia} onChange={e => set('agencia', e.target.value.replace(/\D/g, '').slice(0, 5))} className={inputCls} /></Campo>
          <Campo rotulo="Dígito ag."><input value={f.agencia_dv} onChange={e => set('agencia_dv', e.target.value.slice(0, 1))} className={inputCls} /></Campo>
          <Campo rotulo="Conta" className="sm:col-span-2"><input required value={f.conta} onChange={e => set('conta', e.target.value.replace(/\D/g, '').slice(0, 12))} className={inputCls} /></Campo>
          <Campo rotulo="Dígito"><input value={f.conta_dv} onChange={e => set('conta_dv', e.target.value.slice(0, 1))} className={inputCls} /></Campo>
          {santander && (
            <Campo rotulo="Convênio" dica="Do contrato de Pagamento a Fornecedores">
              <input required value={f.codigo_convenio} onChange={e => set('codigo_convenio', e.target.value.replace(/\D/g, '').slice(0, 12))} className={inputCls} />
            </Campo>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
          <Campo rotulo="CNPJ da empresa"><input required value={f.cnpj_empresa} onChange={e => set('cnpj_empresa', e.target.value)} className={inputCls} /></Campo>
          <Campo rotulo="Razão social"><input required value={f.razao_social} onChange={e => set('razao_social', e.target.value)} className={inputCls} /></Campo>
        </div>
        <details className="rounded-lg border border-gray-100 p-2.5">
          <summary className="cursor-pointer text-xs font-medium text-gray-600">Endereço (opcional, vai no cabeçalho do lote)</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
            <Campo rotulo="Logradouro" className="col-span-2 sm:col-span-3"><input value={f.logradouro} onChange={e => set('logradouro', e.target.value)} className={inputCls} /></Campo>
            <Campo rotulo="Número"><input value={f.numero} onChange={e => set('numero', e.target.value.replace(/\D/g, ''))} className={inputCls} /></Campo>
            <Campo rotulo="Complemento" className="sm:col-span-2"><input value={f.complemento} onChange={e => set('complemento', e.target.value)} className={inputCls} /></Campo>
            <Campo rotulo="Cidade" className="sm:col-span-3"><input value={f.cidade} onChange={e => set('cidade', e.target.value)} className={inputCls} /></Campo>
            <Campo rotulo="CEP" className="sm:col-span-2"><input value={f.cep} onChange={e => set('cep', e.target.value.replace(/\D/g, '').slice(0, 8))} className={inputCls} /></Campo>
            <Campo rotulo="UF"><input value={f.uf} onChange={e => set('uf', e.target.value.toUpperCase().slice(0, 2))} className={inputCls} /></Campo>
          </div>
        </details>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Arquivo e convênio</legend>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Ambiente" dica="Em homologação, a tela avisa que o arquivo é de teste">
              <select value={f.ambiente} onChange={e => set('ambiente', e.target.value as Form['ambiente'])} className={inputCls}>
                <option value="homologacao">Homologação (testes)</option>
                <option value="producao">Produção</option>
              </select>
            </Campo>
            <Campo rotulo="Próximo número de arquivo (NSA)" dica={item ? 'Mudar este número fica registrado na auditoria' : undefined}>
              <input type="number" min={1} value={f.proximo_nsa} onChange={e => set('proximo_nsa', e.target.value)} className={inputCls} />
            </Campo>
          </div>
          <Opcao checked={f.opcoes.enviar_bloqueado} onChange={v => setOp('enviar_bloqueado', v)} titulo="Enviar pagamentos bloqueados">
            {santander
              ? 'Cada pagamento chega ao banco como "pendente de autorização" e só sai depois de autorizado no Internet Banking. Recomendado.'
              : 'No Itaú a autorização é feita no próprio Itaú 30 horas, conforme o perfil de aprovação do contrato.'}
          </Opcao>
          {santander && (
            <>
              <Opcao checked={f.opcoes.sequencial_teste} onChange={v => setOp('sequencial_teste', v)} titulo="Convênio tem &quot;sequencial de teste&quot;">
                Com esta opção contratada, os arquivos de número 1 a 10 são só teste (o banco critica, mas não paga). Em produção, a numeração começa em 11.
              </Opcao>
              <Opcao checked={f.opcoes.seu_numero_obrigatorio} onChange={v => setOp('seu_numero_obrigatorio', v)} titulo="Convênio tem &quot;seu número obrigatório&quot;">
                O banco recusa um pagamento com o mesmo código, CPF/CNPJ, data e valor de outro já agendado. O sistema já gera um código único por pagamento.
              </Opcao>
              <Campo rotulo="Controle de sequência dos arquivos" dica="Como o banco confere o número de cada arquivo enviado">
                <select value={f.opcoes.sequencia} onChange={e => setOp('sequencia', e.target.value as OpcoesConvenio['sequencia'])} className={inputCls}>
                  <option value="nenhuma">Sem controle</option>
                  <option value="restrita">Restrito — sempre o número seguinte ao último enviado</option>
                  <option value="diferente">Diferente — qualquer número que ainda não foi usado</option>
                </select>
              </Campo>
            </>
          )}
          {item && (
            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={f.ativa} onChange={e => set('ativa', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
              Conta ativa
            </label>
          )}
        </fieldset>
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando}>Salvar</Button>
        </div>
      </form>
    </Modal>
  )
}

export function SecaoContasPagadoras({ token }: { token: string }) {
  const [items, setItems] = useState<ContaPagadora[]>([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState<ContaPagadora | null | 'nova'>(null)
  const [excluir, setExcluir] = useState<ContaPagadora | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<ContaPagadora[]>('/pagamentos/contas', token).then(setItems).catch(() => {}).finally(() => setLoading(false))
  }, [token])
  useEffect(() => { carregar() }, [carregar])

  async function confirmarExclusao(c: ContaPagadora) {
    setExcluindo(true)
    try {
      await api.delete(`/pagamentos/contas/${c.id}`, token)
      toast.sucesso('Conta excluída.'); setExcluir(null); carregar()
    } catch (e) { toast.erro(e instanceof Error ? e.message : 'Erro ao excluir.') }
    finally { setExcluindo(false) }
  }

  return (
    <div className="space-y-4">
      {editando && <ModalConta token={token} item={editando === 'nova' ? null : editando} onClose={() => setEditando(null)} onSaved={carregar} />}
      <ConfirmDialog open={!!excluir} titulo="Excluir conta pagadora?" mensagem={<>{excluir?.descricao} será excluída.</>}
        loading={excluindo} onCancelar={() => setExcluir(null)} onConfirmar={() => excluir && confirmarExclusao(excluir)} />
      <div className="flex justify-end">
        <Button type="button" onClick={() => setEditando('nova')}>+ Nova conta pagadora</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {loading ? <div className="py-10 text-center text-sm text-gray-400">Carregando…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">Ambiente</th>
                <th className="px-4 py-3">Próximo NSA</th>
                <th className="px-4 py-3">Opções</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id} className={`border-t border-gray-50 hover:bg-gray-50 ${c.ativa ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{c.descricao}</td>
                  <td className="px-4 py-2.5">
                    {c.ambiente === 'producao'
                      ? <Chip label="Produção" cor="bg-green-50 text-green-700" />
                      : <Chip label="Homologação" cor="bg-amber-50 text-amber-700" />}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{c.proximo_nsa}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {[c.opcoes.enviar_bloqueado && 'envia bloqueado', c.opcoes.sequencial_teste && 'sequencial de teste',
                      c.opcoes.seu_numero_obrigatorio && 'seu número obrigatório'].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex gap-3">
                      <button onClick={() => setEditando(c)} className="text-xs text-blue-500 hover:underline">Editar</button>
                      <BtnExcluir onClick={() => setExcluir(c)} />
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-gray-400">Nenhuma conta pagadora cadastrada</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
