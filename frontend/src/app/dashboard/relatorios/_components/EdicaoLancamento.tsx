'use client'
import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { ModalDespesa } from '@/app/dashboard/lancamentos/_components/ModalDespesa'
import { ModalReceita } from '@/app/dashboard/lancamentos/_components/ModalReceita'
import type {
  Banco, Categoria, CentroCusto, Classificacao, Despesa, Receita, TipoLancamento,
} from '@/app/dashboard/lancamentos/_components/shared'
import type { Lancamento } from './pivot'

interface Cadastros {
  categorias: Categoria[]
  tipos: TipoLancamento[]
  bancos: Banco[]
  centros: CentroCusto[]
  classificacoes: Classificacao[]
}

type Aberto =
  | { tipo: 'despesa'; item: Despesa }
  | { tipo: 'receita'; item: Receita }

/**
 * Abre um lançamento do relatório no MESMO modal de edição de Lançamentos,
 * com as mesmas regras (voltar para pendente, reparcelar…). Os cadastros só
 * são buscados na primeira edição. `rota`: cada tela lê o lançamento por uma
 * rota com a permissão dela.
 */
export function useEdicaoLancamento(token: string | null, onErro: (msg: string) => void, rota = '/relatorios/lancamento') {
  const [aberto, setAberto] = useState<Aberto | null>(null)
  const [carregando, setCarregando] = useState<string | null>(null)
  const cadastros = useRef<Cadastros | null>(null)

  const editar = useCallback(async (l: Lancamento) => {
    if (!token) return
    setCarregando(l.id)
    try {
      if (!cadastros.current) {
        const [categorias, tipos, bancos, centros, classificacoes] = await Promise.all([
          api.get<Categoria[]>('/configuracoes/categorias', token),
          api.get<TipoLancamento[]>('/configuracoes/tipos', token),
          api.get<Banco[]>('/configuracoes/bancos', token),
          api.get<CentroCusto[]>('/configuracoes/centros-custo', token),
          api.get<Classificacao[]>('/configuracoes/classificacoes', token).catch(() => [] as Classificacao[]),
        ])
        cadastros.current = { categorias, tipos, bancos, centros, classificacoes }
      }
      const tipo = l.tipo === 'Despesa' ? 'despesa' : 'receita'
      const item = await api.get<Despesa | Receita>(`${rota}/${tipo}/${l.id}`, token)
      setAberto(tipo === 'despesa' ? { tipo, item: item as Despesa } : { tipo, item: item as Receita })
    } catch (e) {
      onErro(e instanceof Error ? e.message : 'Não foi possível abrir o lançamento.')
    } finally {
      setCarregando(null)
    }
  }, [token, onErro, rota])

  return { aberto, carregando, editar, fechar: () => setAberto(null), cadastros: cadastros.current }
}

interface Props {
  token: string
  aberto: Aberto | null
  cadastros: Cadastros | null
  onFechar: () => void
  onSalvo: () => void
}

export function EdicaoLancamento({ token, aberto, cadastros, onFechar, onSalvo }: Props) {
  if (!aberto || !cadastros) return null
  const comum = {
    token, categorias: cadastros.categorias, tipos: cadastros.tipos, bancos: cadastros.bancos,
    centros: cadastros.centros, classificacoes: cadastros.classificacoes.length ? cadastros.classificacoes : undefined,
    onClose: onFechar, onSaved: onSalvo,
  }
  return aberto.tipo === 'despesa'
    ? <ModalDespesa {...comum} despesa={aberto.item} />
    : <ModalReceita {...comum} receita={aberto.item} />
}
