import Link from 'next/link'
import { fmtBRL } from '@/lib/utils'

/** Espelho de app/services/conciliacao_service.py. */
interface Subitem { nome: string; qtd: number; valor: number }
interface Motivo {
  chave: string
  rotulo: string
  qtd: number
  valor: number
  explicacao: string
  subitens: Subitem[]
  acao: 'revisar_classificacao' | 'classificar' | 'corrigir_visao_geral' | null
}
export type Conciliacao =
  | { disponivel: false; motivo: string }
  | {
      disponivel: true
      mes: string
      receita_visao_geral: number
      receita_dre: number
      diferenca: number
      motivos: Motivo[]
      nao_explicado: number
      despesas_sem_grupo: { qtd: number; valor: number; subitens: Subitem[] }
    }

const ACAO: Record<NonNullable<Motivo['acao']>, { rotulo: string; cls: string; href?: string }> = {
  revisar_classificacao: { rotulo: 'Revisar classificação', cls: 'bg-amber-100 text-amber-800', href: '/dashboard/configuracoes' },
  classificar:           { rotulo: 'Corrigir cadastro',     cls: 'bg-red-100 text-red-700',     href: '/dashboard/configuracoes' },
  corrigir_visao_geral:  { rotulo: 'Ajuste no sistema',     cls: 'bg-gray-100 text-gray-700' },
}

function Numero({ rotulo, sub, valor, destaque }: { rotulo: string; sub: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${destaque ? 'bg-navy text-white' : 'bg-gray-50'}`}>
      <p className={`text-xs font-medium ${destaque ? 'text-white/70' : 'text-gray-500'}`}>{rotulo}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${destaque ? 'text-white' : 'text-navy'}`}>{fmtBRL(valor)}</p>
      <p className={`mt-0.5 text-[11px] ${destaque ? 'text-white/60' : 'text-gray-400'}`}>{sub}</p>
    </div>
  )
}

/**
 * Explica ao analista por que a receita da Visão Geral (Receita Bruta Prevista)
 * difere da linha Receita da DRE: os motivos somam exatamente a diferença.
 */
export function ConciliacaoDre({ c, rotuloMes }: { c: Conciliacao; rotuloMes: string }) {
  return (
    <section data-tour="conciliacao" className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-navy">Visão Geral × DRE · {rotuloMes}</h2>
        <p className="mt-0.5 text-xs text-gray-500">Por que a receita é diferente nas duas telas</p>
      </div>

      {!c.disponivel ? (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">{c.motivo}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Numero rotulo="Visão Geral" sub="Previsto do período · receitas de qualquer grupo" valor={c.receita_visao_geral} />
            <Numero rotulo="DRE" sub="Linha Receita · só 1.1 Receitas de vendas" valor={c.receita_dre} />
            <Numero rotulo="Diferença" sub={c.diferenca ? 'Explicada abaixo' : 'As duas telas batem'} valor={c.diferenca} destaque />
          </div>

          {c.diferenca === 0 && c.motivos.length === 0 && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              Neste mês a Visão Geral e a DRE mostram a mesma receita.
            </p>
          )}

          {c.motivos.map(m => (
            <div key={m.chave} className="rounded-xl border border-gray-100 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">
                    {m.rotulo} <span className="font-normal text-gray-400">· {m.qtd} lançamento(s)</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{m.explicacao}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.acao && (ACAO[m.acao].href ? (
                    <Link href={ACAO[m.acao].href!} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ACAO[m.acao].cls}`}>
                      {ACAO[m.acao].rotulo}
                    </Link>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ACAO[m.acao].cls}`}>{ACAO[m.acao].rotulo}</span>
                  ))}
                  <span className="text-sm font-bold tabular-nums text-navy">{fmtBRL(m.valor)}</span>
                </div>
              </div>
              {m.subitens.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.subitens.map(s => (
                    <span key={s.nome} className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                      {s.nome} · {s.qtd} · {fmtBRL(s.valor)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {c.nao_explicado !== 0 && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <b>Diferença não explicada: {fmtBRL(c.nao_explicado)}.</b> Alguma regra de uma das telas não está
              coberta por esta conciliação — encaminhe para revisão do sistema.
            </p>
          )}

          {c.despesas_sem_grupo.qtd > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p>
                <b>Despesas fora da DRE: {c.despesas_sem_grupo.qtd} lançamento(s), {fmtBRL(c.despesas_sem_grupo.valor)}.</b>{' '}
                Não mudam a receita, mas a DRE as deixa fora de todos os totais (inclusive do Resultado líquido).{' '}
                <Link href="/dashboard/lancamentos" className="font-medium underline">Classificar em Lançamentos</Link>
              </p>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-gray-400">
            Como ler: a Visão Geral soma toda receita lançada no mês, de qualquer classificação. A linha Receita da DRE
            considera só o grupo 1.1 Receitas de vendas; as demais receitas aparecem mais abaixo na DRE (ex.: 8.1 Receitas
            não operacionais, que entram no Resultado líquido).
          </p>
        </div>
      )}
    </section>
  )
}
