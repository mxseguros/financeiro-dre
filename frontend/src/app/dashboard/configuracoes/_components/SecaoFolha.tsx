// Configurações → Folha (0049, 25/11/2026) — só Admin.
// Tabelas de INSS e IRRF por ano, percentuais (FGTS, INSS patronal, VT),
// vencimentos e em que subitem cada rubrica da folha vira despesa.
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'
import { Button, Spinner } from '@/components/ui/Button'
import { inputCls } from './shared'

type Faixa = { ate: number | null; aliquota: number; deducao?: number }
interface Params {
  ano: number; ano_vigente: number | null; conferido: boolean; observacao?: string
  inss_faixas: Faixa[]; irrf_faixas: Faixa[]
  irrf_deducao_dependente: number; irrf_desconto_simplificado: number
  irrf_redutor: { isencao_ate: number; reducao_max: number; parcial_ate: number; a: number; b: number }
  fgts_pct: number; inss_patronal_pct: number; vt_desconto_pct: number
  salario_familia_cota: number; salario_familia_limite: number
  vencimentos: Record<string, number>
}
interface Rubrica { rubrica: string; nome: string; subitem_id: string | null }
interface Subitem { id: string; nome: string; natureza: string; ativo?: boolean }

const VENC: Record<string, string> = {
  salario_dia_util: 'Salário: dia útil do mês seguinte', fgts_dia: 'FGTS: dia do mês seguinte',
  inss_dia: 'INSS: dia do mês seguinte', irrf_dia: 'IRRF: dia do mês seguinte',
  beneficios_dia_util: 'VT/VA: dia útil do mês', plano_saude_dia: 'Plano de saúde: dia do mês',
}

function Num({ valor, onChange, passo = '0.01', largura = 'w-28' }: {
  valor: number | null | undefined; onChange: (v: number | null) => void; passo?: string; largura?: string
}) {
  return (
    <input type="number" step={passo} value={valor ?? ''} className={`${inputCls} ${largura}`}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  )
}

function Tabela({ titulo, faixas, comDeducao, onChange }: {
  titulo: string; faixas: Faixa[]; comDeducao?: boolean; onChange: (f: Faixa[]) => void
}) {
  const muda = (i: number, k: keyof Faixa, v: number | null) =>
    onChange(faixas.map((f, j) => (j === i ? { ...f, [k]: v } : f)))
  return (
    <div>
      <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <table className="text-sm">
        <thead>
          <tr className="text-left text-[13px] text-gray-500">
            <th className="pr-2 font-medium">Até (R$)</th><th className="pr-2 font-medium">Alíquota %</th>
            {comDeducao && <th className="pr-2 font-medium">Dedução (R$)</th>}<th />
          </tr>
        </thead>
        <tbody>
          {faixas.map((f, i) => (
            <tr key={i}>
              <td className="py-0.5 pr-2"><Num valor={f.ate} onChange={v => muda(i, 'ate', v)} /></td>
              <td className="py-0.5 pr-2"><Num valor={f.aliquota} onChange={v => muda(i, 'aliquota', v ?? 0)} largura="w-20" /></td>
              {comDeducao && <td className="py-0.5 pr-2"><Num valor={f.deducao} onChange={v => muda(i, 'deducao', v ?? 0)} /></td>}
              <td><button type="button" onClick={() => onChange(faixas.filter((_, j) => j !== i))}
                aria-label="Remover faixa" className="px-1 text-gray-300 hover:text-red-500">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...faixas, { ate: null, aliquota: 0, ...(comDeducao ? { deducao: 0 } : {}) }])}
        className="mt-1 text-[13px] font-medium text-navy hover:underline">+ Faixa</button>
      {comDeducao && <p className="focus-ring inline-flex min-h-11 items-center rounded px-1 text-[13px] text-slate-500">Última faixa sem &quot;Até&quot; = acima da anterior.</p>}
    </div>
  )
}

export function SecaoFolha({ token }: { token: string }) {
  const [ano, setAno] = useState(new Date().getFullYear())
  const [p, setP] = useState<Params | null>(null)
  const [rubricas, setRubricas] = useState<Rubrica[]>([])
  const [subitens, setSubitens] = useState<Subitem[]>([])
  const [salvando, setSalvando] = useState(false)
  const toast = useToast()

  const carregar = useCallback(() => {
    setP(null)
    api.get<Params>(`/configuracoes/folha/parametros?ano=${ano}`, token).then(setP).catch(() => {})
    api.get<Rubrica[]>('/configuracoes/folha/rubricas', token).then(setRubricas).catch(() => {})
    api.get<Subitem[]>('/configuracoes/tipos', token)
      .then(t => setSubitens(t.filter(x => x.natureza === 'despesa' && x.ativo !== false))).catch(() => {})
  }, [ano, token])
  useEffect(() => { carregar() }, [carregar])

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP(x => (x ? { ...x, [k]: v } : x))

  async function salvarParametros() {
    if (!p) return
    setSalvando(true)
    try {
      const { ano: _a, ano_vigente: _v, conferido, observacao: _o, ...dados } = p
      setP(await api.put<Params>('/configuracoes/folha/parametros', token, { ano, dados, conferido }))
      toast.sucesso(`Tabelas de ${ano} salvas.`)
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function salvarRubricas() {
    try {
      const mapa = Object.fromEntries(rubricas.map(r => [r.rubrica, r.subitem_id || null]))
      setRubricas(await api.put<Rubrica[]>('/configuracoes/folha/rubricas', token, { mapa }))
      toast.sucesso('Subitens da folha salvos.')
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao salvar.')
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-navy">Tabelas da folha</h3>
            <select value={ano} onChange={e => setAno(Number(e.target.value))} className={`${inputCls} w-24`} aria-label="Ano">
              {[0, 1, -1].map(d => new Date().getFullYear() + d).sort().map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {p && (
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={p.conferido} onChange={e => set('conferido', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy" />
              Conferido com o contador
            </label>
          )}
        </div>
        {!p ? <div className="py-8 text-center"><Spinner className="text-navy" /></div> : (
          <>
            {(!p.conferido || p.ano_vigente !== ano) && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
                {p.ano_vigente === null
                  ? `Valores de partida (${p.observacao ?? 'a conferir'}).`
                  : p.ano_vigente !== ano ? `Sem tabela de ${ano}: valendo a de ${p.ano_vigente}. Salvar cria a de ${ano}.`
                  : 'Ainda não conferido com o contador.'}
              </p>
            )}
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <Tabela titulo="INSS do empregado (progressivo)" faixas={p.inss_faixas} onChange={f => set('inss_faixas', f)} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[13px] text-gray-600">FGTS %<Num valor={p.fgts_pct} onChange={v => set('fgts_pct', v ?? 0)} /></label>
                  <label className="text-[13px] text-gray-600" title="Simples Nacional Anexo III: 0 (já está no DAS)">
                    INSS patronal % <span className="text-slate-500">(0 no Simples)</span>
                    <Num valor={p.inss_patronal_pct} onChange={v => set('inss_patronal_pct', v ?? 0)} />
                  </label>
                  <label className="text-[13px] text-gray-600">Desconto VT %<Num valor={p.vt_desconto_pct} onChange={v => set('vt_desconto_pct', v ?? 0)} /></label>
                  <label className="text-[13px] text-gray-600">Salário-família: cota<Num valor={p.salario_familia_cota} onChange={v => set('salario_familia_cota', v ?? 0)} /></label>
                  <label className="text-[13px] text-gray-600">Salário-família: renda até<Num valor={p.salario_familia_limite} onChange={v => set('salario_familia_limite', v ?? 0)} /></label>
                </div>
              </div>
              <div className="space-y-4">
                <Tabela titulo="IRRF (mensal)" faixas={p.irrf_faixas} comDeducao onChange={f => set('irrf_faixas', f)} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[13px] text-gray-600">Dedução por dependente<Num valor={p.irrf_deducao_dependente} onChange={v => set('irrf_deducao_dependente', v ?? 0)} /></label>
                  <label className="text-[13px] text-gray-600">Desconto simplificado<Num valor={p.irrf_desconto_simplificado} onChange={v => set('irrf_desconto_simplificado', v ?? 0)} /></label>
                </div>
                <div>
                  <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500">Redutor de 2026</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {([['isencao_ate', 'Zera até (R$)'], ['reducao_max', 'Redução máx. (R$)'], ['parcial_ate', 'Reduz até (R$)'],
                       ['a', 'Fórmula: a'], ['b', 'Fórmula: b']] as const).map(([k, r]) => (
                      <label key={k} className="text-[13px] text-gray-600">{r}
                        <Num valor={p.irrf_redutor[k]} passo={k === 'b' ? '0.000001' : '0.01'}
                          onChange={v => set('irrf_redutor', { ...p.irrf_redutor, [k]: v ?? 0 })} />
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[13px] text-slate-500">Entre &quot;zera até&quot; e &quot;reduz até&quot;: redução = a − b × rendimento.</p>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500">Vencimentos</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(VENC).map(([k, r]) => (
                  <label key={k} className="text-[13px] text-gray-600">{r}
                    <Num valor={p.vencimentos?.[k]} passo="1" largura="w-20"
                      onChange={v => set('vencimentos', { ...p.vencimentos, [k]: v ?? 1 })} />
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={salvarParametros} loading={salvando}>Salvar tabelas de {ano}</Button>
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-navy">Em que subitem cada parte da folha é lançada</h3>
        <p className="text-[13px] text-slate-500">Usado ao gerar a folha do mês. Salários e encargos devem ser subitens confidenciais.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {rubricas.map(r => (
            <label key={r.rubrica} className="flex items-center justify-between gap-3 text-sm text-gray-700">
              <span>{r.nome}</span>
              <select value={r.subitem_id ?? ''} className={`${inputCls} max-w-[60%]`}
                onChange={e => setRubricas(rs => rs.map(x => (x.rubrica === r.rubrica ? { ...x, subitem_id: e.target.value || null } : x)))}>
                <option value="">— não lançar —</option>
                {subitens.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="secondary" onClick={salvarRubricas}>Salvar subitens</Button>
        </div>
      </div>
    </div>
  )
}
