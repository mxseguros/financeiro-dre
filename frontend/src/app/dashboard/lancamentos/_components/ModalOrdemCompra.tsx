import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Campo, inputCls, selectCls, type OrdemCompra } from './shared'
import { OpcoesCentro, type CentroCusto } from '@/lib/centros'
import { CampoAnexos, enviarAnexos, type AnexoPendente } from '@/components/anexos/CampoAnexos'
import type { Funcionario } from '@/lib/funcionarios'
import { linkOC } from '@/lib/recibo'

/** Link do /oc para mandar aos funcionários, com Copiar (24/11/2026). */
function LinkParaFuncionarios() {
  const [copiado, setCopiado] = useState(false)
  const link = linkOC()
  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopiado(true) } catch { setCopiado(false) }
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-navy/15 bg-navy/5 px-3 py-2 text-xs">
      <span className="text-gray-600">Link para os funcionários:</span>
      <a href={link} target="_blank" rel="noreferrer" className="break-all font-medium text-navy underline-offset-2 hover:underline">{link}</a>
      <button type="button" onClick={copiar}
        className="ml-auto whitespace-nowrap rounded-md bg-navy px-2.5 py-1 font-medium text-white hover:bg-navy-light">
        {copiado ? '✓ Copiado' : 'Copiar'}
      </button>
      {copiado && <p role="status" className="w-full text-green-700">Link copiado: {link}</p>}
    </div>
  )
}

interface ModalOrdemCompraProps {
  token: string
  ordem?: OrdemCompra
  centros?: CentroCusto[]
  onClose: () => void
  onSaved: () => void
  /** Editando: mostra Excluir no rodapé (o botão saiu da linha da tabela, redesenho UX). */
  onExcluir?: () => void
}

function hojeISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ModalOrdemCompra({ token, ordem, centros = [], onClose, onSaved, onExcluir }: ModalOrdemCompraProps) {
  const editando = !!ordem
  const [form, setForm] = useState({
    solicitante:   ordem?.solicitante ?? '',
    assunto:       ordem?.assunto ?? '',
    descricao:     ordem?.descricao ?? '',
    valor:         ordem?.valor != null ? String(Number(ordem.valor)) : '',
    data_prevista: ordem?.data_prevista ?? ordem?.data_solicitacao ?? hojeISO(),
    centro_custo:  ordem?.centro_custo ?? '',
    funcionario_id: ordem?.funcionario_id ?? '',
  })
  // Solicitante = funcionário do cadastro (0048). Sem cadastro, texto livre.
  const [funcionarios, setFuncionarios] = useState<Funcionario[] | null>(null)
  useEffect(() => {
    api.get<Funcionario[]>('/configuracoes/funcionarios', token)
      .then(fs => setFuncionarios(fs.filter(f => f.ativo || f.id === ordem?.funcionario_id)))
      .catch(() => setFuncionarios([]))
  }, [token, ordem?.funcionario_id])
  const usaLista = !!funcionarios?.length && (!editando || !!ordem?.funcionario_id || !ordem?.solicitante)

  function escolherFuncionario(id: string) {
    const f = funcionarios?.find(x => x.id === id)
    setForm(prev => ({
      ...prev, funcionario_id: id, solicitante: f?.nome ?? '',
      centro_custo: prev.centro_custo || f?.centro_custo || '',
    }))
    setErros(e => ({ ...e, solicitante: '' }))
  }
  const [anexosPendentes, setAnexosPendentes] = useState<AnexoPendente[]>([])
  const [falhaAnexos, setFalhaAnexos] = useState<string | null>(null)
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
    // Desde a 0047 a ordem aprovada vira despesa: o valor é obrigatório.
    if (!(parseFloat(form.valor) > 0)) e.valor = 'Informe o valor.'
    if (!form.data_prevista) e.data_prevista = 'Informe a data da despesa.'
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
      ...(usaLista && form.funcionario_id ? { funcionario_id: form.funcionario_id } : {}),
      assunto:     form.assunto,
      descricao:   form.descricao,
      valor:       parseFloat(form.valor),
      data_prevista: form.data_prevista,
      centro_custo:  form.centro_custo || null,
    }

    try {
      if (editando) {
        await api.patch(`/ordens-compra/${ordem!.id}`, token, payload)
      } else {
        // A ordem sempre nasce pendente; aprovação/rejeição é feita no Kanban de Aprovações
        const criada = await api.post<OrdemCompra>('/ordens-compra', token, payload)
        if (anexosPendentes.length) {
          const falhas = await enviarAnexos(token, 'ordem_compra', criada.id, anexosPendentes)
          if (falhas.length) {
            onSaved()
            setFalhaAnexos(`A ordem foi salva, mas: ${falhas.join(' ')} Abra a ordem para anexar de novo.`)
            setSalvando(false)
            return
          }
        }
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
      <LinkParaFuncionarios />
      <form onSubmit={salvar} noValidate className="space-y-2.5">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <Field label="Solicitante" required error={erros.solicitante}>
            {p => usaLista ? (
              <Select {...p} size="sm" value={form.funcionario_id} onChange={e => escolherFuncionario(e.target.value)}>
                <option value="">Selecionar funcionário</option>
                {funcionarios!.map(f => <option key={f.id} value={f.id}>{f.nome}{f.ativo ? '' : ' (inativo)'}</option>)}
              </Select>
            ) : (
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
          <Field label="Data da despesa" required error={erros.data_prevista}>
            {p => (
              <Input {...p} size="sm" type="date" value={form.data_prevista}
                onChange={e => set('data_prevista', e.target.value)} />
            )}
          </Field>
          <Field label="Valor" required error={erros.valor}>
            {() => <InputMoeda value={form.valor} onChange={v => set('valor', v)} />}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          <Campo label="Centro de custo">
            <select value={form.centro_custo} onChange={e => set('centro_custo', e.target.value)} className={selectCls}>
              <option value="">Definir na aprovação</option>
              <OpcoesCentro centros={centros} atual={form.centro_custo} />
            </select>
          </Campo>
          <Campo label="Solicitada em">
            <input type="date" value={ordem?.data_solicitacao ?? hojeISO()} disabled
              className={`${inputCls} bg-gray-50 text-gray-500`} />
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

        <CampoAnexos token={token} entidade="ordem_compra" entidadeId={ordem?.id}
          pendentes={anexosPendentes} onPendentes={setAnexosPendentes} rotulo="Nota fiscal / comprovante"
          somenteLeitura={!!ordem?.despesa_id} />

        {/* Erro de submissão (servidor). Erros de preenchimento ficam nos campos. */}
        {erro && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
        {falhaAnexos && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-700">{falhaAnexos}</p>}

        <div className="flex items-center justify-end gap-3 pt-1">
          {onExcluir && !falhaAnexos && (
            <Button type="button" variant="ghost" tone="danger" onClick={onExcluir} disabled={salvando}
              className="mr-auto">Excluir</Button>
          )}
          {falhaAnexos ? (
            <Button type="button" onClick={onClose}>Fechar</Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
              <Button type="submit" loading={salvando}>
                {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar'}
              </Button>
            </>
          )}
        </div>
      </form>
    </Modal>
  )
}
