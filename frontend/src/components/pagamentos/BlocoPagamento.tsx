// Bloco "Pagamento" do lançamento de despesa (0050): favorecido, forma, valor a
// pagar e o documento (boleto, conta/tributo, Pix copia-e-cola, DARF/GPS).
// É o que a remessa CNAB usa. Fica travado enquanto o pagamento está com o banco.
'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { fmtBRL, fmtData } from '@/lib/utils'
import { InputMoeda } from '@/components/ui/InputMoeda'
import {
  FORMAS, STATUS_PAGAMENTO, TRAVADOS, nomeForma,
  type DocumentoLido, type FormaPagamento, type Fornecedor, type PagamentoDespesa, type StatusPagamento, type Tributo,
} from '@/lib/pagamentos'

const cls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-navy focus-ring focus:outline-none'

export interface EstadoPagamento {
  fornecedor_id: string
  forma: FormaPagamento | ''
  valor_pagamento: string
  linha: string
  cedente_doc: string
  cedente_nome: string
  pix_copia_cola: string
  tributo: Tributo
  alterado: boolean
}

export const estadoPagamentoVazio = (): EstadoPagamento => ({
  fornecedor_id: '', forma: '', valor_pagamento: '', linha: '', cedente_doc: '', cedente_nome: '',
  pix_copia_cola: '', tributo: { tipo: 'darf', codigo_receita: '' }, alterado: false,
})

export const pagamentoPreenchido = (e: EstadoPagamento) => !!(e.forma || e.fornecedor_id)

/** Grava o bloco na despesa. Chame depois de salvar a despesa. */
export async function salvarPagamento(token: string, despesaId: string, e: EstadoPagamento): Promise<string[]> {
  const t = (s: string) => s.trim() || null
  const r = await api.put<PagamentoDespesa>(`/pagamentos/despesas/${despesaId}`, token, {
    fornecedor_id: t(e.fornecedor_id), forma_pagamento: e.forma || null, valor_pagamento: t(e.valor_pagamento),
    linha_digitavel: t(e.linha), cedente_cpf_cnpj: t(e.cedente_doc), cedente_nome: t(e.cedente_nome),
    pix_copia_cola: t(e.pix_copia_cola), tributo: e.forma === 'tributo' ? e.tributo : null,
  })
  return r?.avisos ?? []
}

function Campo({ rotulo, dica, children, className = '' }: { rotulo: string; dica?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs font-medium text-gray-600">{rotulo}</span>
      {children}
      {dica && <span className="mt-0.5 block text-[11px] text-gray-400">{dica}</span>}
    </label>
  )
}

export function BlocoPagamento({ token, despesaId, valorDespesa, valor, onChange }: {
  token: string
  despesaId?: string
  valorDespesa: number
  valor: EstadoPagamento
  onChange: (e: EstadoPagamento) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [habilitado, setHabilitado] = useState(true)
  const [status, setStatus] = useState<StatusPagamento | null>(null)
  const [favorecidos, setFavorecidos] = useState<Fornecedor[]>([])
  const [doc, setDoc] = useState<DocumentoLido | null>(null)
  const [erroDoc, setErroDoc] = useState<string | null>(null)
  const carregou = useRef(false)

  const set = (patch: Partial<EstadoPagamento>) => onChange({ ...valor, ...patch, alterado: true })

  useEffect(() => {
    api.get<Fornecedor[]>('/pagamentos/fornecedores', token).then(setFavorecidos).catch(() => setFavorecidos([]))
  }, [token])

  useEffect(() => {
    if (!despesaId || carregou.current) return
    carregou.current = true
    api.get<PagamentoDespesa>(`/pagamentos/despesas/${despesaId}`, token).then(p => {
      if (!p.habilitado) { setHabilitado(false); return }
      setStatus(p.status_pagamento ?? null)
      const preenchido = !!(p.forma_pagamento || p.fornecedor_id)
      if (preenchido) setAberto(true)
      onChange({
        fornecedor_id: p.fornecedor_id ?? '', forma: p.forma_pagamento ?? '',
        valor_pagamento: p.valor_pagamento ?? '', linha: p.linha_digitavel ?? p.codigo_barras ?? '',
        cedente_doc: p.cedente_cpf_cnpj ?? '', cedente_nome: p.cedente_nome ?? '',
        pix_copia_cola: p.pix_copia_cola ?? '', tributo: p.tributo ?? { tipo: 'darf', codigo_receita: '' }, alterado: false,
      })
    }).catch(() => setHabilitado(false))
  }, [despesaId, token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lê a linha digitável / copia-e-cola meio segundo depois de colar.
  const texto = valor.forma === 'pix_qr' ? valor.pix_copia_cola : valor.linha
  useEffect(() => {
    setDoc(null); setErroDoc(null)
    if (!['boleto', 'concessionaria', 'pix_qr'].includes(valor.forma)) return
    if (valor.forma === 'pix_qr' ? texto.length < 50 : texto.replace(/\D/g, '').length < 44) return
    const t = setTimeout(() => {
      api.post<DocumentoLido>('/pagamentos/documento', token, { texto })
        .then(setDoc).catch(e => setErroDoc(e instanceof Error ? e.message : 'Documento inválido.'))
    }, 500)
    return () => clearTimeout(t)
  }, [texto, valor.forma, token])

  const favorecido = useMemo(() => favorecidos.find(f => f.id === valor.fornecedor_id) ?? null, [favorecidos, valor.fornecedor_id])
  const fornecedores = favorecidos.filter(f => !f.funcionario_id)
  const funcionarios = favorecidos.filter(f => f.funcionario_id)

  if (!habilitado) return null
  const travado = !!status && TRAVADOS.includes(status)
  const valorPagar = parseFloat(valor.valor_pagamento) || valorDespesa
  const valorDoc = doc?.valor ? parseFloat(doc.valor) : null
  const divergente = valorDoc !== null && Math.abs(valorDoc - valorPagar) >= 0.01

  function escolherFavorecido(id: string) {
    const f = favorecidos.find(x => x.id === id)
    set({ fornecedor_id: id, forma: valor.forma || f?.forma_pagamento_padrao || '' })
  }

  const resumo = pagamentoPreenchido(valor)
    ? [nomeForma(valor.forma), favorecido?.nome].filter(Boolean).join(' · ')
    : 'Não informado'

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50">
      <button type="button" onClick={() => setAberto(a => !a)} aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-sm font-medium text-gray-700">
          Pagamento <span className="font-normal text-gray-400">· {resumo}</span>
        </span>
        <span className="flex items-center gap-2">
          {status && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PAGAMENTO[status].cor}`}>
              {STATUS_PAGAMENTO[status].nome}
            </span>
          )}
          <span className="text-xs text-gray-400">{aberto ? '▲' : '▼'}</span>
        </span>
      </button>

      {aberto && (
        <fieldset disabled={travado} className="space-y-2.5 border-t border-gray-100 px-3 pb-3 pt-2.5">
          {travado && (
            <p className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
              O pagamento já está com o banco ou pago: estes dados não podem mudar agora.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Campo rotulo="Forma">
              <select value={valor.forma} onChange={e => set({ forma: e.target.value as FormaPagamento | '' })} className={cls}>
                <option value="">Não pagar por arquivo</option>
                {FORMAS.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Valor a pagar" dica={valor.valor_pagamento ? undefined : `Vazio = valor da despesa (${fmtBRL(valorDespesa)})`}>
              <InputMoeda value={valor.valor_pagamento} onChange={v => set({ valor_pagamento: v })} />
            </Campo>
          </div>
          {valor.forma && <p className="-mt-1 text-[11px] text-gray-400">{FORMAS.find(f => f.id === valor.forma)?.dica}</p>}

          {(['pix', 'ted', 'credito_conta', 'boleto', ''] as string[]).includes(valor.forma) && (
            <Campo rotulo={valor.forma === 'boleto' ? 'Beneficiário (opcional)' : 'Favorecido'}
              dica={favorecido
                ? [favorecido.documento_mascarado, favorecido.pix_mascarada && `Pix ${favorecido.pix_mascarada}`, favorecido.conta_mascarada].filter(Boolean).join(' · ')
                : 'Cadastre em Configurações → Fornecedores (funcionários: no contrato).'}>
              <select value={valor.fornecedor_id} onChange={e => escolherFavorecido(e.target.value)} className={cls}>
                <option value="">Selecionar</option>
                {fornecedores.length > 0 && (
                  <optgroup label="Fornecedores">
                    {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </optgroup>
                )}
                {funcionarios.length > 0 && (
                  <optgroup label="Funcionários">
                    {funcionarios.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </optgroup>
                )}
              </select>
            </Campo>
          )}

          {(valor.forma === 'boleto' || valor.forma === 'concessionaria') && (
            <Campo rotulo="Linha digitável ou código de barras">
              <input value={valor.linha} onChange={e => set({ linha: e.target.value })} inputMode="numeric"
                placeholder={valor.forma === 'boleto' ? '47 números' : '48 números (começa com 8)'} className={`${cls} font-mono text-xs`} />
            </Campo>
          )}
          {valor.forma === 'boleto' && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[200px_1fr]">
              <Campo rotulo="CPF/CNPJ do beneficiário" dica={favorecido ? 'Vazio = o do favorecido' : 'Obrigatório para o banco'}>
                <input value={valor.cedente_doc} onChange={e => set({ cedente_doc: e.target.value })} className={cls} />
              </Campo>
              <Campo rotulo="Nome do beneficiário">
                <input value={valor.cedente_nome} onChange={e => set({ cedente_nome: e.target.value })} className={cls} />
              </Campo>
            </div>
          )}
          {valor.forma === 'pix_qr' && (
            <Campo rotulo="Pix copia-e-cola" dica="Para a guia do FGTS Digital, use o Pix copia-e-cola da guia.">
              <textarea value={valor.pix_copia_cola} onChange={e => set({ pix_copia_cola: e.target.value.trim() })} rows={3}
                placeholder="00020101…" className={`${cls} font-mono text-xs`} />
            </Campo>
          )}
          {doc && (
            <p className={`rounded-lg px-3 py-1.5 text-xs ${divergente ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
              {doc.tipo === 'pix_qr' ? `Pix ${doc.dinamico ? 'QR dinâmico' : 'QR estático'}${doc.recebedor ? ` para ${doc.recebedor}` : ''}`
                : doc.tipo === 'boleto' ? 'Boleto' : 'Conta/tributo'}
              {doc.valor ? ` de ${fmtBRL(doc.valor)}` : ''}{doc.vencimento ? `, vence ${fmtData(doc.vencimento)}` : ''}.
              {divergente && (
                <> Diferente do valor a pagar ({fmtBRL(valorPagar)}).{' '}
                  <button type="button" onClick={() => set({ valor_pagamento: Number(doc.valor).toFixed(2) })}
                    className="font-medium underline">Usar {fmtBRL(doc.valor)}</button>
                </>
              )}
            </p>
          )}
          {erroDoc && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{erroDoc}</p>}

          {valor.forma === 'tributo' && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <Campo rotulo="Guia">
                <select value={valor.tributo.tipo} onChange={e => set({ tributo: { ...valor.tributo, tipo: e.target.value as 'darf' | 'gps' } })} className={cls}>
                  <option value="darf">DARF</option>
                  <option value="gps">GPS</option>
                </select>
              </Campo>
              <Campo rotulo={valor.tributo.tipo === 'gps' ? 'Código de pagamento' : 'Código da receita'}>
                <input value={valor.tributo.codigo_receita} inputMode="numeric"
                  onChange={e => set({ tributo: { ...valor.tributo, codigo_receita: e.target.value.replace(/\D/g, '').slice(0, 6) } })} className={cls} />
              </Campo>
              {valor.tributo.tipo === 'darf' ? (
                <Campo rotulo="Período de apuração">
                  <input type="date" value={valor.tributo.periodo_apuracao ?? ''}
                    onChange={e => set({ tributo: { ...valor.tributo, periodo_apuracao: e.target.value } })} className={cls} />
                </Campo>
              ) : (
                <Campo rotulo="Competência">
                  <input type="month" value={valor.tributo.competencia ?? ''}
                    onChange={e => set({ tributo: { ...valor.tributo, competencia: e.target.value } })} className={cls} />
                </Campo>
              )}
              {valor.tributo.tipo === 'darf' && (
                <Campo rotulo="Número de referência" className="col-span-2 sm:col-span-1">
                  <input value={valor.tributo.numero_referencia ?? ''} inputMode="numeric"
                    onChange={e => set({ tributo: { ...valor.tributo, numero_referencia: e.target.value.replace(/\D/g, '').slice(0, 17) } })} className={cls} />
                </Campo>
              )}
              <Campo rotulo="Multa">
                <InputMoeda value={valor.tributo.valor_multa ?? ''} onChange={v => set({ tributo: { ...valor.tributo, valor_multa: v } })} />
              </Campo>
              <Campo rotulo="Juros / encargos">
                <InputMoeda value={valor.tributo.valor_juros ?? ''} onChange={v => set({ tributo: { ...valor.tributo, valor_juros: v } })} />
              </Campo>
              <Campo rotulo="CNPJ/CPF do contribuinte" dica="Vazio = CNPJ da empresa" className="col-span-2 sm:col-span-3">
                <input value={valor.tributo.contribuinte_doc ?? ''}
                  onChange={e => set({ tributo: { ...valor.tributo, contribuinte_doc: e.target.value } })} className={`${cls} sm:max-w-xs`} />
              </Campo>
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}
