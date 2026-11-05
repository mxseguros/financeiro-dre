'use client'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { cn, fmtBRL } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { TabelaLancamentos } from '../relatorios/_components/TabelaDinamica'
import { EdicaoLancamento, useEdicaoLancamento } from '../relatorios/_components/EdicaoLancamento'
import type { Lancamento } from '../relatorios/_components/pivot'

/** O que abrir: título da modal e filtros de GET /dashboard/detalhe. */
export interface PedidoDetalhe {
  titulo: string
  params: Record<string, string>
}

export type AbrirDetalhe = (pedido: PedidoDetalhe) => void

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

  if (!pedido) return null

  const dados = carregado?.pedido === pedido ? carregado.dados : null
  const erro = falha && (falha.pedido === pedido || falha.pedido === null) ? falha.mensagem : null

  const resumo = dados
    ? `${periodo} · ${dados.total} lançamento${dados.total === 1 ? '' : 's'} · ${fmtBRL(dados.valor)}`
    : periodo

  return (
    <>
      {/* Some enquanto edita: a edição é outra modal, e duas disputariam o foco. */}
      <Modal open={!edicao.aberto} onClose={onFechar} title={pedido.titulo} subtitle={resumo} variant="sheet" maxWidth="sm:max-w-5xl">
        <div className="grid gap-3">
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
          {dados && dados.total > 0 && (
            <TabelaLancamentos
              lancamentos={dados.itens}
              onEditar={podeEditar ? edicao.editar : undefined}
              editando={edicao.carregando}
            />
          )}
        </div>
      </Modal>
      <EdicaoLancamento
        token={token}
        aberto={edicao.aberto}
        cadastros={edicao.cadastros}
        onFechar={edicao.fechar}
        onSalvo={() => { setVersao(v => v + 1); onAlterado() }}
      />
    </>
  )
}
