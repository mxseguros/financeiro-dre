'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { OpcoesCentro } from '@/lib/centros'
import { fmtBRL, fmtData } from '@/lib/utils'
import { Campo, selectCls, type Banco, type Categoria, type CentroCusto, type Despesa, type Receita, type TipoLancamento } from './shared'

/**
 * Empréstimo: despesa ↔ receita espelhadas e vinculadas (28/11/2026, Gabriel).
 * Backend: app/services/emprestimo_vinculo.py · migration 0053.
 */

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** Mesma regra do quadro Empréstimos da Visão Geral (ALVOS_EMPRESTIMOS). */
export function ehEmprestimo(nome: string | null | undefined): boolean {
  const n = normalizar(nome ?? '')
  return n === 'emprestimo' || n === 'emprestimos'
}

export interface EspelhoForm {
  ativo: boolean
  categoria_id: string
  tipo_lancamento_id: string
  banco_id: string
  centro_custo: string
}

export const ESPELHO_VAZIO: EspelhoForm = { ativo: false, categoria_id: '', tipo_lancamento_id: '', banco_id: '', centro_custo: '' }

/** Payload `espelho` da criação, ou undefined quando não marcado. */
export function payloadEspelho(e: EspelhoForm) {
  return e.ativo
    ? { tipo_lancamento_id: e.tipo_lancamento_id || null, banco_id: e.banco_id || null, centro_custo: e.centro_custo || null }
    : undefined
}

/**
 * Checkbox "Lançar também como receita/despesa" + painel do espelho. Ao marcar,
 * já vem com a categoria Empréstimo do outro lado, o subitem de mesmo nome
 * (se houver) e o banco/centro do lançamento — tudo editável.
 */
export function PainelEspelho({ lado, valor, onChange, categorias, tipos, bancos, centros, base, erro }: {
  /** Lado que será CRIADO como espelho. */
  lado: 'receita' | 'despesa'
  valor: EspelhoForm
  onChange: (v: EspelhoForm) => void
  categorias: Categoria[]
  tipos: TipoLancamento[]
  bancos: Banco[]
  centros: CentroCusto[]
  /** Dados do lançamento principal, para pré-preencher. */
  base: { subitemNome?: string; banco_id: string; centro_custo: string }
  erro?: string
}) {
  const cats = categorias.filter(c => c.natureza === lado && c.ativo)
  const subs = tipos.filter(t => t.natureza === lado && t.categoria_id === valor.categoria_id)

  function marcar(ativo: boolean) {
    if (!ativo) { onChange({ ...valor, ativo }); return }
    const cat = cats.find(c => ehEmprestimo(c.nome)) ?? cats[0]
    const doCat = tipos.filter(t => t.natureza === lado && t.categoria_id === cat?.id)
    const mesmoNome = doCat.find(t => normalizar(t.nome) === normalizar(base.subitemNome ?? ''))
    onChange({
      ativo,
      categoria_id: valor.categoria_id || cat?.id || '',
      tipo_lancamento_id: valor.tipo_lancamento_id || mesmoNome?.id || (doCat.length === 1 ? doCat[0].id : ''),
      banco_id: valor.banco_id || base.banco_id,
      centro_custo: valor.centro_custo || base.centro_custo,
    })
  }

  const rotulo = lado === 'receita' ? 'receita' : 'despesa'
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-2.5">
      <label className="flex cursor-pointer select-none items-start gap-2">
        <input type="checkbox" checked={valor.ativo} onChange={e => marcar(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
        <span>
          <span className="block text-sm font-medium text-gray-800">Existe uma {rotulo} para este empréstimo? Lançar também como {rotulo}</span>
          <span className="block text-xs text-gray-500">
            Cria a {rotulo} com o mesmo valor, descrição e datas, vinculada a este lançamento. Editar um atualiza o outro.
          </span>
        </span>
      </label>
      {valor.ativo && (
        <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Campo label={`Categoria da ${rotulo}`}>
            <select value={valor.categoria_id} className={selectCls}
              onChange={e => onChange({ ...valor, categoria_id: e.target.value, tipo_lancamento_id: '' })}>
              <option value="">Selecionar categoria</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Campo>
          <Campo label={`Subitem da ${rotulo} *`}>
            <select value={valor.tipo_lancamento_id} disabled={!valor.categoria_id} className={selectCls}
              onChange={e => onChange({ ...valor, tipo_lancamento_id: e.target.value })}>
              <option value="">{valor.categoria_id ? 'Selecionar subitem' : 'Escolha a categoria primeiro'}</option>
              {subs.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Banco">
            <select value={valor.banco_id} onChange={e => onChange({ ...valor, banco_id: e.target.value })} className={selectCls}>
              <option value="">Sem banco</option>
              {bancos.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Centro de custo">
            <select value={valor.centro_custo} onChange={e => onChange({ ...valor, centro_custo: e.target.value })} className={selectCls}>
              <OpcoesCentro centros={centros} atual={valor.centro_custo} />
            </select>
          </Campo>
          {erro && <p role="alert" className="text-xs text-red-600 sm:col-span-2">{erro}</p>}
        </div>
      )}
    </div>
  )
}

/** Dica quando a categoria é Empréstimo mas o lançamento é parcelado/recorrente. */
export function DicaEspelhoIndisponivel() {
  return (
    <p className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
      O vínculo com o outro lado (despesa ↔ receita) vale só para lançamento único, sem parcelas ou recorrência.
    </p>
  )
}

export interface Vinculado {
  tabela: 'despesas' | 'receitas_outras'
  tipo: 'despesa' | 'receita'
  id: string
  descricao: string
  valor: number | string
  competencia: string
  data_vencimento: string | null
  pago_em: string | null
  centro_custo: string | null
}

/** Busca o lançamento vinculado (null sem vínculo ou sem a migration). */
export function useVinculo(token: string | null, tipo: 'despesa' | 'receita', id: string | null | undefined) {
  const [vinculado, setVinculado] = useState<Vinculado | null>(null)
  useEffect(() => {
    setVinculado(null)
    if (!token || !id) return
    let vivo = true
    api.get<{ vinculado: Vinculado | null }>(`/lancamentos/vinculo/${tipo === 'despesa' ? 'despesas' : 'receitas'}/${id}`, token)
      .then(r => { if (vivo) setVinculado(r.vinculado) })
      .catch(() => { /* sem vínculo */ })
    return () => { vivo = false }
  }, [token, tipo, id])
  return vinculado
}

/** Faixa no topo do modal em edição: "Vinculado à receita … · Abrir". */
export function FaixaVinculo({ token, vinculado, onAbrir }: {
  token: string
  vinculado: Vinculado | null
  onAbrir?: (tipo: 'despesa' | 'receita', item: Despesa | Receita) => void
}) {
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  if (!vinculado) return null

  async function abrir() {
    if (!vinculado || !onAbrir) return
    setAbrindo(true); setErro(null)
    try {
      const item = await api.get<Despesa | Receita>(`/dashboard/lancamento/${vinculado.tipo}/${vinculado.id}`, token)
      onAbrir(vinculado.tipo, item)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir.')
      setAbrindo(false)
    }
  }

  return (
    <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden="true">🔗</span>
        <span className="min-w-0 flex-1">
          Vinculado à {vinculado.tipo} <strong>&quot;{vinculado.descricao}&quot;</strong> · {fmtBRL(vinculado.valor)}
          {vinculado.pago_em
            ? <> · {vinculado.tipo === 'despesa' ? 'paga' : 'recebida'} em {fmtData(vinculado.pago_em)}</>
            : <> · em aberto</>}
        </span>
        {onAbrir && (
          <button type="button" onClick={abrir} disabled={abrindo}
            className="focus-ring shrink-0 rounded px-1 font-semibold text-indigo-800 hover:underline disabled:opacity-50">
            {abrindo ? 'Abrindo…' : `Abrir ${vinculado.tipo}`}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-indigo-700/80">Valor, descrição, competência e vencimento são atualizados também no vinculado.</p>
      {erro && <p className="mt-1 text-red-600">{erro}</p>}
    </div>
  )
}
