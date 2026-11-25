'use client'
// Pagamentos por arquivo CNAB (0050, fase 2): despesas aprovadas a pagar,
// criação da remessa (validação item a item, NSA, arquivo) e lista de remessas.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { api } from '@/lib/api'
import { fmtBRL, fmtData } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button, Spinner } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { permissaoPagamentos } from '@/types'
import { Retornos } from '@/components/pagamentos/Retornos'
import { ModalBaixaManual } from '@/components/pagamentos/ModalBaixaManual'
import {
  NOME_LANCAMENTO, STATUS_PAGAMENTO, STATUS_REMESSA, nomeForma,
  type APagarResp, type ContaPagadora, type ItemAPagar, type Remessa, type ValidacaoRemessa,
} from '@/lib/pagamentos'

type Aba = 'a_pagar' | 'em_andamento' | 'remessas' | 'retornos'
const inputCls = 'rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-navy focus-ring focus:outline-none'

function Cartao({ titulo, valor, cor }: { titulo: string; valor?: string; cor: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={`mt-0.5 text-lg font-semibold ${cor}`}>{fmtBRL(valor ?? 0)}</p>
    </div>
  )
}

function Status({ s }: { s: ItemAPagar['status_pagamento'] }) {
  if (!s) return <span className="text-xs text-gray-400">A pagar</span>
  const info = STATUS_PAGAMENTO[s]
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${info.cor}`}>{info.nome}</span>
}

async function baixar(token: string, remessaId: string, arquivoId: string) {
  const r = await api.get<{ url: string; nome: string }>(`/pagamentos/remessas/${remessaId}/arquivos/${arquivoId}/download`, token)
  const a = document.createElement('a')
  a.href = r.url
  a.download = r.nome
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ── Modal "Criar remessa" ─────────────────────────────────────
function ModalCriarRemessa({ token, ids, onClose, onGerada }: {
  token: string; ids: string[]; onClose: () => void; onGerada: (r: Remessa) => void
}) {
  const [contas, setContas] = useState<ContaPagadora[] | null>(null)
  const [contaId, setContaId] = useState('')
  const [data, setData] = useState('')
  const [selecionados, setSelecionados] = useState(ids)
  const [val, setVal] = useState<ValidacaoRemessa | null>(null)
  const [validando, setValidando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    api.get<ContaPagadora[]>('/pagamentos/contas', token).then(cs => {
      const ativas = cs.filter(c => c.ativa)
      setContas(ativas)
      const padrao = ativas.find(c => c.codigo_banco === '033') ?? ativas[0]
      if (padrao) setContaId(padrao.id)
    }).catch(e => setErro(e instanceof Error ? e.message : 'Não foi possível carregar as contas.'))
    api.get<{ sugestao_hoje: string }>(`/pagamentos/dia-util?data=${new Date().toISOString().slice(0, 10)}`, token)
      .then(r => setData(d => d || r.sugestao_hoje)).catch(() => setData(new Date().toISOString().slice(0, 10)))
  }, [token])

  useEffect(() => {
    if (!contaId || !data || selecionados.length === 0) { setVal(null); return }
    setValidando(true); setErro(null)
    api.post<ValidacaoRemessa>('/pagamentos/remessas/validar', token, { conta_id: contaId, data_pagamento: data, despesa_ids: selecionados })
      .then(setVal).catch(e => { setVal(null); setErro(e instanceof Error ? e.message : 'Erro ao validar.') })
      .finally(() => setValidando(false))
  }, [contaId, data, selecionados, token])

  const comErro = val?.itens.filter(i => !i.ok) ?? []
  const comAviso = val?.itens.filter(i => i.ok && i.avisos?.length) ?? []

  async function gerar() {
    setGerando(true); setErro(null)
    try {
      const r = await api.post<Remessa>('/pagamentos/remessas', token, { conta_id: contaId, data_pagamento: data, despesa_ids: selecionados })
      onGerada(r)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar a remessa.')
      setGerando(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Criar remessa" variant="sheet" maxWidth="sm:max-w-2xl" dismissable={!gerando}>
      {contas === null ? (
        <div className="flex h-32 items-center justify-center"><Spinner className="text-navy" /></div>
      ) : contas.length === 0 ? (
        <p className="text-sm text-gray-600">
          Nenhuma conta pagadora cadastrada. O Admin cadastra em{' '}
          <Link href="/dashboard/configuracoes" className="font-medium text-navy underline">Configurações → Contas pagadoras</Link>.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <label className="block">
              <span className="mb-0.5 block text-xs font-medium text-gray-600">Conta pagadora</span>
              <select value={contaId} onChange={e => setContaId(e.target.value)} className={`${inputCls} w-full`}>
                {contas.map(c => <option key={c.id} value={c.id}>{c.descricao}{c.ambiente === 'homologacao' ? ' (homologação)' : ''}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-xs font-medium text-gray-600">Data do débito</span>
              <input type="date" value={data} onChange={e => setData(e.target.value)} className={`${inputCls} w-full`} />
            </label>
          </div>

          {validando && !val && <div className="flex h-20 items-center justify-center"><Spinner className="text-navy" /></div>}
          {val && (
            <>
              {val.avisos.map(a => <p key={a} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{a}</p>)}
              {val.data_sugerida !== val.data_pagamento && (
                <button type="button" onClick={() => setData(val.data_sugerida)} className="text-xs font-medium text-navy underline">
                  Usar {fmtData(val.data_sugerida)}
                </button>
              )}

              {comErro.length > 0 && (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-red-700">{comErro.length} com pendência — não entram no arquivo</p>
                    <button type="button" className="text-xs font-medium text-red-700 underline"
                      onClick={() => setSelecionados(s => s.filter(id => !comErro.some(e => e.despesa_id === id)))}>
                      Tirar da remessa
                    </button>
                  </div>
                  <ul className="space-y-1 text-xs text-red-700">
                    {comErro.map(i => <li key={i.despesa_id}><strong>{i.descricao}</strong>: {i.erros.join(' ')}</li>)}
                  </ul>
                </div>
              )}
              {comAviso.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                  {comAviso.map(i => <li key={i.despesa_id}><strong>{i.descricao}</strong>: {i.avisos!.join(' ')}</li>)}
                </ul>
              )}

              {val.lotes.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="py-1.5">Lote</th><th className="py-1.5 text-right">Pagamentos</th><th className="py-1.5 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {val.lotes.map(l => (
                      <tr key={`${l.forma_lancamento}/${l.tipo_servico}`} className="border-t border-gray-50">
                        <td className="py-1.5 text-gray-700">
                          {NOME_LANCAMENTO[l.forma_lancamento] ?? l.forma_lancamento}
                          {l.tipo_servico === '98' && <span className="text-xs text-gray-400"> · salários</span>}
                        </td>
                        <td className="py-1.5 text-right text-gray-600">{l.qtd}</td>
                        <td className="py-1.5 text-right font-medium text-gray-800">{fmtBRL(l.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {val.validos > 0 && comErro.length === 0 && (
                <p className="rounded-lg bg-navy/5 px-3 py-2 text-sm text-navy">
                  <strong>{val.validos} {val.validos === 1 ? 'pagamento' : 'pagamentos'} · {fmtBRL(val.valor_total)}</strong>
                  {' '}· débito em {fmtData(val.data_pagamento)} · arquivo nº {val.conta.proximo_nsa}
                </p>
              )}
            </>
          )}
          {selecionados.length === 0 && <p className="text-sm text-gray-500">Nenhum pagamento sobrou na remessa.</p>}
        </div>
      )}
      {erro && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={gerando}>Cancelar</Button>
        <Button type="button" onClick={gerar} loading={gerando}
          disabled={!val || validando || comErro.length > 0 || val.validos === 0}>
          Gerar arquivo
        </Button>
      </div>
    </Modal>
  )
}

// ── Modal de detalhe da remessa ───────────────────────────────
function ModalRemessa({ token, remessaId, podeGerar, onClose, onMudou }: {
  token: string; remessaId: string; podeGerar: boolean; onClose: () => void; onMudou: () => void
}) {
  const [r, setR] = useState<Remessa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const toast = useToast()

  const carregar = useCallback(() => {
    api.get<Remessa>(`/pagamentos/remessas/${remessaId}`, token).then(setR)
      .catch(e => toast.erro(e instanceof Error ? e.message : 'Erro ao abrir a remessa.'))
  }, [remessaId, token]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar() }, [carregar])

  async function acao(caminho: string, msg: string) {
    setOcupado(true)
    try {
      setR(await api.post<Remessa>(`/pagamentos/remessas/${remessaId}/${caminho}`, token, {}))
      toast.sucesso(msg); onMudou()
    } catch (e) { toast.erro(e instanceof Error ? e.message : 'Erro.') }
    finally { setOcupado(false); setConfirmar(false) }
  }

  return (
    <Modal open onClose={onClose} title="Remessa" variant="sheet" maxWidth="sm:max-w-3xl">
      <ConfirmDialog open={confirmar} titulo="Cancelar a remessa?"
        mensagem={<>As despesas voltam para <strong>a pagar</strong>. {r?.status === 'enviada' &&
          'Se o arquivo já foi importado no banco, exclua o agendamento lá também.'}</>}
        loading={ocupado} onCancelar={() => setConfirmar(false)} onConfirmar={() => acao('cancelar', 'Remessa cancelada.')} />
      {!r ? <div className="flex h-32 items-center justify-center"><Spinner className="text-navy" /></div> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_REMESSA[r.status].cor}`}>{STATUS_REMESSA[r.status].nome}</span>
            <span className="text-gray-600">{r.conta}</span>
            <span className="text-gray-400">· débito em {fmtData(r.data_pagamento)}</span>
            {r.ambiente === 'homologacao' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Homologação</span>}
          </div>
          {r.status === 'gerada' && (
            <ol className="list-decimal space-y-0.5 rounded-lg bg-blue-50 py-2 pl-8 pr-3 text-xs text-blue-800">
              <li>Baixe o arquivo abaixo.</li>
              <li>No Internet Banking do banco, importe o arquivo (Pagamento a Fornecedores → Envio de arquivos).</li>
              <li>Autorize os pagamentos no banco e volte aqui para marcar como enviada.</li>
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            {r.arquivos.map(a => (
              <Button key={a.id} type="button" variant="secondary" disabled={!podeGerar}
                onClick={() => baixar(token, r.id, a.id).catch(e => toast.erro(e instanceof Error ? e.message : 'Erro ao baixar.'))}>
                ⬇ {a.nome_arquivo}
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="px-3 py-2">Despesa</th><th className="px-3 py-2">Favorecido</th>
                  <th className="px-3 py-2">Forma</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {(r.itens ?? []).map(i => (
                  <tr key={i.id} className="border-t border-gray-50">
                    <td className="px-3 py-2 text-gray-800">{i.descricao}<span className="block text-[10px] text-gray-400">{i.seu_numero}</span></td>
                    <td className="px-3 py-2 text-gray-600">{i.favorecido ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{nomeForma(i.forma_pagamento)}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-800">{fmtBRL(i.valor)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {i.status === 'cancelado' ? 'Cancelado' : i.status in STATUS_PAGAMENTO
                        ? STATUS_PAGAMENTO[i.status as keyof typeof STATUS_PAGAMENTO].nome : i.status}
                      {i.motivo && <span className="block text-red-600">{i.motivo}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {podeGerar && (
            <div className="flex flex-wrap justify-end gap-2">
              {['gerada', 'enviada'].includes(r.status) && (
                <Button type="button" variant="secondary" onClick={() => setConfirmar(true)} disabled={ocupado}>Cancelar remessa</Button>
              )}
              {r.status === 'gerada' && (
                <Button type="button" onClick={() => acao('enviada', 'Remessa marcada como enviada.')} loading={ocupado}>
                  Marcar como enviada
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ── Página ────────────────────────────────────────────────────
export default function PagamentosPage() {
  const { token } = useAuth()
  const { role, permissions } = useUser()
  const podeGerar = permissaoPagamentos(permissions, role, 'remessa')
  const podeRetorno = permissaoPagamentos(permissions, role, 'retorno')
  const [baixa, setBaixa] = useState<ItemAPagar | null>(null)
  const toast = useToast()
  const [aba, setAba] = useState<Aba>('a_pagar')
  const [dados, setDados] = useState<APagarResp | null>(null)
  const [remessas, setRemessas] = useState<Remessa[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [criando, setCriando] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  const carregar = useCallback(() => {
    if (!token) return
    if (aba === 'retornos') return
    if (aba === 'remessas') {
      api.get<Remessa[]>('/pagamentos/remessas', token).then(setRemessas)
        .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar.'))
    } else {
      setDados(null)
      api.get<APagarResp>(`/pagamentos/a-pagar?situacao=${aba}`, token).then(d => { setDados(d); setErro(null) })
        .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar.'))
    }
  }, [aba, token])
  useEffect(() => { carregar(); setSel(new Set()) }, [carregar])

  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const lista = dados?.itens ?? []
    return t ? lista.filter(i => `${i.descricao} ${i.favorecido?.nome ?? ''}`.toLowerCase().includes(t)) : lista
  }, [dados, busca])
  const prontos = itens.filter(i => i.pendencias.length === 0)
  const totalSel = itens.filter(i => sel.has(i.id)).reduce((s, i) => s + parseFloat(i.valor_pagar), 0)

  function alternar(id: string) {
    setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  if (!token) return null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy md:text-2xl">Pagamentos</h1>
        <p className="mt-0.5 text-sm text-gray-500">Despesas aprovadas pagas por arquivo do banco (CNAB)</p>
      </div>

      {dados?.habilitado && (
        <div data-tour="pag-cartoes" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cartao titulo="A pagar" valor={dados.totais.a_pagar} cor="text-navy" />
          <Cartao titulo="Em remessa / autorizar no banco" valor={dados.totais.em_remessa} cor="text-blue-700" />
          <Cartao titulo="Agendado no banco" valor={dados.totais.agendado} cor="text-indigo-700" />
          <Cartao titulo="Rejeitado / devolvido" valor={dados.totais.rejeitado} cor="text-red-600" />
        </div>
      )}

      <div data-tour="pag-abas">
      <Tabs<Aba> items={[{ key: 'a_pagar', label: 'A pagar' }, { key: 'em_andamento', label: 'Em andamento' },
        { key: 'remessas', label: 'Remessas' }, { key: 'retornos', label: 'Retornos' }]} ativa={aba} onChange={setAba} idPrefix="pag" />
      </div>

      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{erro}</p>}

      {aba === 'retornos' && (
        <Retornos token={token} podeImportar={podeRetorno} onImportado={() => {}} />
      )}

      {(aba === 'a_pagar' || aba === 'em_andamento') && (
        !dados ? <div className="flex h-40 items-center justify-center"><Spinner className="text-navy" /></div>
        : !dados.habilitado ? <p className="text-sm text-gray-500">Pagamentos ainda não habilitados (migration 0050).</p>
        : (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar despesa ou favorecido"
                className={`${inputCls} sm:w-72`} />
              <div className="flex-1" />
              {aba === 'a_pagar' && podeGerar && (
                <Button type="button" data-tour="pag-criar" disabled={sel.size === 0} onClick={() => setCriando(true)}>
                  Criar remessa{sel.size > 0 ? ` (${sel.size} · ${fmtBRL(totalSel)})` : ''}
                </Button>
              )}
            </div>
            {dados.ocultos > 0 && (
              <p className="text-xs text-gray-400">{dados.ocultos} pagamento(s) de salário — visíveis só para o Admin.</p>
            )}
            <div data-tour="pag-tabela" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                    {aba === 'a_pagar' && podeGerar && (
                      <th className="w-10 px-3 py-3">
                        <input type="checkbox" aria-label="Selecionar todos os prontos"
                          checked={prontos.length > 0 && prontos.every(i => sel.has(i.id))}
                          onChange={e => setSel(e.target.checked ? new Set(prontos.map(i => i.id)) : new Set())}
                          className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
                      </th>
                    )}
                    <th className="px-3 py-3">Vencimento</th>
                    <th className="px-3 py-3">Despesa</th>
                    <th className="px-3 py-3">Favorecido</th>
                    <th className="px-3 py-3">Forma</th>
                    <th className="px-3 py-3 text-right">Valor a pagar</th>
                    <th className="px-3 py-3">Situação</th>
                    {podeRetorno && <th className="px-3 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {itens.map(i => {
                    const pronto = i.pendencias.length === 0
                    return (
                      <tr key={i.id} className={`border-t border-gray-50 hover:bg-gray-50 ${sel.has(i.id) ? 'bg-navy/5' : ''}`}>
                        {aba === 'a_pagar' && podeGerar && (
                          <td className="px-3 py-2.5">
                            <input type="checkbox" disabled={!pronto} checked={sel.has(i.id)} onChange={() => alternar(i.id)}
                              aria-label={`Selecionar ${i.descricao}`} title={pronto ? undefined : i.pendencias.join(' ')}
                              className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy disabled:opacity-30" />
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-gray-600">{fmtData(i.vencimento_documento ?? i.data_vencimento)}</td>
                        <td className="px-3 py-2.5 text-gray-800">
                          {i.descricao}
                          {i.motivo && <span className="block text-[11px] text-red-600">Banco: {i.motivo}</span>}
                          {!pronto && aba === 'a_pagar' && (
                            <span className="block text-[11px] text-amber-700">{i.pendencias[0]}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{i.favorecido?.nome ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{nomeForma(i.forma_pagamento)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-gray-800">{fmtBRL(i.valor_pagar)}</td>
                        <td className="px-3 py-2.5"><Status s={i.status_pagamento} /></td>
                        {podeRetorno && (
                          <td className="px-3 py-2.5 text-right">
                            {(!i.status_pagamento || ['rejeitada', 'devolvida', 'agendada'].includes(i.status_pagamento)) && (
                              <button type="button" onClick={() => setBaixa(i)}
                                className="whitespace-nowrap text-xs text-blue-600 hover:underline">Baixa manual</button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                  {itens.length === 0 && (
                    <tr><td colSpan={8} className="py-10 text-center text-sm text-gray-400">
                      {aba === 'a_pagar' ? 'Nenhuma despesa aprovada a pagar.' : 'Nenhum pagamento em andamento.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {aba === 'a_pagar' && (
              <p className="text-xs text-gray-400">
                Para corrigir uma pendência, abra a despesa em <Link href="/dashboard/lancamentos" className="underline">Lançamentos</Link> e
                preencha o bloco Pagamento.
              </p>
            )}
          </div>
        )
      )}

      {aba === 'remessas' && (
        !remessas ? <div className="flex h-40 items-center justify-center"><Spinner className="text-navy" /></div> : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th className="px-3 py-3">Criada em</th><th className="px-3 py-3">Conta</th><th className="px-3 py-3">Débito</th>
                  <th className="px-3 py-3">Arquivo</th><th className="px-3 py-3 text-right">Pagamentos</th>
                  <th className="px-3 py-3 text-right">Valor</th><th className="px-3 py-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {remessas.map(r => (
                  <tr key={r.id} onClick={() => setAberta(r.id)} className="cursor-pointer border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-600">{fmtData(r.criado_em)}</td>
                    <td className="px-3 py-2.5 text-gray-700">{r.conta ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtData(r.data_pagamento)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{r.arquivos.map(a => `nº ${a.nsa}`).join(', ')}</td>
                    <td className="px-3 py-2.5 text-right text-gray-600">{r.qtd_itens}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-gray-800">{fmtBRL(r.valor_total)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_REMESSA[r.status].cor}`}>
                        {STATUS_REMESSA[r.status].nome}
                      </span>
                      {r.ambiente === 'homologacao' && <span className="ml-1 text-[10px] text-amber-600">homologação</span>}
                    </td>
                  </tr>
                ))}
                {remessas.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-sm text-gray-400">Nenhuma remessa gerada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {criando && (
        <ModalCriarRemessa token={token} ids={[...sel]} onClose={() => setCriando(false)}
          onGerada={r => {
            setCriando(false); setSel(new Set()); carregar(); setAberta(r.id)
            toast.sucesso('Remessa gerada. Baixe o arquivo e importe no banco.')
          }} />
      )}
      {baixa && (
        <ModalBaixaManual token={token} item={baixa} onClose={() => setBaixa(null)}
          onFeito={() => { toast.sucesso('Pagamento baixado.'); carregar() }} />
      )}
      {aberta && (
        <ModalRemessa token={token} remessaId={aberta} podeGerar={podeGerar} onClose={() => setAberta(null)} onMudou={carregar} />
      )}
    </div>
  )
}
