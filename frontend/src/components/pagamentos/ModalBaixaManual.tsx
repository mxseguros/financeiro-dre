// Baixa manual (CNAB, fase 5): pagamento feito fora do arquivo. Marca a
// despesa como paga na data informada; o comprovante fica como anexo.
'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { fmtBRL } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { CampoAnexos } from '@/components/anexos/CampoAnexos'
import type { ItemAPagar } from '@/lib/pagamentos'

export function ModalBaixaManual({ token, item, onClose, onFeito }: {
  token: string; item: ItemAPagar; onClose: () => void; onFeito: () => void
}) {
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    setSalvando(true); setErro(null)
    try {
      await api.post(`/pagamentos/despesas/${item.id}/baixa`, token, { data_pagamento: data })
      onFeito(); onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao dar baixa.')
      setSalvando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Baixa manual do pagamento" maxWidth="sm:max-w-lg" dismissable={!salvando}>
      <div className="space-y-3">
        <p className="text-sm text-gray-700"><strong>{item.descricao}</strong> · {fmtBRL(item.valor_pagar)}</p>
        <p className="text-xs text-gray-500">Use quando o pagamento foi feito fora do arquivo (no Internet Banking, por exemplo).</p>
        <label className="block max-w-[200px]">
          <span className="mb-0.5 block text-xs font-medium text-gray-600">Data do pagamento</span>
          <input type="date" value={data} max={new Date().toISOString().slice(0, 10)} onChange={e => setData(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-navy focus-ring focus:outline-none" />
        </label>
        <CampoAnexos token={token} entidade="despesa" entidadeId={item.id} tipoPadrao="comprovante" rotulo="Comprovante de pagamento" />
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={salvar} loading={salvando}>Marcar como pago</Button>
        </div>
      </div>
    </Modal>
  )
}
