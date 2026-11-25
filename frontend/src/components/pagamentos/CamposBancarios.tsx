// Campos de conta e chave Pix do favorecido (fornecedor ou funcionário).
import { FORMAS_FAVORECIDO, TIPOS_CHAVE, TIPOS_CONTA, type DadosBancarios, type FormaPagamento, type TipoChave, type TipoConta } from '@/lib/pagamentos'

const cls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-navy focus-ring focus:outline-none'

export type FormBancario = { [K in keyof DadosBancarios]: string }

export const formBancarioVazio = (): FormBancario => ({
  banco_codigo: '', ispb: '', agencia: '', agencia_dv: '', conta: '', conta_dv: '', tipo_conta: 'corrente',
  pix_tipo_chave: '', pix_chave: '', forma_pagamento_padrao: 'pix',
})

export function paraFormBancario(d: Partial<DadosBancarios> | null | undefined): FormBancario {
  const v = formBancarioVazio()
  if (!d) return v
  return {
    banco_codigo: d.banco_codigo ?? '', ispb: d.ispb ?? '', agencia: d.agencia ?? '', agencia_dv: d.agencia_dv ?? '',
    conta: d.conta ?? '', conta_dv: d.conta_dv ?? '', tipo_conta: d.tipo_conta ?? 'corrente',
    pix_tipo_chave: d.pix_tipo_chave ?? '', pix_chave: d.pix_chave ?? '',
    forma_pagamento_padrao: d.forma_pagamento_padrao ?? 'pix',
  }
}

export function paraPayloadBancario(f: FormBancario) {
  const t = (s: string) => s.trim() || null
  return {
    banco_codigo: t(f.banco_codigo), ispb: t(f.ispb), agencia: t(f.agencia), agencia_dv: t(f.agencia_dv),
    conta: t(f.conta), conta_dv: t(f.conta_dv), tipo_conta: (t(f.conta) ? f.tipo_conta || 'corrente' : null) as TipoConta | null,
    pix_tipo_chave: (t(f.pix_chave) ? f.pix_tipo_chave || null : null) as TipoChave | null,
    pix_chave: t(f.pix_tipo_chave) ? t(f.pix_chave) : null,
    forma_pagamento_padrao: (f.forma_pagamento_padrao || null) as FormaPagamento | null,
  }
}

function Campo({ rotulo, dica, children, className = '' }: { rotulo: string; dica?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-0.5 block text-xs font-medium text-gray-600">{rotulo}</span>
      {children}
      {dica && <span className="mt-0.5 block text-[11px] text-gray-400">{dica}</span>}
    </label>
  )
}

export function CamposBancarios({ form, onChange, mostrarForma = true }: {
  form: FormBancario
  onChange: (f: FormBancario) => void
  mostrarForma?: boolean
}) {
  const set = (k: keyof FormBancario, v: string) => onChange({ ...form, [k]: v })
  const exemplo = TIPOS_CHAVE.find(t => t.id === form.pix_tipo_chave)?.exemplo ?? 'Escolha o tipo da chave'
  return (
    <div className="space-y-3">
      {mostrarForma && (
        <Campo rotulo="Forma de pagamento padrão" dica="A despesa já vem com esta forma; dá para trocar em cada lançamento.">
          <select value={form.forma_pagamento_padrao} onChange={e => set('forma_pagamento_padrao', e.target.value)} className={cls}>
            {FORMAS_FAVORECIDO.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </Campo>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Campo rotulo="Tipo da chave Pix">
          <select value={form.pix_tipo_chave} onChange={e => set('pix_tipo_chave', e.target.value)} className={cls}>
            <option value="">Sem chave</option>
            {TIPOS_CHAVE.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Chave Pix" className="col-span-2">
          <input value={form.pix_chave} onChange={e => set('pix_chave', e.target.value)} disabled={!form.pix_tipo_chave}
            placeholder={exemplo} className={`${cls} disabled:bg-gray-50`} autoComplete="off" />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Campo rotulo="Banco" dica="Código (341, 033…)">
          <input value={form.banco_codigo} onChange={e => set('banco_codigo', e.target.value.replace(/\D/g, '').slice(0, 3))}
            inputMode="numeric" className={cls} />
        </Campo>
        <Campo rotulo="Agência">
          <input value={form.agencia} onChange={e => set('agencia', e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric" className={cls} />
        </Campo>
        <Campo rotulo="Dígito ag.">
          <input value={form.agencia_dv} onChange={e => set('agencia_dv', e.target.value.slice(0, 1))} className={cls} />
        </Campo>
        <Campo rotulo="Conta" className="sm:col-span-2">
          <input value={form.conta} onChange={e => set('conta', e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 12))}
            className={cls} autoComplete="off" />
        </Campo>
        <Campo rotulo="Dígito">
          <input value={form.conta_dv} onChange={e => set('conta_dv', e.target.value.slice(0, 1))} className={cls} />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Tipo de conta">
          <select value={form.tipo_conta} onChange={e => set('tipo_conta', e.target.value)} className={cls}>
            {TIPOS_CONTA.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="ISPB" dica="Só para corretora, financeira ou cooperativa sem código de banco">
          <input value={form.ispb} onChange={e => set('ispb', e.target.value.replace(/\D/g, '').slice(0, 8))}
            inputMode="numeric" className={cls} />
        </Campo>
      </div>
    </div>
  )
}
