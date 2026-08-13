export const inputCls = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-navy focus-ring focus:outline-none"
export const selectCls = inputCls

export function Chip({ label, cor }: { label: string; cor: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cor}`}>{label}</span>
}

export function BtnExcluir({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs text-red-500 hover:text-red-700 hover:underline">
      Excluir
    </button>
  )
}

// ModalConfirmarExclusao foi substituído por `@/components/ui/ConfirmDialog`,
// que traz ESC, focus trap e role="dialog". `Chip`, `BtnExcluir` e `inputCls`
// migram para `components/ui/` na Fase 2.
