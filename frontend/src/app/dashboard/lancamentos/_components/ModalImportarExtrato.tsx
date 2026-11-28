'use client'
import { OpcoesCentro, nomeCentro } from '@/lib/centros'
import { useMemo, useRef, useState } from 'react'
import { api, API_BASE } from '@/lib/api'
import { cn, fmtBRL, fmtData } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Campo, selectCls, type Banco, type Categoria, type CentroCusto, type TipoLancamento } from './shared'

/**
 * Importar extrato: upload → conferência (De x Para, só se houver duplicidade)
 * → revisão → resultado.
 *
 * 28/11/2026 (Gabriel):
 * - Centro de custo em cada linha, pré-preenchido pelo histórico (mesma
 *   descrição → centro do último lançamento). O do topo é o padrão das linhas
 *   sem centro próprio.
 * - Duplicidade = mesmo valor + mesmo lado + mesmo mês, qualquer descrição,
 *   contra o sistema e dentro do próprio arquivo. Para cada caso o usuário
 *   escolhe: manter o do sistema (padrão), importar e excluir o do sistema, ou
 *   manter os dois.
 */

interface Similar {
  id: string
  tabela: 'despesas' | 'receitas_outras'
  descricao: string
  valor: number
  data: string
  situacao: string
  centro_custo: string | null
  banco: string | null
  pode_excluir: boolean
}
interface PreviewItem {
  id: number
  data: string
  descricao: string
  valor: number
  tipo: 'despesa' | 'receita'
  documento: string
  duplicata: boolean
  similares_sistema: Similar[]
  grupo_arquivo: string | null
  centro_sugerido: string | null
  fonte_centro: 'historico' | null
}
interface PreviewResp {
  banco: string
  banco_confirmado: boolean
  formato: string
  conta: string
  avisos: string[]
  resumo: { total: number; despesas: number; receitas: number; duplicatas: number; grupos_arquivo: number; ignorados: number }
  itens: PreviewItem[]
}

/** O que fazer com uma linha que já existe no sistema. */
type Decisao = 'sistema' | 'substituir' | 'ambos'

type ItemLocal = PreviewItem & {
  incluir: boolean
  /** '' = usa o centro padrão do topo. */
  centro: string
  decisao?: Decisao
  /** Qual lançamento do sistema a linha substitui (decisao = 'substituir'). */
  substituirId?: string
}

interface Resultado { total_importado: number; despesas: number; receitas: number; substituidos?: number; erros?: string[] }

interface Props {
  token: string
  bancos: Banco[]
  centros: CentroCusto[]
  tipos: TipoLancamento[]
  categorias: Categoria[]
  onClose: () => void
  onImported: () => void
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesAno = (iso: string) => (iso ? `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}` : '')

function Valor({ tipo, valor, className }: { tipo: 'despesa' | 'receita'; valor: number; className?: string }) {
  return (
    <span className={cn('font-bold tabular-nums', tipo === 'receita' ? 'text-green-700' : 'text-red-600', className)}>
      {tipo === 'receita' ? '+' : '−'}{fmtBRL(valor)}
    </span>
  )
}

const OPCOES_DECISAO: { valor: Decisao; texto: string; ajuda: string }[] = [
  { valor: 'sistema',    texto: 'Manter o do sistema',            ajuda: 'A linha do extrato não é importada.' },
  { valor: 'substituir', texto: 'Importar e excluir o do sistema', ajuda: 'Fica só a linha do extrato.' },
  { valor: 'ambos',      texto: 'Manter os dois',                  ajuda: 'São lançamentos diferentes.' },
]

export function ModalImportarExtrato({ token, bancos, centros, tipos, categorias, onClose, onImported }: Props) {
  const [etapa, setEtapa] = useState<'upload' | 'conferencia' | 'revisao' | 'resultado'>('upload')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [itens, setItens] = useState<ItemLocal[]>([])
  const [bancoId, setBancoId] = useState('')
  const [centroPadrao, setCentroPadrao] = useState('')
  const [resultado, setResultado] = useState<Resultado | null>(null)
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
      // Já no sistema: começa em "Manter o do sistema" (não importa a linha).
      setItens(p.itens.map(i => {
        const noSistema = (i.similares_sistema ?? []).length > 0
        return {
          ...i,
          similares_sistema: i.similares_sistema ?? [],
          incluir: !noSistema,
          centro: i.centro_sugerido ?? '',
          decisao: noSistema ? 'sistema' : undefined,
        }
      }))
      // Pré-seleciona o banco pelo nome, se casar
      const match = bancos.find(b => b.nome.toLowerCase().includes(p.banco.toLowerCase().slice(0, 5)))
      setBancoId(match?.id ?? '')
      const temConflito = p.itens.some(i => (i.similares_sistema ?? []).length > 0 || i.grupo_arquivo)
      setEtapa(temConflito ? 'conferencia' : 'revisao')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enviar o arquivo.')
    } finally {
      setCarregando(false)
    }
  }

  function atualizar(id: number, mudanca: Partial<ItemLocal>) {
    setItens(prev => prev.map(i => i.id === id ? { ...i, ...mudanca } : i))
  }
  function decidir(it: ItemLocal, decisao: Decisao) {
    const excluiveis = it.similares_sistema.filter(s => s.pode_excluir)
    atualizar(it.id, {
      decisao,
      incluir: decisao !== 'sistema',
      substituirId: decisao === 'substituir' ? (it.substituirId ?? excluiveis[0]?.id) : undefined,
    })
  }
  function decidirTodos(decisao: 'sistema' | 'ambos') {
    setItens(prev => prev.map(i => i.similares_sistema.length
      ? { ...i, decisao, incluir: decisao !== 'sistema', substituirId: undefined } : i))
  }
  function removerItem(id: number) {
    setItens(prev => prev.filter(i => i.id !== id))
  }
  function aplicarCentroATodas() {
    if (!centroPadrao) return
    setItens(prev => prev.map(i => ({ ...i, centro: centroPadrao })))
  }

  // ── Conferência ────────────────────────────────────────────
  const conflitosSistema = useMemo(() => itens.filter(i => i.similares_sistema.length > 0), [itens])
  const gruposArquivo = useMemo(() => {
    const g = new Map<string, ItemLocal[]>()
    for (const i of itens) if (i.grupo_arquivo) g.set(i.grupo_arquivo, [...(g.get(i.grupo_arquivo) ?? []), i])
    return [...g.values()].filter(m => m.length > 1)
  }, [itens])
  const nSubstituir = conflitosSistema.filter(i => i.decisao === 'substituir').length
  const nManterSistema = conflitosSistema.filter(i => i.decisao === 'sistema').length

  // ── Revisão ────────────────────────────────────────────────
  const selecionados = useMemo(() => itens.filter(i => i.incluir), [itens])
  const semCentro = selecionados.filter(i => !(i.centro || centroPadrao)).length
  const nDespesas = selecionados.filter(i => i.tipo === 'despesa').length
  const nReceitas = selecionados.filter(i => i.tipo === 'receita').length
  const podeImportar = selecionados.length > 0 && !!bancoId && semCentro === 0 && !carregando

  async function importar() {
    if (!podeImportar) return
    setCarregando(true); setErro(null)
    try {
      const r = await api.post<Resultado>(
        '/importacao/extrato/confirmar', token,
        {
          banco_id: bancoId || null,
          centro_custo: centroPadrao || null,
          itens: selecionados.map(i => {
            const sub = i.decisao === 'substituir' ? i.similares_sistema.find(s => s.id === i.substituirId) : undefined
            return {
              data: i.data, descricao: i.descricao, valor: i.valor, tipo: i.tipo,
              centro_custo: i.centro || centroPadrao,
              // Receitas levam o Subitem escolhido no topo; despesas entram sem
              // subitem e são classificadas depois, em Lançamentos.
              tipo_lancamento_id: i.tipo === 'receita' ? (subitemId || null) : null,
              substituir: sub ? { tabela: sub.tabela, id: sub.id } : null,
            }
          }),
        },
      )
      setResultado(r); setEtapa('resultado'); onImported()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao importar.')
    } finally {
      setCarregando(false)
    }
  }

  const subtitulo = preview && (etapa === 'revisao' || etapa === 'conferencia') ? (
    <>
      {preview.banco}{!preview.banco_confirmado && ' (confirme o banco)'} · {preview.resumo.total} lançamentos
      {preview.resumo.ignorados > 0 && ` · ${preview.resumo.ignorados} linha(s) de saldo ignoradas`}
    </>
  ) : undefined

  return (
    // O corpo gerencia a própria rolagem (áreas fixas de filtro e rodapé),
    // por isso `bodyClassName` substitui o scroll padrão do Modal.
    <Modal
      open
      onClose={onClose}
      title={etapa === 'conferencia' ? 'Importar extrato · Conferência' : 'Importar extrato'}
      variant="fullscreen"
      dismissable={!carregando}
      bodyClassName="flex flex-1 flex-col overflow-hidden border-t border-gray-100"
      subtitle={subtitulo}
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

      {/* ── CONFERÊNCIA (De x Para) ── */}
      {etapa === 'conferencia' && (
        <>
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Encontramos {conflitosSistema.length + gruposArquivo.length} possível(is) duplicidade(s)
                </p>
                <p className="text-[13px] text-amber-800">
                  Mesmo valor, mesmo lado e mesmo mês.
                  {conflitosSistema.length > 0 && <> {conflitosSistema.length} já existe(m) no sistema.</>}
                  {gruposArquivo.length > 0 && <> {gruposArquivo.length} grupo(s) repetido(s) no próprio extrato.</>}
                </p>
              </div>
              {conflitosSistema.length > 1 && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => decidirTodos('sistema')}
                    className="focus-ring h-10 rounded-lg border border-amber-300 bg-white px-3 text-[13px] font-semibold text-amber-900 hover:bg-amber-100">
                    Manter todos os do sistema
                  </button>
                  <button type="button" onClick={() => decidirTodos('ambos')}
                    className="focus-ring h-10 rounded-lg border border-amber-300 bg-white px-3 text-[13px] font-semibold text-amber-900 hover:bg-amber-100">
                    Importar todos
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4 sm:px-6">
            {conflitosSistema.map(it => {
              const excluiveis = it.similares_sistema.filter(s => s.pode_excluir)
              return (
                <section key={it.id} aria-label={`Duplicidade: ${it.descricao}`}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <div className="grid md:grid-cols-[1fr_auto_1fr]">
                    {/* De: extrato */}
                    <div className="p-3 sm:p-4">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">No extrato</p>
                      <p className="text-sm font-medium text-slate-900">{it.descricao}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[13px] text-slate-500">
                        {fmtData(it.data)} · <Valor tipo={it.tipo} valor={it.valor} />
                      </p>
                    </div>
                    <div className="hidden items-center px-1 text-slate-300 md:flex" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </div>
                    {/* Para: sistema */}
                    <div className="border-t border-gray-100 bg-slate-50 p-3 sm:p-4 md:border-l md:border-t-0">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Já no sistema{it.similares_sistema.length > 1 ? ` (${it.similares_sistema.length})` : ''}
                      </p>
                      <ul className="space-y-2">
                        {it.similares_sistema.map(s => {
                          const escolhivel = it.decisao === 'substituir' && s.pode_excluir && it.similares_sistema.length > 1
                          const marcado = it.decisao === 'substituir' && it.substituirId === s.id
                          return (
                            <li key={s.id} className={cn('rounded-lg', marcado && 'bg-red-50 ring-1 ring-red-200', 'px-2 py-1')}>
                              <label className={cn('flex items-start gap-2', escolhivel && 'cursor-pointer')}>
                                {escolhivel && (
                                  <input type="radio" name={`sub-${it.id}`} checked={marcado}
                                    onChange={() => atualizar(it.id, { substituirId: s.id })}
                                    className="mt-1 h-4 w-4 text-red-600" />
                                )}
                                <span className="min-w-0">
                                  <span className={cn('block text-sm font-medium text-slate-900', marcado && 'line-through decoration-red-500')}>
                                    {s.descricao}
                                  </span>
                                  <span className="block text-[13px] text-slate-500">
                                    {fmtData(s.data)} · <Valor tipo={it.tipo} valor={s.valor} /> · {s.situacao}
                                    {s.centro_custo && <> · {nomeCentro(s.centro_custo, centros)}</>}
                                    {s.banco && <> · {s.banco}</>}
                                  </span>
                                </span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </div>
                  {/* Escolha */}
                  <div role="radiogroup" aria-label="O que fazer"
                    className="flex flex-col gap-1.5 border-t border-gray-100 p-2 sm:flex-row">
                    {OPCOES_DECISAO.map(o => {
                      const ativo = it.decisao === o.valor
                      const bloqueado = o.valor === 'substituir' && excluiveis.length === 0
                      return (
                        <button key={o.valor} type="button" role="radio" aria-checked={ativo} disabled={bloqueado}
                          onClick={() => decidir(it, o.valor)}
                          title={bloqueado ? 'Seu perfil não pode excluir este lançamento.' : o.ajuda}
                          className={cn(
                            'focus-ring flex-1 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                            ativo
                              ? o.valor === 'substituir' ? 'border-red-300 bg-red-50 text-red-900' : 'border-navy bg-navy text-white'
                              : 'border-gray-200 bg-white text-slate-700 hover:bg-gray-50',
                          )}>
                          <span className="block font-semibold">{o.texto}</span>
                          <span className={cn('block text-[12px]', ativo && o.valor !== 'substituir' ? 'text-white/80' : 'text-slate-500')}>{o.ajuda}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            {gruposArquivo.map(membros => (
              <section key={membros[0].grupo_arquivo} className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Repetidos no extrato</p>
                <p className="text-sm font-medium text-slate-900">
                  {membros.length} linhas de <Valor tipo={membros[0].tipo} valor={membros[0].valor} /> em {mesAno(membros[0].data)}
                </p>
                <p className="mb-2 text-[13px] text-slate-500">
                  Podem ser lançamentos legítimos (ex.: duas tarifas iguais). Desmarque o que não deve entrar.
                </p>
                <ul className="divide-y divide-gray-100">
                  {membros.map(m => {
                    const decididoAcima = m.similares_sistema.length > 0
                    return (
                      <li key={m.id}>
                        <label className={cn('flex items-center gap-3 py-2', decididoAcima ? 'opacity-60' : 'cursor-pointer')}>
                          <input type="checkbox" checked={m.incluir} disabled={decididoAcima}
                            onChange={() => atualizar(m.id, { incluir: !m.incluir })}
                            className="h-5 w-5 rounded border-gray-300 text-navy focus:ring-navy" />
                          <span className="min-w-0 flex-1 text-sm text-slate-800">{m.descricao}</span>
                          <span className="shrink-0 text-[13px] text-slate-500">
                            {decididoAcima ? 'decidido acima' : fmtData(m.data)}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs text-gray-500">
              {conflitosSistema.length > 0 && (
                <>{nManterSistema} fica(m) só no sistema · {nSubstituir} substitui(em) · {conflitosSistema.length - nManterSistema - nSubstituir} mantém os dois</>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEtapa('upload'); setPreview(null); setItens([]) }}
                className="focus-ring h-11 rounded-lg border border-gray-300 px-4 text-sm font-medium text-slate-700 hover:bg-gray-50">
                Trocar arquivo
              </button>
              <button type="button" onClick={() => setEtapa('revisao')}
                className="focus-ring h-11 rounded-lg bg-navy px-5 text-sm font-medium text-white hover:bg-navy-light">
                Continuar para revisão
              </button>
            </div>
          </div>
        </>
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
              <Campo label="Centro de custo padrão">
                <div className="flex gap-2">
                  <select value={centroPadrao} onChange={e => setCentroPadrao(e.target.value)} className={selectCls}>
                    <option value="">Selecione</option>
                    <OpcoesCentro centros={centros} />
                  </select>
                  <button type="button" onClick={aplicarCentroATodas} disabled={!centroPadrao}
                    title="Troca o centro de todas as linhas, inclusive as sugeridas"
                    className="focus-ring shrink-0 whitespace-nowrap rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-gray-50 disabled:opacity-40">
                    Aplicar a todas
                  </button>
                </div>
              </Campo>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              Cada linha tem o seu centro. As marcadas com ↺ vieram do histórico; as vazias usam o padrão.
            </p>
          </div>

          {/* Lista de itens — cards mobile-first */}
          <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
            {itens.map(it => {
              const sub = it.decisao === 'substituir' ? it.similares_sistema.find(s => s.id === it.substituirId) : undefined
              const doHistorico = !!it.centro && it.centro === it.centro_sugerido && it.fonte_centro === 'historico'
              const faltaCentro = it.incluir && !(it.centro || centroPadrao)
              return (
                <div key={it.id} className={cn('flex items-start gap-3 px-4 py-3 sm:px-6', !it.incluir && 'opacity-45')}>
                  <input type="checkbox" checked={it.incluir} aria-label="Importar esta linha"
                    onChange={() => atualizar(it.id, {
                      incluir: !it.incluir,
                      // Marcar uma linha "mantida no sistema" passa a manter os dois.
                      ...(it.decisao === 'sistema' && !it.incluir ? { decisao: 'ambos' as Decisao } : {}),
                      ...(it.decisao && it.incluir ? { decisao: 'sistema' as Decisao, substituirId: undefined } : {}),
                    })}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-navy focus:ring-navy" />
                  <div className="min-w-0 flex-1">
                    {/* Descrição editável — vem do extrato, mas o usuário pode limpar
                        siglas do banco antes de importar. */}
                    <input type="text" value={it.descricao} aria-label="Descrição"
                      onChange={e => atualizar(it.id, { descricao: e.target.value })}
                      className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-gray-800 hover:border-gray-200 focus:border-navy focus:bg-white focus:outline-none" />
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <input type="date" value={it.data} aria-label="Data"
                        onChange={e => atualizar(it.id, { data: e.target.value })}
                        className="shrink-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-500 hover:border-gray-200 focus:border-navy focus:bg-white focus:outline-none" />
                      {it.decisao && (
                        <button type="button" onClick={() => setEtapa('conferencia')}
                          title="Rever na conferência"
                          className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium hover:underline',
                            it.decisao === 'substituir' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')}>
                          {it.decisao === 'substituir' ? `substitui "${sub?.descricao ?? ''}"`
                            : it.decisao === 'ambos' ? 'já existe · mantém os dois' : 'já existe no sistema'}
                        </button>
                      )}
                      {!it.decisao && it.grupo_arquivo && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">repetido no extrato</span>
                      )}
                      {/* Seletor + valor + lixeira — na mesma linha */}
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <div className="inline-flex overflow-hidden rounded-md border border-gray-200 text-[11px]">
                          <button type="button" onClick={() => atualizar(it.id, { tipo: 'despesa' })}
                            className={`px-1.5 py-0.5 font-medium ${it.tipo === 'despesa' ? 'bg-red-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                            Despesa
                          </button>
                          <button type="button" onClick={() => atualizar(it.id, { tipo: 'receita' })}
                            className={`px-1.5 py-0.5 font-medium ${it.tipo === 'receita' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                            Receita
                          </button>
                        </div>
                        <Valor tipo={it.tipo} valor={it.valor} className="text-xs" />
                        <button type="button" onClick={() => removerItem(it.id)} title="Remover linha (não importar)"
                          aria-label="Remover linha" className="p-0.5 text-gray-300 hover:text-red-500">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Centro de custo da linha */}
                    <div className="mt-1.5 flex items-center gap-2">
                      <select value={it.centro} aria-label="Centro de custo"
                        onChange={e => atualizar(it.id, { centro: e.target.value })}
                        className={cn('h-9 w-full rounded-md border bg-white px-2 text-[13px] text-slate-700 focus-ring focus:outline-none sm:w-72',
                          faltaCentro ? 'border-amber-400' : 'border-gray-200')}>
                        <option value="">
                          {centroPadrao ? `Padrão: ${nomeCentro(centroPadrao, centros)}` : 'Centro de custo…'}
                        </option>
                        <OpcoesCentro centros={centros} atual={it.centro} />
                      </select>
                      {doHistorico && (
                        <span className="shrink-0 text-[11px] font-medium text-sel" title="Mesmo centro do último lançamento com esta descrição">
                          ↺ histórico
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Rodapé fixo */}
          <div className="border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
            {erro && <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                <strong className="text-navy">{selecionados.length}</strong> selecionado(s) · {nDespesas} desp. · {nReceitas} rec.
                {nSubstituir > 0 && <span className="text-red-700"> · {nSubstituir} substitui(em)</span>}
              </p>
              <button onClick={importar} disabled={!podeImportar}
                className="rounded-lg bg-navy px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-light disabled:opacity-50">
                {carregando ? 'Importando…' : `Importar ${selecionados.length}`}
              </button>
            </div>
            {!bancoId && <p className="mt-1 text-right text-[11px] text-amber-600">Selecione o banco de destino para importar.</p>}
            {bancoId && semCentro > 0 && (
              <p className="mt-1 text-right text-[11px] text-amber-600">
                {semCentro} linha(s) sem centro de custo — escolha na linha ou defina o padrão.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── RESULTADO ── */}
      {etapa === 'resultado' && resultado && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-4xl">✅</p>
          <p className="text-lg font-semibold text-navy">{resultado.total_importado} lançamento(s) importado(s)</p>
          <p className="text-sm text-gray-500">
            {resultado.despesas} despesa(s) · {resultado.receitas} receita(s)
            {!!resultado.substituidos && <> · {resultado.substituidos} substituído(s) no sistema</>}
          </p>
          {!!resultado.erros?.length && (
            <ul className="max-w-md rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-800">
              {resultado.erros.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <button onClick={onClose} className="mt-2 rounded-lg bg-navy px-6 py-2.5 text-sm font-medium text-white hover:bg-navy-light">
            Concluir
          </button>
        </div>
      )}
    </Modal>
  )
}
