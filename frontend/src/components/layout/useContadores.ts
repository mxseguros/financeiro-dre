'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { permissaoPagamentos, type Permissions, type Role } from '@/types'
import type { Contador } from './navegacao'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Contadores do menu, com endpoints que já existem (sem mudar API):
 * - Aprovações: ordens de compra pendentes nos últimos 12 meses (limite da API);
 * - Pagamentos: despesas aprovadas a pagar vencidas ou vencendo hoje (`/pagamentos/resumo`).
 * Recarrega ao trocar de tela, no máximo a cada 2 minutos (a rota de ordens é auditada e limitada).
 */
export function useContadores(token: string | null, role: Role, permissions: Permissions): Partial<Record<Contador, number>> {
  const pathname = usePathname()
  const [valores, setValores] = useState<Partial<Record<Contador, number>>>({})
  const [ultima, setUltima] = useState(0)

  const veAprovacoes = permissions.aprovacoes?.visualizar === true
  const vePagamentos = permissaoPagamentos(permissions, role, 'visualizar')

  useEffect(() => {
    if (!token) return
    const agora = Date.now()
    if (agora - ultima < 120_000) return
    setUltima(agora)
    const fim = new Date()
    const inicio = new Date(); inicio.setDate(inicio.getDate() - 364)
    if (veAprovacoes) {
      api.get<{ total: number }>(`/ordens-compra?inicio=${iso(inicio)}&fim=${iso(fim)}&status=pendente`, token)
        .then(r => setValores(v => ({ ...v, aprovacoes: r.total })))
        .catch(() => {})
    }
    if (vePagamentos) {
      api.get<{ habilitado: boolean; a_pagar_hoje?: { qtd: number } }>('/pagamentos/resumo', token)
        .then(r => setValores(v => ({ ...v, pagamentos: r.a_pagar_hoje?.qtd ?? 0 })))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, pathname, veAprovacoes, vePagamentos])

  return valores
}

export const DICA_CONTADOR: Record<Contador, string> = {
  aprovacoes: 'ordens de compra aguardando aprovação',
  pagamentos: 'pagamentos vencidos ou vencendo hoje',
}
