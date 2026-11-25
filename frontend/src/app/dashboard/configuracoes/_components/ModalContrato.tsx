// Contrato e salário do funcionário (0049, 25/11/2026) — só Admin.
// À esquerda o cadastro; à direita o cálculo do mês ao vivo: bruto, INSS,
// IRRF, líquido, FGTS, benefícios e o custo total para a empresa.
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { fmtBRL } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button, Spinner } from '@/components/ui/Button'
import { InputMoeda } from '@/components/ui/InputMoeda'
import { useToast } from '@/components/ui/Toast'
import type { Funcionario } from '@/lib/funcionarios'
import { ROTULOS, TIPOS_CONTRATO, type CalculoFolha, type Contrato, type ContratoResp, type TipoContrato } from '@/lib/folha'
import { inputCls } from './shared'

type Form = {
  tipo_contrato: TipoContrato; cargo: string; data_admissao: string; data_desligamento: string
  salario_base: string; noturno_pct: string; insalubridade: string; periculosidade_pct: string
  dependentes_ir: string; filhos_salario_familia: string; pensao_alimenticia: string
  vt_custo_mensal: string; vt_descontar: boolean; va_valor: string
  plano_saude_empresa: string; plano_saude_desconto: string; seguro_vida: string
  sindical: string; banco_pagamento: string
  outros: { nome: string; valor: string }[]
}

const s = (v: number | null | undefined) => (v ? String(v) : '')
const n = (v: string) => (parseFloat(v) || 0)

function paraForm(c: ContratoResp): Form {
  const ad = c.adicionais ?? {}
  return {
    tipo_contrato: c.tipo_contrato, cargo: c.cargo ?? '', data_admissao: c.data_admissao ?? '',
    data_desligamento: c.data_desligamento ?? '', salario_base: s(c.salario_base),
    noturno_pct: s(ad.noturno?.pct), insalubridade: s(ad.insalubridade?.valor), periculosidade_pct: s(ad.periculosidade?.pct),
    dependentes_ir: String(c.dependentes_ir ?? 0), filhos_salario_familia: String(c.filhos_salario_familia ?? 0),
    pensao_alimenticia: s(c.pensao_alimenticia), vt_custo_mensal: s(c.vt_custo_mensal), vt_descontar: c.vt_descontar,
    va_valor: s(c.va_valor), plano_saude_empresa: s(c.plano_saude_empresa), plano_saude_desconto: s(c.plano_saude_desconto),
    seguro_vida: s(c.seguro_vida), sindical: s(c.sindical?.valor), banco_pagamento: c.banco_pagamento ?? '',
    outros: (c.outros_beneficios ?? []).map(o => ({ nome: o.nome, valor: s(o.valor) })),
  }
}

function paraContrato(f: Form): Contrato {
  const adicionais: Contrato['adicionais'] = {}
  if (n(f.noturno_pct)) adicionais.noturno = { pct: n(f.noturno_pct) }
  if (n(f.insalubridade)) adicionais.insalubridade = { valor: n(f.insalubridade) }
  if (n(f.periculosidade_pct)) adicionais.periculosidade = { pct: n(f.periculosidade_pct) }
  return {
    tipo_contrato: f.tipo_contrato, cargo: f.cargo.trim() || null,
    data_admissao: f.data_admissao || null, data_desligamento: f.data_desligamento || null,
    salario_base: n(f.salario_base), adicionais,
    dependentes_ir: parseInt(f.dependentes_ir) || 0, filhos_salario_familia: parseInt(f.filhos_salario_familia) || 0,
    pensao_alimenticia: n(f.pensao_alimenticia), vt_custo_mensal: n(f.vt_custo_mensal), vt_descontar: f.vt_descontar,
    va_valor: n(f.va_valor), plano_saude_empresa: n(f.plano_saude_empresa), plano_saude_desconto: n(f.plano_saude_desconto),
    seguro_vida: n(f.seguro_vida),
    outros_beneficios: f.outros.filter(o => o.nome.trim() && n(o.valor)).map(o => ({ nome: o.nome.trim(), valor: n(o.valor) })),
    sindical: n(f.sindical) ? { valor: n(f.sindical) } : {}, banco_pagamento: f.banco_pagamento.trim() || null,
  }
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{titulo}</legend>
      {children}
    </fieldset>
  )
}

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-gray-600">{rotulo}</span>
      {children}
      {dica && <span className="mt-0.5 block text-[11px] text-gray-400">{dica}</span>}
    </label>
  )
}

function Linhas({ itens, sinal = '' }: { itens: Record<string, number>; sinal?: string }) {
  const linhas = Object.entries(itens).filter(([, v]) => v)
  if (!linhas.length) return null
  return (
    <>
      {linhas.map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs text-gray-600">
          <span>{ROTULOS[k] ?? k}</span><span className="tabular-nums">{sinal}{fmtBRL(v)}</span>
        </div>
      ))}
    </>
  )
}

function Previa({ c, carregando }: { c: CalculoFolha | null; carregando: boolean }) {
  if (!c) return <div className="flex h-40 items-center justify-center"><Spinner className="text-navy" /></div>
  const ir = c.irrf_detalhe
  return (
    <div className={`space-y-3 transition-opacity ${carregando ? 'opacity-60' : ''}`}>
      {!c.parametros_conferidos && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          Tabelas de INSS/IRRF ainda não conferidas com o contador (Configurações → Folha).
        </p>
      )}
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase text-gray-400">Funcionário recebe</p>
        <Linhas itens={c.proventos} />
        {c.salario_familia > 0 && <Linhas itens={{ 'Salário-família': c.salario_familia }} />}
        <div className="flex justify-between border-t border-gray-100 pt-1 text-xs font-medium text-gray-700">
          <span>Bruto</span><span className="tabular-nums">{fmtBRL(c.bruto)}</span>
        </div>
        <Linhas itens={c.descontos} sinal="− " />
        {ir.valor === 0 && ir.redutor > 0 && (
          <p className="text-[11px] text-green-700">IRRF zerado pelo redutor de 2026 (renda até R$ 5 mil).</p>
        )}
        <div className="flex justify-between rounded-lg bg-navy/5 px-2 py-1.5 text-sm font-semibold text-navy">
          <span>Líquido</span><span className="tabular-nums">{fmtBRL(c.liquido)}</span>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase text-gray-400">Empresa paga além do bruto</p>
        <Linhas itens={c.encargos} />
        <Linhas itens={c.beneficios} />
        <div className="flex justify-between rounded-lg bg-green-50 px-2 py-1.5 text-sm font-semibold text-green-800">
          <span>Custo do mês</span><span className="tabular-nums">{fmtBRL(c.custo_mes)}</span>
        </div>
        <Linhas itens={c.provisoes} />
        <div className="flex justify-between text-xs font-medium text-gray-700">
          <span title="Custo do mês + provisões de 13º e férias">Custo real (com provisões)</span>
          <span className="tabular-nums">{fmtBRL(c.custo_com_provisoes)}</span>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Guias do mês: FGTS {fmtBRL(c.guias.fgts)} · INSS {fmtBRL(c.guias.inss)} · IRRF {fmtBRL(c.guias.irrf)}</p>
    </div>
  )
}

export function ModalContrato({ token, funcionario, onClose, onSaved }: {
  token: string; funcionario: Funcionario; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<Form | null>(null)
  const [calculo, setCalculo] = useState<CalculoFolha | null>(null)
  const [calculando, setCalculando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    api.get<ContratoResp>(`/configuracoes/funcionarios/${funcionario.id}/contrato`, token)
      .then(r => { setForm(paraForm(r)); setCalculo(r.calculo) })
      .catch(e => setErro(e instanceof Error ? e.message : 'Não foi possível abrir o contrato.'))
  }, [funcionario.id, token])

  // Prévia ao vivo: recalcula meio segundo depois da última digitação.
  useEffect(() => {
    if (!form) return
    setCalculando(true)
    const t = setTimeout(() => {
      api.post<CalculoFolha>('/configuracoes/folha/simular', token, { contrato: paraContrato(form) })
        .then(setCalculo).catch(() => {}).finally(() => setCalculando(false))
    }, 500)
    return () => clearTimeout(t)
  }, [form, token])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => (f ? { ...f, [k]: v } : f))

  async function salvar() {
    if (!form) return
    setSalvando(true); setErro(null)
    try {
      await api.put(`/configuracoes/funcionarios/${funcionario.id}/contrato`, token, paraContrato(form))
      toast.sucesso(`Contrato de ${funcionario.nome} salvo.`)
      onSaved(); onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.')
      setSalvando(false)
    }
  }

  const moeda = (k: keyof Form) => <InputMoeda value={form ? (form[k] as string) : ''} onChange={v => set(k, v as never)} />
  const num = (k: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input type="number" min={0} value={form ? (form[k] as string) : ''} onChange={e => set(k, e.target.value as never)}
      className={inputCls} {...props} />
  )

  return (
    <Modal open onClose={onClose} title={`Contrato e salário — ${funcionario.nome}`} variant="sheet"
      maxWidth="sm:max-w-4xl" dismissable={!salvando}>
      {!form ? (
        erro ? <p className="text-sm text-red-600">{erro}</p> : <div className="flex h-40 items-center justify-center"><Spinner className="text-navy" /></div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <Secao titulo="Contrato">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Campo rotulo="Tipo">
                  <select value={form.tipo_contrato} onChange={e => set('tipo_contrato', e.target.value as TipoContrato)} className={inputCls}>
                    {TIPOS_CONTRATO.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Cargo">
                  <input value={form.cargo} onChange={e => set('cargo', e.target.value)} className={inputCls} />
                </Campo>
                <Campo rotulo="Admissão">
                  <input type="date" value={form.data_admissao} onChange={e => set('data_admissao', e.target.value)} className={inputCls} />
                </Campo>
                <Campo rotulo="Desligamento">
                  <input type="date" value={form.data_desligamento} onChange={e => set('data_desligamento', e.target.value)} className={inputCls} />
                </Campo>
              </div>
            </Secao>

            <Secao titulo="Remuneração">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Campo rotulo="Salário base">{moeda('salario_base')}</Campo>
                <Campo rotulo="Adic. noturno (%)">{num('noturno_pct', { step: '0.1' })}</Campo>
                <Campo rotulo="Insalubridade (R$)">{moeda('insalubridade')}</Campo>
                <Campo rotulo="Periculosidade (%)">{num('periculosidade_pct', { step: '0.1' })}</Campo>
              </div>
              {form.tipo_contrato !== 'clt' && (
                <p className="text-[11px] text-amber-600">
                  O cálculo segue a regra CLT. Para {TIPOS_CONTRATO.find(t => t.id === form.tipo_contrato)?.nome}, confira com o contador.
                </p>
              )}
            </Secao>

            <Secao titulo="Imposto de renda e família">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Campo rotulo="Dependentes (IR)">{num('dependentes_ir', { max: 20 })}</Campo>
                <Campo rotulo="Filhos (salário-família)" dica="Até 14 anos">{num('filhos_salario_familia', { max: 20 })}</Campo>
                <Campo rotulo="Pensão alimentícia">{moeda('pensao_alimenticia')}</Campo>
              </div>
            </Secao>

            <Secao titulo="Benefícios e descontos">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Campo rotulo="Vale-transporte (custo/mês)">{moeda('vt_custo_mensal')}</Campo>
                <Campo rotulo="Vale-alimentação / refeição">{moeda('va_valor')}</Campo>
                <Campo rotulo="Seguro de vida">{moeda('seguro_vida')}</Campo>
                <Campo rotulo="Plano de saúde (empresa)">{moeda('plano_saude_empresa')}</Campo>
                <Campo rotulo="Plano de saúde (desconto)" dica="Parte do funcionário">{moeda('plano_saude_desconto')}</Campo>
                <Campo rotulo="Contribuição sindical">{moeda('sindical')}</Campo>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={form.vt_descontar} onChange={e => set('vt_descontar', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
                Descontar até 6% do salário pelo vale-transporte
              </label>
              <div className="space-y-1.5">
                {form.outros.map((o, i) => (
                  <div key={i} className="flex gap-2">
                    <input value={o.nome} placeholder="Outro benefício (ex.: auxílio-creche)" aria-label="Nome do benefício"
                      onChange={e => set('outros', form.outros.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))}
                      className={`${inputCls} flex-1`} />
                    <div className="w-36"><InputMoeda value={o.valor}
                      onChange={v => set('outros', form.outros.map((x, j) => (j === i ? { ...x, valor: v } : x)))} /></div>
                    <button type="button" onClick={() => set('outros', form.outros.filter((_, j) => j !== i))}
                      aria-label="Remover benefício" className="px-1 text-gray-400 hover:text-red-500">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => set('outros', [...form.outros, { nome: '', valor: '' }])}
                  className="text-xs font-medium text-navy hover:underline">+ Outro benefício</button>
              </div>
            </Secao>

            <Secao titulo="Pagamento">
              <Campo rotulo="Conta / chave PIX" dica="Aparece na despesa do salário líquido">
                <input value={form.banco_pagamento} onChange={e => set('banco_pagamento', e.target.value)} className={inputCls} />
              </Campo>
            </Secao>
          </div>

          <aside className="rounded-xl border border-gray-100 bg-gray-50 p-3 md:sticky md:top-0 md:self-start">
            <p className="mb-2 text-sm font-semibold text-navy">Cálculo do mês</p>
            <Previa c={calculo} carregando={calculando} />
          </aside>
        </div>
      )}
      {erro && form && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{erro}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
        <Button type="button" onClick={salvar} loading={salvando} disabled={!form}>Salvar contrato</Button>
      </div>
    </Modal>
  )
}
