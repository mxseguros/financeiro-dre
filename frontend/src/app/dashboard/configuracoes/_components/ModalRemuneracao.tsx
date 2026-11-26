// Pagamento do funcionário (0052, 26/11/2026) — só Admin.
// Substitui o "Contrato e salário" da Folha CLT: só os valores de cada item
// (salário, 13º, férias, FGTS, benefícios, rescisão) e os dados de pagamento.
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { fmtBRL } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button, Spinner } from '@/components/ui/Button'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { useToast } from '@/components/ui/Toast'
import type { Funcionario } from '@/lib/funcionarios'
import { ITENS_REMUNERACAO, MENSAIS, type ItemRemuneracao, type RemuneracaoResp } from '@/lib/remuneracao'
import { inputCls } from './shared'
import { CamposBancarios, paraFormBancario, paraPayloadBancario, type FormBancario } from '@/components/pagamentos/CamposBancarios'
import type { Fornecedor } from '@/lib/pagamentos'

type Valores = Record<ItemRemuneracao, string>
const vazio = () => Object.fromEntries(ITENS_REMUNERACAO.map(i => [i.id, ''])) as Valores
const n = (v: string) => (parseFloat(v) || 0)

export function ModalRemuneracao({ token, funcionario, onClose, onSaved }: {
  token: string; funcionario: Funcionario; onClose: () => void; onSaved: () => void
}) {
  const [valores, setValores] = useState<Valores | null>(null)
  const [anotacao, setAnotacao] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Dados de pagamento (0050): o funcionário vira favorecido das remessas CNAB.
  const [banc, setBanc] = useState<FormBancario>(paraFormBancario(null))
  const [cpf, setCpf] = useState('')
  const [pagHabilitado, setPagHabilitado] = useState(true)
  const toast = useToast()

  useEffect(() => {
    api.get<RemuneracaoResp>(`/configuracoes/funcionarios/${funcionario.id}/remuneracao`, token)
      .then(r => {
        const v = vazio()
        for (const i of ITENS_REMUNERACAO) v[i.id] = r.valores[i.id] ? String(r.valores[i.id]) : ''
        setValores(v); setAnotacao(r.banco_pagamento)
      })
      .catch(e => setErro(e instanceof Error ? e.message : 'Não foi possível abrir o pagamento.'))
    api.get<Fornecedor | null>(`/pagamentos/funcionarios/${funcionario.id}/favorecido`, token)
      .then(f => {
        if (f) { setBanc(paraFormBancario(f)); setCpf(f.cpf_cnpj ?? '') }
        else setBanc(b => ({ ...b, pix_tipo_chave: 'cpf_cnpj' }))
      })
      .catch(() => setPagHabilitado(false))
  }, [funcionario.id, token])

  const custoMensal = useMemo(() => (valores ? MENSAIS.reduce((s, k) => s + n(valores[k]), 0) : 0), [valores])

  async function salvar() {
    if (!valores) return
    setSalvando(true); setErro(null)
    try {
      const payload = Object.fromEntries(ITENS_REMUNERACAO.map(i => [i.id, n(valores[i.id])]))
      await api.put(`/configuracoes/funcionarios/${funcionario.id}/remuneracao`, token, { valores: payload })
      if (pagHabilitado) {
        const dados = paraPayloadBancario(banc)
        // Chave do tipo CPF sem chave digitada: usa o próprio CPF.
        if (banc.pix_tipo_chave === 'cpf_cnpj' && !banc.pix_chave.trim() && cpf.trim()) {
          dados.pix_tipo_chave = 'cpf_cnpj'; dados.pix_chave = cpf.trim()
        }
        await api.put(`/pagamentos/funcionarios/${funcionario.id}/favorecido`, token, { cpf: cpf.trim() || null, ...dados })
      }
      toast.sucesso(`Pagamento de ${funcionario.nome} salvo.`)
      onSaved(); onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
      setSalvando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Pagamento — ${funcionario.nome}`} variant="sheet"
      maxWidth="sm:max-w-3xl" dismissable={!salvando}>
      {!valores ? (
        erro ? <p className="text-sm text-red-600">{erro}</p> : <div className="flex h-40 items-center justify-center"><Spinner className="text-navy" /></div>
      ) : (
        <fieldset className="space-y-4">
          <legend className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500">Pagamento</legend>

          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            {ITENS_REMUNERACAO.map(i => (
              <label key={i.id} className="block">
                <span className="mb-0.5 block text-[13px] font-medium text-gray-600">{i.nome}</span>
                <InputMoeda value={valores[i.id]} onChange={v => setValores(x => (x ? { ...x, [i.id]: v } : x))} />
              </label>
            ))}
          </div>
          <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            <span>Custo mensal <span className="text-slate-500">(salário + FGTS + benefícios; 13º, férias, abono e rescisão ficam de fora)</span></span>
            <span className="text-sm font-semibold tabular-nums text-navy">{fmtBRL(custoMensal)}</span>
          </p>

          <div className="space-y-2 border-t border-gray-100 pt-3">
            <p className="text-sm font-semibold text-slate-700">Dados para pagamento</p>
            {pagHabilitado ? (
              <>
                <label className="block">
                  <span className="mb-0.5 block text-[13px] font-medium text-gray-600">CPF</span>
                  <input value={cpf} onChange={e => setCpf(e.target.value)} className={`${inputCls} sm:max-w-xs`} autoComplete="off" />
                  <span className="mt-0.5 block text-[13px] text-slate-500">O banco exige o CPF para pagar por Pix ou TED</span>
                </label>
                <CamposBancarios form={banc} onChange={setBanc} />
              </>
            ) : (
              <p className="text-[13px] text-slate-500">Dados bancários indisponíveis no momento.</p>
            )}
            {anotacao && <p className="text-[13px] text-slate-500">Anotação antiga: {anotacao}</p>}
          </div>
        </fieldset>
      )}
      {erro && valores && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
        <Button type="button" onClick={salvar} loading={salvando} disabled={!valores}>Salvar</Button>
      </div>
    </Modal>
  )
}
