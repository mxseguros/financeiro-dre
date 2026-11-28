'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { cn, fmtBRL, fmtData } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ShareButton } from '@/components/ui/ShareButton'
import { FILTRO_CAMPO } from '@/components/ui/filtros'
import { useToast } from '@/components/ui/Toast'
import { imprimir, type Tabela } from '@/components/exportar/dados'
import { TabelaLancamentos } from '../relatorios/_components/TabelaDinamica'
import { EdicaoLancamento, useEdicaoLancamento } from '../relatorios/_components/EdicaoLancamento'
import type { Lancamento } from '../relatorios/_components/pivot'

/** O que abrir: título da modal e filtros de GET /dashboard/detalhe. */
export interface PedidoDetalhe {
  titulo: string
  params: Record<string, string>
}

export type AbrirDetalhe = (pedido: PedidoDetalhe) => void

/** Sem acento e em minúsculas, para a busca por descrição. */
const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Soma da lista: um lado só soma o valor; misturada, receitas − despesas. */
function somar(itens: Lancamento[]): number {
  const tipos = new Set(itens.map(i => i.tipo))
  if (tipos.size <= 1) return itens.reduce((a, i) => a + Number(i.valor), 0)
  return itens.reduce((a, i) => a + (i.tipo === 'Receita' ? 1 : -1) * Number(i.valor), 0)
}

const PAGINA = 100

interface RespostaDetalhe {
  valor: number | string
  total: number
  parcial: boolean
  itens: Lancamento[]
}

/** Valor da tela. Vira botão quando há o que abrir: zero não tem lançamentos,
 *  e sem `abrir` o usuário não tem acesso a Lançamentos. */
export function ValorClicavel({ valor, className, pedido, abrir }: {
  valor: number | string
  className?: string
  pedido: PedidoDetalhe
  abrir?: AbrirDetalhe
}) {
  if (!abrir || Number(valor) === 0) return <span className={className}>{fmtBRL(valor)}</span>
  return (
    <button
      type="button"
      onClick={() => abrir(pedido)}
      title="Ver lançamentos"
      aria-label={`Ver lançamentos de ${pedido.titulo}: ${fmtBRL(valor)}`}
      className={cn('cursor-pointer whitespace-nowrap rounded-sm underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current', className)}
    >
      {fmtBRL(valor)}
    </button>
  )
}

export function ModalDetalheValor({ token, qs, periodo, pedido, podeEditar, onFechar, onAlterado }: {
  token: string
  qs: string
  periodo: string
  pedido: PedidoDetalhe | null
  podeEditar: boolean
  onFechar: () => void
  /** Um lançamento foi salvo: os números da tela precisam ser recalculados. */
  onAlterado: () => void
}) {
  // Guardados com o pedido: ao abrir outro valor, a lista anterior não aparece nem por um instante.
  const [carregado, setCarregado] = useState<{ pedido: PedidoDetalhe; dados: RespostaDetalhe } | null>(null)
  const [falha, setFalha] = useState<{ pedido: PedidoDetalhe | null; mensagem: string } | null>(null)
  const [versao, setVersao] = useState(0)
  const aoErrarEdicao = useCallback((mensagem: string) => setFalha({ pedido: null, mensagem }), [])
  const edicao = useEdicaoLancamento(token, aoErrarEdicao, '/dashboard/lancamento')
  const toast = useToast()
  // Busca, ordem e "Mostrar mais" (28/11/2026). Voltam ao padrão a cada valor aberto.
  const [busca, setBusca] = useState('')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [limite, setLimite] = useState(PAGINA)
  useEffect(() => { setBusca(''); setDir('asc'); setLimite(PAGINA) }, [pedido])

  useEffect(() => {
    if (!pedido) return
    let vivo = true
    setFalha(null)
    const filtros = new URLSearchParams(pedido.params).toString()
    api.get<RespostaDetalhe>(`/dashboard/detalhe?${qs}&${filtros}`, token)
      .then(dados => { if (vivo) setCarregado({ pedido, dados }) })
      .catch((e: unknown) => { if (vivo) setFalha({ pedido, mensagem: e instanceof Error ? e.message : 'Não foi possível carregar os lançamentos.' }) })
    return () => { vivo = false }
  }, [pedido, qs, token, versao])

  const dados = pedido && carregado?.pedido === pedido ? carregado.dados : null
  const termo = normalizar(busca.trim())
  const filtrados = useMemo(() => {
    const itens = dados?.itens ?? []
    return termo ? itens.filter(i => normalizar(i.descricao ?? '').includes(termo)) : itens
  }, [dados, termo])
  // Mesma ordem da tela (por data), para imprimir e compartilhar o que se vê.
  const ordenados = useMemo(() => [...filtrados].sort(
    (a, b) => (a.data ?? '').localeCompare(b.data ?? '') * (dir === 'asc' ? 1 : -1)), [filtrados, dir])

  if (!pedido) return null

  const erro = falha && (falha.pedido === pedido || falha.pedido === null) ? falha.mensagem : null
  const valorLista = termo ? somar(filtrados) : Number(dados?.valor ?? 0)
  const plural = (n: number) => `${n} lançamento${n === 1 ? '' : 's'}`

  const resumo = dados
    ? termo
      ? `${periodo} · ${filtrados.length} de ${plural(dados.total)} · ${fmtBRL(valorLista)}`
      : `${periodo} · ${plural(dados.total)} · ${fmtBRL(dados.valor)}`
    : periodo
  const tituloSaida = termo ? `${pedido.titulo} · busca "${busca.trim()}"` : pedido.titulo

  function tabela(): Tabela {
    return {
      titulo: tituloSaida,
      colunas: ['Data', 'Tipo', 'Descrição', 'Subitem', 'Banco', 'Status', 'Valor'],
      linhas: ordenados.map(r => [fmtData(r.data), r.tipo, `${r.descricao}${r.parcela ? ` ${r.parcela}` : ''}`,
        r.subitem ?? '—', r.banco ?? '—', r.status ?? '', Number(r.valor)]),
      total: { rotulo: `Total · ${plural(ordenados.length)}`, valor: valorLista },
    }
  }

  function aoImprimir() {
    try { imprimir(tabela(), periodo) }
    catch (e) { toast.erro(e instanceof Error ? e.message : 'Não foi possível abrir a impressão.') }
  }

  const temLista = !!dados && ordenados.length > 0
  const rodape = dados && dados.total > 0 ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-slate-600">
        Total{termo ? ' filtrado' : ''} <b className="tabular-nums text-slate-900">{fmtBRL(valorLista)}</b>
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={aoImprimir} disabled={!temLista}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
            <path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
          </svg>
          Imprimir
        </Button>
        {temLista && (
          <ShareButton
            abrirPara="cima"
            titulo={tituloSaida}
            periodoLabel={periodo}
            emoji="📊"
            itens={ordenados.map(r => ({ nome: `${r.tipo === 'Receita' ? '↑' : '↓'} ${r.descricao}`, valor: Number(r.valor), data: r.data }))}
            resumo={[{ rotulo: 'Total', valor: fmtBRL(valorLista) }, { rotulo: 'Lançamentos', valor: String(ordenados.length) }]}
            totalTexto={`Total: ${fmtBRL(valorLista)} · ${plural(ordenados.length)}`}
          />
        )}
      </div>
    </div>
  ) : undefined

  return (
    <>
      {/* Some enquanto edita: a edição é outra modal, e duas disputariam o foco. */}
      <Modal open={!edicao.aberto} onClose={onFechar} title={pedido.titulo} subtitle={resumo} variant="sheet" maxWidth="sm:max-w-5xl"
        footer={rodape}>
        <div className="grid gap-3">
          {dados && dados.total > 0 && (
            <label className="relative block sm:max-w-sm">
              <span className="sr-only">Buscar por descrição</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
              <input type="search" value={busca} onChange={e => { setBusca(e.target.value); setLimite(PAGINA) }}
                placeholder="Buscar descrição" className={`${FILTRO_CAMPO} w-full pl-9`} />
            </label>
          )}
          {dados?.parcial && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Mostrando só os lançamentos que o seu perfil pode ver. O total pode ser diferente do valor da tela.
            </p>
          )}
          {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{erro}</p>}
          {!dados && !erro && (
            <div className="space-y-2" aria-busy="true" aria-label="Carregando lançamentos">
              {['w-full', 'w-5/6', 'w-2/3'].map(w => <div key={w} className={`h-3 animate-pulse rounded bg-gray-100 ${w}`} />)}
            </div>
          )}
          {dados && dados.total === 0 && <p className="text-xs text-gray-500">Nenhum lançamento neste valor.</p>}
          {dados && dados.total > 0 && termo && filtrados.length === 0 && (
            <p className="text-xs text-gray-500">Nenhum lançamento com &quot;{busca.trim()}&quot; na descrição.</p>
          )}
          {dados && filtrados.length > 0 && (
            <>
              <TabelaLancamentos
                zebrada
                lancamentos={filtrados}
                ordemData={{ dir, alternar: () => setDir(d => (d === 'asc' ? 'desc' : 'asc')) }}
                limite={limite}
                onEditar={podeEditar ? edicao.editar : undefined}
                editando={edicao.carregando}
              />
              {filtrados.length > limite && (
                <button type="button" onClick={() => setLimite(l => l + PAGINA)}
                  className="focus-ring justify-self-start rounded px-1 text-xs font-medium text-navy hover:underline">
                  Mostrar mais {Math.min(PAGINA, filtrados.length - limite)} de {filtrados.length - limite} restantes
                </button>
              )}
            </>
          )}
        </div>
      </Modal>
      <EdicaoLancamento
        token={token}
        aberto={edicao.aberto}
        cadastros={edicao.cadastros}
        onFechar={edicao.fechar}
        onTrocar={edicao.trocar}
        onSalvo={() => { setVersao(v => v + 1); onAlterado() }}
      />
    </>
  )
}
