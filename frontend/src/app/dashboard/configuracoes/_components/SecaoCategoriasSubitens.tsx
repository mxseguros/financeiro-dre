import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Interruptor } from '@/components/ui/Interruptor'
import { FILTRO_GRUPO, filtroSegmento } from '@/components/ui/filtros'
import { useToast } from '@/components/ui/Toast'
import { inputCls } from './shared'
import { useUser } from '@/contexts/UserContext'

interface CategoriaItem { id: string; nome: string; natureza: string; ordem: number; ativo: boolean }
interface SubitemItem {
  id: string; nome: string; natureza: string
  categoria_id: string | null; categoria_nome: string | null
  custo_tipo: string | null; ativo: boolean
  somente_dre?: boolean
  confidencial?: boolean
}

type PainelCat = { modo: 'nova' } | { modo: 'editar'; c: CategoriaItem }
type PainelSub = { modo: 'novo' } | { modo: 'editar'; s: SubitemItem }

const rotulo = 'block text-sm font-semibold text-slate-700'

/**
 * Categorias e subitens (redesenho UX, fase 7): categorias à esquerda com o
 * alternador Despesas / Receitas, subitens da categoria escolhida à direita.
 * Criar e editar abrem um painel lateral (tela cheia no celular). No celular,
 * a lista de categorias leva à tela dos subitens, com Voltar.
 */
export function SecaoCategoriasSubitens({ token, podeCriar, podeEditar, podeExcluir }: {
  token: string; podeCriar: boolean; podeEditar: boolean; podeExcluir: boolean
}) {
  const [natureza, setNatureza] = useState<'despesa' | 'receita'>('despesa')
  const [categorias, setCategorias] = useState<CategoriaItem[]>([])
  const [subitens, setSubitens] = useState<SubitemItem[]>([])
  const [loading, setLoading] = useState(true)
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<string | null>(null)
  const [verSubitensCelular, setVerSubitensCelular] = useState(false)
  const toast = useToast()
  // Salários confidenciais (0046): só o Admin vê e define.
  const { role } = useUser()
  const ehAdmin = role === 'admin'

  const [painelCat, setPainelCat] = useState<PainelCat | null>(null)
  const [formCat, setFormCat] = useState({ nome: '', ordem: 0 })
  const [painelSub, setPainelSub] = useState<PainelSub | null>(null)
  const [formSub, setFormSub] = useState({ nome: '', categoria_id: '', somente_dre: false, confidencial: false })
  const [salvando, setSalvando] = useState(false)
  const [erroPainel, setErroPainel] = useState<string | null>(null)

  const [confirmExcluirCategoria, setConfirmExcluirCategoria] = useState<CategoriaItem | null>(null)
  const [confirmExcluirSubitem, setConfirmExcluirSubitem] = useState<SubitemItem | null>(null)
  const [erroExclusao, setErroExclusao] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  const carregar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<CategoriaItem[]>('/configuracoes/categorias', token),
      api.get<SubitemItem[]>('/configuracoes/tipos', token),
    ]).then(([cats, subs]) => { setCategorias(cats); setSubitens(subs) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])
  useEffect(() => { carregar() }, [carregar])

  const categoriasDaNatureza = categorias.filter(c => c.natureza === natureza).sort((a, b) => a.ordem - b.ordem)
  // Começa na primeira categoria da natureza (a lista da direita nunca fica vazia à toa).
  useEffect(() => {
    if (!categoriasDaNatureza.some(c => c.id === categoriaSelecionada)) setCategoriaSelecionada(categoriasDaNatureza[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natureza, categorias])
  const categoriaAtual = categoriasDaNatureza.find(c => c.id === categoriaSelecionada) ?? null
  const subitensExibidos = subitens.filter(s => s.natureza === natureza && s.categoria_id === categoriaSelecionada)
  const qtdSub = (catId: string) => subitens.filter(s => s.categoria_id === catId).length

  // ── Categoria ──
  function abrirCategoria(p: PainelCat) {
    setErroPainel(null)
    setFormCat(p.modo === 'editar' ? { nome: p.c.nome, ordem: p.c.ordem } : { nome: '', ordem: (categoriasDaNatureza[categoriasDaNatureza.length - 1]?.ordem ?? 0) + 1 })
    setPainelCat(p)
  }
  async function salvarCategoria(e: React.FormEvent) {
    e.preventDefault()
    if (!painelCat) return
    if (!formCat.nome.trim()) { setErroPainel('Informe o nome da categoria.'); return }
    setSalvando(true); setErroPainel(null)
    try {
      if (painelCat.modo === 'nova') {
        await api.post('/configuracoes/categorias', token, { nome: formCat.nome.trim(), natureza, ordem: formCat.ordem })
        toast.sucesso('Categoria criada.')
      } else {
        await api.put(`/configuracoes/categorias/${painelCat.c.id}`, token, { nome: formCat.nome.trim(), ordem: formCat.ordem })
        toast.sucesso('Categoria atualizada.')
      }
      setPainelCat(null); carregar()
    } catch (err) { setErroPainel(err instanceof Error ? err.message : 'Erro ao salvar a categoria.') }
    finally { setSalvando(false) }
  }
  async function excluirCategoria(c: CategoriaItem) {
    // O erro fica NO diálogo: "categoria em uso" é a resposta esperada e precisa ser lida.
    setErroExclusao(null); setExcluindo(true)
    try {
      await api.delete(`/configuracoes/categorias/${c.id}`, token)
      setConfirmExcluirCategoria(null); setPainelCat(null)
      carregar()
      toast.sucesso(`Categoria "${c.nome}" excluída.`)
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : 'Erro ao excluir categoria')
    } finally { setExcluindo(false) }
  }

  // ── Subitem ──
  function abrirSubitem(p: PainelSub) {
    setErroPainel(null)
    setFormSub(p.modo === 'editar'
      ? { nome: p.s.nome, categoria_id: p.s.categoria_id ?? '', somente_dre: !!p.s.somente_dre, confidencial: !!p.s.confidencial }
      : { nome: '', categoria_id: categoriaSelecionada ?? '', somente_dre: false, confidencial: false })
    setPainelSub(p)
  }
  async function salvarSubitem(e: React.FormEvent) {
    e.preventDefault()
    if (!painelSub) return
    if (!formSub.nome.trim()) { setErroPainel('Informe o nome do subitem.'); return }
    if (!formSub.categoria_id) { setErroPainel('Escolha a categoria.'); return }
    setSalvando(true); setErroPainel(null)
    try {
      if (painelSub.modo === 'novo') {
        const criado = await api.post<SubitemItem>('/configuracoes/tipos', token, { nome: formSub.nome.trim(), natureza, categoria_id: formSub.categoria_id })
        // Marcações especiais vão numa segunda chamada (o cadastro não as recebe).
        const extras: Record<string, boolean> = {}
        if (natureza === 'receita' && formSub.somente_dre) extras.somente_dre = true
        if (natureza === 'despesa' && ehAdmin && formSub.confidencial) extras.confidencial = true
        if (criado?.id && Object.keys(extras).length) await api.put(`/configuracoes/tipos/${criado.id}`, token, extras)
        toast.sucesso('Subitem criado.')
      } else {
        const s = painelSub.s
        const corpo: Record<string, unknown> = { nome: formSub.nome.trim(), categoria_id: formSub.categoria_id }
        if (natureza === 'receita' && formSub.somente_dre !== !!s.somente_dre) corpo.somente_dre = formSub.somente_dre
        if (natureza === 'despesa' && ehAdmin && formSub.confidencial !== !!s.confidencial) corpo.confidencial = formSub.confidencial
        await api.put(`/configuracoes/tipos/${s.id}`, token, corpo)
        toast.sucesso('Subitem atualizado.')
      }
      setPainelSub(null); carregar()
    } catch (err) { setErroPainel(err instanceof Error ? err.message : 'Erro ao salvar o subitem.') }
    finally { setSalvando(false) }
  }
  async function excluirSubitem(s: SubitemItem) {
    setErroExclusao(null); setExcluindo(true)
    try {
      await api.delete(`/configuracoes/tipos/${s.id}`, token)
      setConfirmExcluirSubitem(null); setPainelSub(null)
      carregar()
      toast.sucesso(`Subitem "${s.nome}" excluído.`)
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : 'Erro ao excluir subitem')
    } finally { setExcluindo(false) }
  }

  const botaoPrimario = 'focus-ring inline-flex h-12 items-center gap-1.5 whitespace-nowrap rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy-light md:h-11'

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={!!confirmExcluirCategoria}
        titulo="Excluir categoria?"
        mensagem={<><strong>{confirmExcluirCategoria?.nome}</strong> será excluída permanentemente.</>}
        erro={erroExclusao} loading={excluindo}
        onCancelar={() => { setConfirmExcluirCategoria(null); setErroExclusao(null) }}
        onConfirmar={() => confirmExcluirCategoria && excluirCategoria(confirmExcluirCategoria)}
      />
      <ConfirmDialog
        open={!!confirmExcluirSubitem}
        titulo="Excluir subitem?"
        mensagem={<><strong>{confirmExcluirSubitem?.nome}</strong> será excluído permanentemente. Se já houver lançamentos nele, o sistema não deixa excluir.</>}
        erro={erroExclusao} loading={excluindo}
        onCancelar={() => { setConfirmExcluirSubitem(null); setErroExclusao(null) }}
        onConfirmar={() => confirmExcluirSubitem && excluirSubitem(confirmExcluirSubitem)}
      />

      {/* Painel: categoria */}
      <Modal open={!!painelCat} onClose={() => setPainelCat(null)} variant="painel" dismissable={!salvando}
        title={painelCat?.modo === 'nova' ? `Nova categoria de ${natureza === 'despesa' ? 'despesa' : 'receita'}` : 'Editar categoria'}
        footer={
          <div className="flex items-center gap-2">
            {painelCat?.modo === 'editar' && podeExcluir && (
              <Button variant="ghost" tone="danger" className="mr-auto" disabled={salvando}
                onClick={() => painelCat.modo === 'editar' && setConfirmExcluirCategoria(painelCat.c)}>Excluir</Button>
            )}
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setPainelCat(null)} disabled={salvando}>Cancelar</Button>
            <Button type="submit" form="form-categoria" loading={salvando}>Salvar</Button>
          </div>
        }>
        <form id="form-categoria" onSubmit={salvarCategoria} noValidate className="space-y-4">
          <div>
            <label htmlFor="cat-nome" className={rotulo}>Nome</label>
            <input id="cat-nome" value={formCat.nome} onChange={e => setFormCat(f => ({ ...f, nome: e.target.value }))} className={cn(inputCls, 'mt-1.5')} autoFocus />
          </div>
          <div>
            <label htmlFor="cat-ordem" className={rotulo}>Ordem na lista</label>
            <input id="cat-ordem" type="number" value={formCat.ordem} onChange={e => setFormCat(f => ({ ...f, ordem: Number(e.target.value) }))} className={cn(inputCls, 'mt-1.5 w-32')} />
          </div>
          {erroPainel && <p role="alert" className="text-[13px] text-red-800">{erroPainel}</p>}
        </form>
      </Modal>

      {/* Painel: subitem */}
      <Modal open={!!painelSub} onClose={() => setPainelSub(null)} variant="painel" dismissable={!salvando}
        title={painelSub?.modo === 'novo' ? 'Novo subitem' : 'Editar subitem'}
        subtitle={categoriaAtual ? `${natureza === 'despesa' ? 'Despesa' : 'Receita'} · ${categoriaAtual.nome}` : undefined}
        footer={
          <div className="flex items-center gap-2">
            {painelSub?.modo === 'editar' && podeExcluir && (
              <Button variant="ghost" tone="danger" className="mr-auto" disabled={salvando}
                onClick={() => painelSub.modo === 'editar' && setConfirmExcluirSubitem(painelSub.s)}>Excluir</Button>
            )}
            <span className="flex-1" />
            <Button variant="secondary" onClick={() => setPainelSub(null)} disabled={salvando}>Cancelar</Button>
            <Button type="submit" form="form-subitem" loading={salvando}>Salvar</Button>
          </div>
        }>
        <form id="form-subitem" onSubmit={salvarSubitem} noValidate className="space-y-4">
          <div>
            <label htmlFor="sub-nome" className={rotulo}>Nome</label>
            <input id="sub-nome" value={formSub.nome} onChange={e => setFormSub(f => ({ ...f, nome: e.target.value }))} className={cn(inputCls, 'mt-1.5')} autoFocus />
          </div>
          <div>
            <label htmlFor="sub-cat" className={rotulo}>Categoria</label>
            <select id="sub-cat" value={formSub.categoria_id} onChange={e => setFormSub(f => ({ ...f, categoria_id: e.target.value }))} className={cn(inputCls, 'mt-1.5')}>
              <option value="">Escolha…</option>
              {categoriasDaNatureza.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          {natureza === 'receita' && (
            <Interruptor id="sub-so-dre" rotulo="Só na DRE" ligado={formSub.somente_dre} disabled={!podeEditar}
              onChange={v => setFormSub(f => ({ ...f, somente_dre: v }))}
              dica="As receitas deste subitem contam na DRE, mas ficam fora da Visão Geral e dos totais de Lançamentos." />
          )}
          {natureza === 'despesa' && ehAdmin && (
            <Interruptor id="sub-confidencial" rotulo="Confidencial" ligado={formSub.confidencial}
              onChange={v => setFormSub(f => ({ ...f, confidencial: v }))}
              dica={'Quem não é Admin vê só o total ("Total Salários Funcionários"), sem nome nem valor de cada um.'} />
          )}
          {erroPainel && <p role="alert" className="text-[13px] text-red-800">{erroPainel}</p>}
        </form>
      </Modal>

      <div role="group" aria-label="Natureza" className={FILTRO_GRUPO}>
        {(['despesa', 'receita'] as const).map(n => (
          <button key={n} type="button" aria-pressed={natureza === n} onClick={() => { setNatureza(n); setVerSubitensCelular(false) }} className={filtroSegmento(natureza === n)}>
            {n === 'despesa' ? 'Despesas' : 'Receitas'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* Categorias */}
        <section aria-labelledby="titulo-categorias" className={cn('overflow-hidden rounded-2xl border border-gray-200 bg-white lg:block', verSubitensCelular ? 'hidden' : 'block')}>
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
            <h3 id="titulo-categorias" className="text-[15px] font-bold text-slate-900">Categorias</h3>
            {podeCriar && <button type="button" onClick={() => abrirCategoria({ modo: 'nova' })} className="focus-ring h-11 rounded-lg px-2 text-sm font-semibold text-sel hover:underline">+ Nova</button>}
          </div>
          {loading ? <p className="py-8 text-center text-sm text-slate-600">Carregando…</p> : (
            <ul>
              {categoriasDaNatureza.map(c => {
                const sel = c.id === categoriaSelecionada
                return (
                  <li key={c.id} className="border-t border-slate-100 first:border-t-0">
                    <div className={cn('flex items-center', sel && 'bg-sel-bg')}>
                      <button type="button" onClick={() => { setCategoriaSelecionada(c.id); setVerSubitensCelular(true) }} aria-current={sel ? 'true' : undefined}
                        className={cn('focus-ring flex min-h-12 flex-1 items-center justify-between gap-2 px-4 text-left text-[15px] md:min-h-11 md:text-sm',
                          sel ? 'font-semibold text-sel-text' : 'text-slate-800', !c.ativo && 'opacity-60')}>
                        <span className="flex items-center gap-2">
                          {c.nome}
                          {!c.ativo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-600">inativa</span>}
                        </span>
                        <span className="text-[13px] tabular-nums text-slate-500">{qtdSub(c.id)}</span>
                      </button>
                      {podeEditar && (
                        <button type="button" onClick={() => abrirCategoria({ modo: 'editar', c })} aria-label={`Editar categoria ${c.nome}`}
                          className="focus-ring mr-1 flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
              {categoriasDaNatureza.length === 0 && <li className="py-6 text-center text-sm text-slate-600">Nenhuma categoria.</li>}
            </ul>
          )}
        </section>

        {/* Subitens da categoria escolhida */}
        <section aria-labelledby="titulo-subitens" className={cn('overflow-hidden rounded-2xl border border-gray-200 bg-white lg:block', verSubitensCelular ? 'block' : 'hidden')}>
          <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-2 md:px-4">
            <button type="button" onClick={() => setVerSubitensCelular(false)} aria-label="Voltar para as categorias"
              className="focus-ring flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-xl text-slate-700 hover:bg-slate-100 lg:hidden">‹</button>
            <h3 id="titulo-subitens" className="flex-1 text-[15px] font-bold text-slate-900">
              {categoriaAtual ? <>Subitens de {categoriaAtual.nome} <span className="font-normal text-slate-500">({subitensExibidos.length})</span></> : 'Subitens'}
            </h3>
            {podeCriar && categoriaAtual && <button type="button" onClick={() => abrirSubitem({ modo: 'novo' })} className={botaoPrimario}>+ Novo subitem</button>}
          </div>
          {loading ? <p className="py-10 text-center text-sm text-slate-600">Carregando…</p> : (
            <ul>
              {subitensExibidos.map(s => (
                <li key={s.id} className="border-t border-slate-100 first:border-t-0">
                  <button type="button" disabled={!podeEditar} onClick={() => abrirSubitem({ modo: 'editar', s })}
                    className={cn('focus-ring flex min-h-[56px] w-full flex-wrap items-center gap-2 px-4 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent', !s.ativo && 'opacity-60')}>
                    <span className="flex-1 text-[15px] font-medium text-slate-900 md:text-sm">{s.nome}</span>
                    {s.somente_dre && <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[13px] font-semibold text-slate-700" title="Conta só na DRE">Só DRE</span>}
                    {s.confidencial && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[13px] font-semibold text-amber-900" title="Quem não é Admin vê só o total">Confidencial</span>}
                    {!s.ativo && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-600">inativo</span>}
                    {podeEditar && <span aria-hidden="true" className="text-slate-400">›</span>}
                  </button>
                </li>
              ))}
              {subitensExibidos.length === 0 && (
                <li className="py-8 text-center text-sm text-slate-600">{categoriaAtual ? 'Nenhum subitem nesta categoria.' : 'Escolha uma categoria.'}</li>
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
