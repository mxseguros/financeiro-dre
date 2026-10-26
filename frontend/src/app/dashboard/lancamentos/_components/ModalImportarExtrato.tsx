'use client'
import { useMemo, useRef, useState } from 'react'
import { api, API_BASE } from '@/lib/api'
import { fmtBRL, fmtData } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Campo, selectCls, type Banco, type Categoria, type CentroCusto, type TipoLancamento } from './shared'

interface PreviewItem {
  id: number
  data: string
  descricao: string
  valor: number
  tipo: 'despesa' | 'receita'
  documento: string
  duplicata: boolean
}
interface PreviewResp {
  banco: string
  banco_confirmado: boolean
  formato: string
  conta: string
  avisos: string[]
  resumo: { total: number; despesas: number; receitas: number; duplicatas: number; ignorados: number }
  itens: PreviewItem[]
}
type ItemLocal = PreviewItem & { incluir: boolean }

interface Props {
  token: string
  bancos: Banco[]
  centros: CentroCusto[]
  tipos: TipoLancamento[]
  categorias: Categoria[]
  onClose: () => void
  onImported: () => void
}

export function ModalImportarExtrato({ token, bancos, centros, tipos, categorias, onClose, onImported }: Props) {
  const [etapa, setEtapa] = useState<'upload' | 'revisao' | 'resultado'>('upload')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [itens, setItens] = useState<ItemLocal[]>([])
  const [bancoId, setBancoId] = useState('')
  const [centro, setCentro] = useState('matriz')
  const [confirmandoDup, setConfirmandoDup] = useState(false)
  const [resultado, setResultado] = useState<{ total_importado: number; despesas: number; receitas: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Categoria e Subitem das RECEITAS, no topo (pedido de 22/10/2026). Opcionais;
  // o Subitem escolhido vai em todas as receitas importadas. A categoria de uma
  // receita é a do subitem — não há coluna própria em receitas_outras.
  const [categoriaId, setCategoriaId] = useState('')
  const [subitemId, setSubitemId] = useState('')
  const categoriasReceita = categorias.filter(c => c.natureza === 'receita' && c.ativo)
  const subitensDaCategoria = tipos.filter(t => t.natureza === 'receita' && t.categoria_id === categoriaId)

  async function enviarArquivo(file: File) {
    setCarregando(true); setErro(null)
    try {
      const fd = new FormData()
      fd.append('arquivo', file)
      const res = await fetch(`${API_BASE}/importacao/extrato`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail ?? `Falha ao ler o arquivo (HTTP ${res.status}).`)
      }
      const p: PreviewResp = await res.json()
      setPreview(p)
      // Duplicatas começam DESMARCADAS (exigem confirmação); demais marcadas
      setItens(p.itens.map(i => ({ ...i, incluir: !i.duplicata })))
      // Pré-seleciona o banco pelo nome, se casar
      const match = bancos.find(b => b.nome.toLowerCase().includes(p.banco.toLowerCase().slice(0, 5)))
      setBancoId(match?.id ?? '')
      setEtapa('revisao')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.')
    } finally {
      setCarregando(false)
    }
  }

  function alternarIncluir(id: number) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, incluir: !i.incluir } : i))
  }
  function alternarTipo(id: number, tipo: 'despesa' | 'receita') {
    setItens(prev => prev.map(i => i.id === id ? { ...i, tipo } : i))
  }
  function editarDescricao(id: number, descricao: string) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, descricao } : i))
  }
  function editarData(id: number, data: string) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, data } : i))
  }
  function removerItem(id: number) {
    setItens(prev => prev.filter(i => i.id !== id))
  }

  const selecionados = useMemo(() => itens.filter(i => i.incluir), [itens])
  const dupsSelecionadas = useMemo(() => selecionados.filter(i => i.duplicata).length, [selecionados])
  const nDespesas = selecionados.filter(i => i.tipo === 'despesa').length
  const nReceitas = selecionados.filter(i => i.tipo === 'receita').length

  async function importar() {
    if (selecionados.length === 0) return
    if (dupsSelecionadas > 0 && !confirmandoDup) { setConfirmandoDup(true); return }
    setCarregando(true); setErro(null); setConfirmandoDup(false)
    try {
      const r = await api.post<{ total_importado: number; despesas: number; receitas: number }>(
        '/importacao/extrato/confirmar', token,
        {
          banco_id: bancoId || null,
          centro_custo: centro,
          itens: selecionados.map(i => ({
            data: i.data, descricao: i.descricao, valor: i.valor, tipo: i.tipo,
            // Receitas levam o Subitem escolhido no topo; despesas entram sem
            // subitem e são classificadas depois, em Lançamentos.
            tipo_lancamento_id: i.tipo === 'receita' ? (subitemId || null) : null,
          })),
        },
      )
      setResultado(r); setEtapa('resultado'); onImported()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao importar.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    // O corpo gerencia a própria rolagem (áreas fixas de filtro e rodapé),
    // por isso `bodyClassName` substitui o scroll padrão do Modal.
    <Modal
      open
      onClose={onClose}
      title="Importar extrato"
      variant="fullscreen"
      dismissable={!carregando}
      bodyClassName="flex flex-1 flex-col overflow-hidden border-t border-gray-100"
      subtitle={preview && etapa === 'revisao' ? (
        <>
          {preview.banco}{!preview.banco_confirmado && ' (confirme o banco)'} · {preview.resumo.total} lançamentos
          {preview.resumo.ignorados > 0 && ` · ${preview.resumo.ignorados} linha(s) de saldo ignoradas`}
        </>
      ) : undefined}
    >
      {/* ── UPLOAD ── */}
      {etapa === 'upload' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <input ref={inputRef} type="file" accept=".ofx,.csv,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) enviarArquivo(f) }} />
          <button onClick={() => inputRef.current?.click()} disabled={carregando}
            className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center hover:border-navy hover:bg-gray-50 disabled:opacity-50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-10 w-10 text-navy">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span className="text-sm font-semibold text-navy">{carregando ? 'Lendo arquivo…' : 'Selecionar extrato'}</span>
            <span className="text-xs text-gray-500">Itaú (.txt) · Santander (.ofx / .csv) — o banco é identificado automaticamente</span>
          </button>
          {erro && <p className="max-w-sm rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">{erro}</p>}
        </div>
      )}

      {/* ── REVISÃO ── */}
      {etapa === 'revisao' && preview && (
        <>
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-3 sm:px-6">
            {preview.avisos.map((a, i) => (
              <p key={i} className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">{a}</p>
            ))}
            {itens.some(i => i.tipo === 'receita') && (
              <div className="mb-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Campo label="Categoria">
                  <select value={categoriaId} onChange={e => { setCategoriaId(e.target.value); setSubitemId('') }} className={selectCls}>
                    <option value="">Selecionar categoria</option>
                    {categoriasReceita.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </Campo>
                <Campo label="Subitem">
                  <select value={subitemId} onChange={e => setSubitemId(e.target.value)} disabled={!categoriaId} className={selectCls}>
                    <option value="">{categoriaId ? 'Selecionar subitem' : 'Escolha a categoria primeiro'}</option>
                    {subitensDaCategoria.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </Campo>
                <p className="-mt-1 text-[11px] text-gray-400 sm:col-span-2">
                  Opcional. O Subitem escolhido é gravado em todas as receitas importadas.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Campo label="Banco (destino no app) *">
                <select value={bancoId} onChange={e => setBancoId(e.target.value)} className={selectCls}>
                  <option value="">Selecione o banco</option>
                  {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
                </select>
              </Campo>
              <Campo label="Centro de custo">
                <select value={centro} onChange={e => setCentro(e.target.value)} className={selectCls}>
                  {centros.filter(c => c.ativo).map(c => <option key={c.id} value={c.codigo}>{c.nome}</option>)}
                </select>
              </Campo>
            </div>
          </div>

          {/* Lista de itens — cards mobile-first */}
          <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
            {itens.map(it => (
              <div key={it.id} className={`flex items-start gap-3 px-4 py-3 sm:px-6 ${it.incluir ? '' : 'opacity-45'} ${it.duplicata ? 'bg-amber-50/60' : ''}`}>
                <input type="checkbox" checked={it.incluir} onChange={() => alternarIncluir(it.id)}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-navy focus:ring-navy" />
                <div className="min-w-0 flex-1">
                  {/* Descrição editável — vem do extrato, mas o usuário pode limpar
                      siglas do banco antes de importar. */}
                  <input type="text" value={it.descricao} onChange={e => editarDescricao(it.id, e.target.value)}
                    className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-gray-800 hover:border-gray-200 focus:border-navy focus:bg-white focus:outline-none" />
                  <div className="mt-1.5 flex items-center gap-2">
                    <input type="date" value={it.data} onChange={e => editarData(it.id, e.target.value)}
                      className="shrink-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-400 hover:border-gray-200 focus:border-navy focus:bg-white focus:outline-none" />
                    {it.duplicata && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">⚠ dup.</span>
                    )}
                    {/* Seletor + valor + lixeira — na mesma linha */}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <div className="inline-flex overflow-hidden rounded-md border border-gray-200 text-[10px]">
                        <button type="button" onClick={() => alternarTipo(it.id, 'despesa')}
                          className={`px-1.5 py-0.5 font-medium ${it.tipo === 'despesa' ? 'bg-red-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          Despesa
                        </button>
                        <button type="button" onClick={() => alternarTipo(it.id, 'receita')}
                          className={`px-1.5 py-0.5 font-medium ${it.tipo === 'receita' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          Receita
                        </button>
                      </div>
                      <span className={`text-xs font-bold tabular-nums ${it.tipo === 'receita' ? 'text-green-600' : 'text-red-500'}`}>
                        {it.tipo === 'receita' ? '+' : '−'}{fmtBRL(it.valor)}
                      </span>
                      <button type="button" onClick={() => removerItem(it.id)} title="Remover linha (não importar)"
                        aria-label="Remover linha" className="p-0.5 text-gray-300 hover:text-red-500">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Rodapé fixo */}
          <div className="border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
            {erro && <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
            {confirmandoDup ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800">
                  Você está importando <strong>{dupsSelecionadas}</strong> item(ns) marcado(s) como <strong>possível duplicata</strong>. Confirmar mesmo assim?
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={() => setConfirmandoDup(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Revisar</button>
                  <button onClick={importar} disabled={carregando}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                    Importar assim mesmo
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  <strong className="text-navy">{selecionados.length}</strong> selecionado(s) · {nDespesas} desp. · {nReceitas} rec.
                  {dupsSelecionadas > 0 && <span className="text-amber-600"> · {dupsSelecionadas} dup.</span>}
                </p>
                <button onClick={importar} disabled={carregando || selecionados.length === 0 || !bancoId}
                  className="rounded-lg bg-navy px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50">
                  {carregando ? 'Importando…' : `Importar ${selecionados.length}`}
                </button>
              </div>
            )}
            {!bancoId && <p className="mt-1 text-right text-[11px] text-amber-600">Selecione o banco de destino para importar.</p>}
          </div>
        </>
      )}

      {/* ── RESULTADO ── */}
      {etapa === 'resultado' && resultado && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-4xl">✅</p>
          <p className="text-lg font-semibold text-navy">{resultado.total_importado} lançamento(s) importado(s)</p>
          <p className="text-sm text-gray-500">{resultado.despesas} despesa(s) · {resultado.receitas} receita(s)</p>
          <button onClick={onClose} className="mt-2 rounded-lg bg-navy px-6 py-2.5 text-sm font-medium text-white hover:bg-navy-light">
            Concluir
          </button>
        </div>
      )}
    </Modal>
  )
}
