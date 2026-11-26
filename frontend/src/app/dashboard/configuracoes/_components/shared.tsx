export const inputCls = "h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-slate-900 placeholder-slate-400 focus:border-navy focus-ring focus:outline-none md:h-11 md:text-sm"
export const selectCls = inputCls

export function Chip({ label, cor }: { label: string; cor: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-medium ${cor}`}>{label}</span>
}

export function BtnExcluir({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] font-medium text-red-700 hover:text-red-800 hover:underline">
      Excluir
    </button>
  )
}

// ModalConfirmarExclusao foi substituído por `@/components/ui/ConfirmDialog`,
// que traz ESC, focus trap e role="dialog". `Chip`, `BtnExcluir` e `inputCls`
// migram para `components/ui/` na Fase 2.
