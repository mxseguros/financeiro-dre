'use client'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

/**
 * Confirmação de exclusão para lançamentos que pertencem a uma série
 * (parcelamento ou recorrência): oferece excluir só a ocorrência atual ou
 * também as futuras.
 *
 * Extraído dos dois diálogos inline de `lancamentos/page.tsx`, que eram
 * idênticos exceto pelo texto — e nenhum deles fechava no ESC.
 */
export function DialogExcluirGrupo({
  open, titulo, mensagem, labelSomenteEsta, excluindo, onCancelar, onExcluir,
}: {
  open: boolean
  titulo: string
  mensagem: React.ReactNode
  /** Rótulo do botão do meio: "Só esta parcela" ou "Só esta ocorrência". */
  labelSomenteEsta: string
  excluindo: boolean
  onCancelar: () => void
  /** `futuras=true` remove também as ocorrências dos meses seguintes. */
  onExcluir: (futuras: boolean) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onCancelar}
      title={titulo}
      maxWidth="sm:max-w-sm"
      dismissable={!excluindo}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancelar} disabled={excluindo}>Cancelar</Button>
          <Button variant="secondary" tone="danger" onClick={() => onExcluir(false)} disabled={excluindo}
            className="border-red-200 text-red-600 hover:bg-red-50">
            {labelSomenteEsta}
          </Button>
          <Button variant="danger" onClick={() => onExcluir(true)} loading={excluindo}>
            {excluindo ? 'Excluindo…' : 'Esta e as futuras'}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-gray-600">{mensagem}</p>
    </Modal>
  )
}
