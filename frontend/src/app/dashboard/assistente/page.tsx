'use client'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { Skeleton } from '@/components/ui/Skeleton'

type Severidade = 'critico' | 'aviso' | 'info'
interface Insight {
  tipo: string
  severidade: Severidade
  titulo: string
  detalhe: string
  valor?: number | null
}
interface InsightsResp {
  gerado_em: string
  resumo: Record<Severidade, number>
  total: number
  insights: Insight[]
}
interface ResumoResp { resumo: string | null; gerado_por_ia: boolean; erro?: string }

const SEV_CARD: Record<Severidade, string> = {
  critico: 'border-red-200 bg-red-50',
  aviso:   'border-amber-200 bg-amber-50',
  info:    'border-blue-200 bg-blue-50',
}
const SEV_DOT: Record<Severidade, string> = {
  critico: 'bg-red-500', aviso: 'bg-amber-500', info: 'bg-blue-500',
}
const SEV_LABEL: Record<Severidade, string> = {
  critico: 'Crítico', aviso: 'Atenção', info: 'Info',
}
const TIPO_LABEL: Record<string, string> = {
  duplicata:        'Duplicata',
  pendente_despesa: 'Pendente',
  ordem_pendente:   'Ordem pendente',
  outlier:          'Valor atípico',
  sem_banco:        'Sem banco',
  gap_recorrencia:  'Gap recorrência',
}

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

function nomeDataHora(iso: string) {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

export default function MonitorPage() {
  const { token } = useAuth()
  const [data, setData] = useState<InsightsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [resumo, setResumo] = useState<string | null>(null)
  const [resumindo, setResumindo] = useState(false)

  const buscar = useCallback(() => {
    if (!token) return
    setLoading(true); setErro(null); setResumo(null)
    api.get<InsightsResp>('/monitor/insights', token)
      .then(setData)
      .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar o Monitor.'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { buscar() }, [buscar])

  function gerarResumo() {
    if (!token) return
    setResumindo(true); setResumo(null)
    api.get<ResumoResp>('/monitor/resumo', token)
      .then(r => setResumo(r.resumo ?? r.erro ?? 'Sem resumo disponível.'))
      .catch(e => setResumo(e instanceof Error ? e.message : 'Falha ao gerar o resumo.'))
      .finally(() => setResumindo(false))
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy md:text-2xl">Monitoramento IA</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Pontos de atenção nos apontamentos — duplicatas, pendências e valores atípicos
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && !loading && (
            <span className="text-xs text-gray-400">Atualizado {nomeDataHora(data.gerado_em)}</span>
          )}
          {data && !loading && data.total > 0 && (
            <button onClick={gerarResumo} disabled={resumindo}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {resumindo ? 'Gerando…' : '✨ Resumo com IA'}
            </button>
          )}
          <button onClick={buscar} disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-50">
            <IconRefresh /> Atualizar
          </button>
        </div>
      </div>

      {/* Resumo por severidade */}
      {data && !loading && (
        <div className="grid grid-cols-3 gap-3">
          {(['critico', 'aviso', 'info'] as Severidade[]).map(sev => (
            <div key={sev} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${SEV_DOT[sev]}`} />
                <p className="text-xs font-medium text-gray-500">{SEV_LABEL[sev]}</p>
              </div>
              <p className="mt-1 text-2xl font-bold text-navy">{data.resumo[sev] ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Resumo executivo por IA (sob demanda) */}
      {resumo && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="mb-2 text-sm font-semibold text-indigo-900">✨ Resumo por IA</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-indigo-800">{resumo}</div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} variant="card" />)}
        </div>
      ) : erro ? (
        <div className="flex items-center justify-between rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
          <span>{erro}</span>
          <button onClick={buscar} className="ml-4 shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Tentar novamente
          </button>
        </div>
      ) : data && data.insights.length === 0 ? (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <p className="text-3xl">🎉</p>
          <p className="mt-2 text-sm font-medium text-green-700">Nenhum ponto de atenção encontrado</p>
          <p className="mt-1 text-xs text-green-600">Os apontamentos do período estão sem duplicatas, pendências antigas ou valores atípicos.</p>
        </div>
      ) : data ? (
        <div className="space-y-3">
          {data.insights.map((i, idx) => (
            <div key={idx} className={`flex items-start gap-3 rounded-2xl border p-4 ${SEV_CARD[i.severidade]}`}>
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEV_DOT[i.severidade]}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-navy">{i.titulo}</span>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                    {TIPO_LABEL[i.tipo] ?? i.tipo}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-gray-600">{i.detalhe}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
