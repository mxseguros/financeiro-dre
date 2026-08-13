'use client'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { fmtBRL, mesAtual } from '@/lib/utils'
import { Skeleton } from '@/components/ui/Skeleton'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { DREResponse, LinhasDRE } from '@/types'

interface ReceitaTipo { tipo_nome: string; receita_total: number }
interface ReceitaTipoResponse { items: ReceitaTipo[]; total: number }
interface EvolucaoMes { mes: string; receita: number; despesa: number; resultado: number }

const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function fmtMesCurto(m: string) {
  const [y, mm] = m.split('-')
  return `${MESES_CURTO[Number(mm) - 1]}/${y.slice(2)}`
}

const LINHAS: { key: keyof LinhasDRE; label: string; total?: boolean; deducao?: boolean }[] = [
  { key: 'receita_bruta',             label: 'Receita Bruta',             total: true },
  { key: 'impostos',                  label: '(-) Impostos',              deducao: true },
  { key: 'margem_contribuicao',       label: '= Margem de Contribuição',  total: true },
  { key: 'despesas_fixas',            label: '(-) Despesas Fixas',        deducao: true },
  { key: 'ebitda',                    label: '= EBITDA',                  total: true },
  { key: 'despesas_nao_operacionais', label: '(-) Desp. Não Operacionais',deducao: true },
  { key: 'resultado_liquido',         label: '= Resultado Líquido',       total: true },
]

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 shrink-0 text-xs text-gray-500">{label}</span>
      <input
        type="month"
        value={value.slice(0, 7)}
        onChange={(e) => {
          const [y, m] = e.target.value.split('-')
          const lastDay = new Date(Number(y), Number(m), 0).getDate()
          onChange(label === 'De' ? `${y}-${m}-01` : `${y}-${m}-${lastDay}`)
        }}
        className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 focus:border-navy focus-ring focus:outline-none"
      />
    </div>
  )
}

export default function DrePage() {
  const { token } = useAuth()
  const [[inicio, fim], setPeriodo] = useState(mesAtual())
  const [dre, setDre] = useState<DREResponse | null>(null)
  const [tipos, setTipos] = useState<ReceitaTipo[]>([])
  const [evolucao, setEvolucao] = useState<EvolucaoMes[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const buscar = useCallback(() => {
    if (!token) return
    setLoading(true); setErro(null)
    api.get<DREResponse>(`/dre?inicio=${inicio}&fim=${fim}`, token)
      .then(d => {
        setDre(d)
        Promise.all([
          api.get<ReceitaTipoResponse>(`/dre/tipos?inicio=${inicio}&fim=${fim}`, token)
            .then(r => setTipos(r.items ?? [])).catch(() => setTipos([])),
          api.get<{ items: EvolucaoMes[] }>(`/dre/evolucao?inicio=${inicio}&fim=${fim}`, token)
            .then(r => setEvolucao(r.items ?? [])).catch(() => setEvolucao([])),
        ])
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [token, inicio, fim])

  // Auto-consulta ao mudar o período (sem precisar clicar em Consultar)
  useEffect(() => { buscar() }, [buscar])

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-xl font-bold text-navy md:text-2xl">DRE</h1>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <DateInput label="De"  value={inicio} onChange={(v) => setPeriodo([v, fim])} />
          <DateInput label="Até" value={fim}    onChange={(v) => setPeriodo([inicio, v])} />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton variant="table" className="h-80" />
          <Skeleton variant="card" className="h-80" />
        </div>
      ) : erro ? (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-600">{erro}</p>
      ) : dre ? (
        <>
        {/* Evolução mensal — visível quando o período cobre mais de um mês */}
        {evolucao.length > 1 && (
          <div className="rounded-2xl bg-white p-4 shadow-sm md:p-6">
            <h2 className="mb-4 font-semibold text-navy">Evolução Mensal</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={evolucao} margin={{ left: -10, bottom: 0 }}>
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickFormatter={fmtMesCurto} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(v: number) => fmtBRL(v)}
                  labelFormatter={(m: string) => fmtMesCurto(m)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receita"   fill="#16a34a" radius={[4,4,0,0]} name="Receita" />
                <Bar dataKey="despesa"   fill="#dc2626" radius={[4,4,0,0]} name="Despesa" />
                <Bar dataKey="resultado" fill="#071934" radius={[4,4,0,0]} name="Resultado" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Tabela DRE */}
          <div className="overflow-hidden rounded-2xl bg-white p-4 shadow-sm md:p-6">
            <h2 className="mb-4 font-semibold text-navy">Demonstração de Resultados</h2>
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {LINHAS.map(({ key, label, total, deducao }) => {
                  const valor = dre.dre[key]
                  if (valor == null) return null
                  const negativo = valor < 0
                  return (
                    <tr key={key} className={total ? 'border-t-2 border-gray-100' : ''}>
                      <td className={`py-1.5 pr-4 ${total ? 'font-semibold text-navy' : 'pl-3 text-gray-600'}`}>
                        {label}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums font-${total ? 'semibold' : 'normal'} ${
                        deducao || negativo ? 'text-red-500' : total ? 'text-navy' : 'text-gray-700'
                      }`}>
                        {deducao && valor !== 0 ? `- R$ ${Math.abs(valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : fmtBRL(valor)}
                      </td>
                    </tr>
                  )
                })}

              </tbody>
            </table>
            </div>
          </div>

          {/* Gráfico receita por tipo de lançamento */}
          <div className="rounded-2xl bg-white p-4 shadow-sm md:p-6">
            <h2 className="mb-4 font-semibold text-navy">Despesas por Tipo de Lançamento</h2>
            {tipos.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={tipos} margin={{ left: -10, bottom: 10 }}>
                  <XAxis dataKey="tipo_nome" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={55} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtBRL(v)} />
                  <Bar dataKey="receita_total" fill="#071934" radius={[4,4,0,0]} name="Despesas" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                Sem despesas lançadas no período
              </div>
            )}
          </div>
        </div>
        </>
      ) : null}
    </div>
  )
}
