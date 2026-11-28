'use client'

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-navy focus-ring focus:outline-none'

/**
 * Input com máscara de moeda pt-BR (R$ 1.234,56).
 *
 * Digitação estilo banco: o usuário digita apenas números e o valor se forma
 * dos centavos para cima. `value` guarda a string numérica ("1234.56"), então
 * a lógica de quem consome (parseFloat, payloads) não muda.
 */
export function InputMoeda({ value, onChange, required, className, id }: {
  value: string
  onChange: (v: string) => void
  required?: boolean
  className?: string
  id?: string
}) {
  const display = value
    ? Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : ''

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '')
    if (!digits) { onChange(''); return }
    if (digits.length > 10) return // máx. 99.999.999,99 (limite do backend)
    onChange((parseInt(digits, 10) / 100).toFixed(2))
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">R$</span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        required={required}
        value={display}
        onChange={handle}
        placeholder="0,00"
        className={`${inputCls} pl-9 ${className ?? ''}`}
      />
    </div>
  )
}
