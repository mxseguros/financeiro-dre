import { useState } from 'react'
import { api } from '@/lib/api'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Campo, inputCls, type OrdemCompra } from './shared'

interface ModalOrdemCompraProps {
  token: string
  ordem?: OrdemCompra
  onClose: () => void
  onSaved: () => void
}

function hojeISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ModalOrdemCompra({ token, ordem, onClose, onSaved }: ModalOrdemCompraProps) {
  const editando = !!ordem
  const [form, setForm] = useState({
    solicitante: ordem?.solicitante ?? '',
    assunto:     ordem?.assunto ?? '',
    descricao:   ordem?.descricao ?? '',
    valor:       ordem?.valor != null ? String(ordem.valor) : '',
  })
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [duplicata, setDuplicata] = useState<{ quantidade: number } | null>(null)

  const set = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }))
    setErros(e => (k in e ? { ...e, [k]: '' } : e))
  }

  // Detecção de duplicata: mesmo assunto (+ valor) nos últimos 45 dias
  async function checarDuplicata() {
    const assunto = form.assunto.trim()
    if (editando || assunto.length < 3) return
    try {
      const v = parseFloat(form.valor)
      const r = await api.post<{ duplicata: { quantidade: number } | null }>(
        '/ordens-compra/checar-duplicata', token,
        { assunto, valor: Number.isFinite(v) && v > 0 ? v : undefined },
      )
      setDuplicata(r.duplicata)
    } catch {
      setDuplicata(null)
    }
  }

  /** Validação por campo — a mensagem aparece ao lado do campo, não em faixa única. */
  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.solicitante.trim()) e.solicitante = 'Informe o solicitante.'
    if (!form.assunto.trim()) e.assunto = 'Informe o assunto.'
    if (!form.descricao.trim()) e.descricao = 'Descreva o que está sendo solicitado.'
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (!validar()) return
    setSalvando(true)
    setErro(null)

    const payload: Record<string, unknown> = {
      solicitante: form.solicitante,
      assunto:     form.assunto,
      descricao:   form.descricao,
      valor:       form.valor ? parseFloat(form.valor) : null,
    }

    try {
      if (editando) {
        await api.patch(`/ordens-compra/${ordem!.id}`, token, payload)
      } else {
        // A ordem sempre nasce pendente; aprovação/rejeição é feita no Kanban de Aprovações
        await api.post<OrdemCompra>('/ordens-compra', token, payload)
      }
      onSaved()
      onClose()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
      setSalvando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={editando ? 'Editar Ordem de Compra' : 'Nova Ordem de Compra'}
      variant="sheet"
      maxWidth="sm:max-w-xl"
      dismissable={!salvando}
    >
      <form onSubmit={salvar} noValidate className="space-y-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <Field label="Solicitante" required error={erros.solicitante}>
            {p => (
              <Input {...p} size="sm" value={form.solicitante}
                onChange={e => set('solicitante', e.target.value)} placeholder="Ex: João Silva" />
            )}
          </Field>
          <Field label="Assunto" required error={erros.assunto}>
            {p => (
              <Input {...p} size="sm" value={form.assunto} onChange={e => set('assunto', e.target.value)}
                onBlur={checarDuplicata} placeholder="Ex: Compra de notebooks" />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <Campo label="Data Solicitação">
            <input type="date" value={ordem?.data_solicitacao ?? hojeISO()} disabled
              className={`${inputCls} bg-gray-50 text-gray-500`} />
          </Campo>
          <Campo label="Valor (opcional)">
            <InputMoeda value={form.valor} onChange={v => set('valor', v)} />
          </Campo>
        </div>

        {duplicata && duplicata.quantidade > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            ⚠️ Possível duplicata: já existe {duplicata.quantidade} ordem(ns) com o mesmo assunto{form.valor ? ' e valor' : ''} nos últimos 45 dias.
          </div>
        )}

        <Field label="Descrição" required error={erros.descricao}>
          {p => (
            <Textarea {...p} size="sm" rows={3} value={form.descricao}
              onChange={e => set('descricao', e.target.value)}
              placeholder="Detalhe o que está sendo solicitado" className="resize-y" />
          )}
        </Field>

        {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="submit" loading={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
