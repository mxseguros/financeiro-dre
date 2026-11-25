// Quadro "Pagamentos" do dashboard (CNAB, fase 5): o que vence até hoje, o
// que está com cada banco e o que voltou rejeitado. Some quando não há nada.
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { fmtBRL } from '@/lib/utils'

interface Soma { qtd: number; valor: string }
interface Resumo { habilitado: boolean; a_pagar_hoje?: Soma; rejeitados?: Soma; autorizar?: Soma; com_o_banco?: Record<string, Soma> }

function Bloco({ titulo, s, cor, dica }: { titulo: string; s?: Soma; cor: string; dica?: string }) {
  if (!s || !s.qtd) return null
  return (
    <Link href="/dashboard/lancamentos/pagamentos" className="rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-navy/40">
      <p className="text-xs text-gray-500">{titulo}</p>
      <p className={`mt-0.5 text-lg font-semibold ${cor}`}>{fmtBRL(s.valor)}</p>
      <p className="text-[11px] text-gray-400">{s.qtd} pagamento(s){dica ? ` · ${dica}` : ''}</p>
    </Link>
  )
}

export function QuadroPagamentos({ token }: { token: string }) {
  const [r, setR] = useState<Resumo | null>(null)
  useEffect(() => { api.get<Resumo>('/pagamentos/resumo', token).then(setR).catch(() => setR(null)) }, [token])
  if (!r?.habilitado) return null
  const bancos = Object.entries(r.com_o_banco ?? {})
  const vazio = !r.a_pagar_hoje?.qtd && !r.rejeitados?.qtd && bancos.length === 0
  if (vazio) return null
  return (
    <div aria-label="Pagamentos" className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pagamentos</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Bloco titulo="A pagar até hoje" s={r.a_pagar_hoje} cor="text-navy" />
        {bancos.map(([banco, s]) => (
          <Bloco key={banco} titulo={`Com o ${banco} (aguardando retorno)`} s={s} cor="text-indigo-700" />
        ))}
        <Bloco titulo="Autorizar no banco" s={r.autorizar} cor="text-amber-700" />
        <Bloco titulo="Rejeitados / devolvidos" s={r.rejeitados} cor="text-red-600" dica="voltaram para a pagar" />
      </div>
    </div>
  )
}
