// Recibo da Ordem de Compra aprovada (migration 0048, 24/11/2026):
// aguardando → (funcionário envia pelo /oc) enviado → (financeiro confere)
// aprovado, ou devolvido com motivo → o funcionário envia outro.

export type ReciboStatus = 'aguardando' | 'enviado' | 'aprovado' | 'devolvido'

export const RECIBO: Record<ReciboStatus, { rotulo: string; cls: string }> = {
  aguardando: { rotulo: 'Aguardando recibo', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  enviado:    { rotulo: 'Recibo p/ conferir', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  aprovado:   { rotulo: 'Recibo OK', cls: 'bg-green-50 text-green-700 ring-green-200' },
  devolvido:  { rotulo: 'Recibo devolvido', cls: 'bg-red-50 text-red-700 ring-red-200' },
}

export function SeloRecibo({ status, className = '' }: { status?: string | null; className?: string }) {
  const r = status ? RECIBO[status as ReciboStatus] : undefined
  if (!r) return null
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ring-1 ring-inset ${r.cls} ${className}`}>
      🧾 {r.rotulo}
    </span>
  )
}

/** Link para os funcionários (o /oc deste mesmo site). */
export function linkOC(): string {
  return typeof window === 'undefined' ? '/oc' : `${window.location.origin}/oc`
}
