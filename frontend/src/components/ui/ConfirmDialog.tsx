'use client'
import { Modal } from './Modal'
import { Button } from './Button'

/**
 * Confirmação destrutiva. Substitui o `ModalConfirmarExclusao` de Configurações
 * e os `confirmandoId` inline de Lançamentos — mesma API, agora com ESC,
 * focus trap e `role="dialog"`.
 */
export function ConfirmDialog({
  open, titulo, mensagem, erro, confirmarLabel = 'Excluir', loading,
  onCancelar, onConfirmar,
}: {
  open: boolean
  titulo: string
  mensagem: React.ReactNode
  erro?: string | null
  confirmarLabel?: string
  loading?: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancelar}
      title={titulo}
      variant="center"
      maxWidth="sm:max-w-sm"
      dismissable={!loading}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancelar} disabled={loading}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirmar} loading={loading}>{confirmarLabel}</Button>
        </div>
      }
    >
      <p className="text-sm text-gray-500">{mensagem}</p>
      {erro && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{erro}</p>}
    </Modal>
  )
}
