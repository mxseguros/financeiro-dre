'use client'
import { FILTRO_CAMPO } from '@/components/ui/filtros'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { useUser } from '@/contexts/UserContext'
import { usePeriodo } from '@/contexts/PeriodoContext'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { brl } from '@/components/dre/formato'
import { MESES, MESES_LONGOS } from '@/components/dre/tipos'

interface Conta { id: string; nome: string; ativo: boolean }
interface Grupo { codigo: string; nome: string; natureza: string; contas: Conta[] }
interface OrcamentoResp { ano: number; grupos: Grupo[]; valores: Record<string, Record<string, number>> }

const ANO_ATUAL = new Date().getFullYear()
const ANOS = Array.from({ length: 6 }, (_, i) => ANO_ATUAL - 2 + i)
const chave = (contaId: string, mes: number) => `${contaId}:${mes}`
const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Aceita o que vem do Excel/teclado: "R$ 1.234,56", "1234,56", "1234.56", "-500". */
function lerNumero(txt: string): number | null {
  const s = txt.replace(/R\$|\s/g, '').trim()
  if (!s) return 0
  // Com vírgula, o ponto é milhar (pt-BR); sem vírgula, o ponto é decimal.
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

export default function MetasPage() {
  const { token } = useAuth()
  const { role } = useUser()
  const podeEditar = role === 'admin' || role === 'gestor'
  const { mesInicio } = usePeriodo()
  const [ano, setAno] = useState(Number(mesInicio.slice(0, 4)))

  const [dados, setDados] = useState<OrcamentoResp | null>(null)
  const [celulas, setCelulas] = useState<Record<string, string>>({})
  const [original, setOriginal] = useState<Record<string, number>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [mesBase, setMesBase] = useState(1)
  const [reajuste, setReajuste] = useState('')

  const carregar = useCallback(() => {
    if (!token) return
    // Não limpa o `aviso` aqui: salvar recarrega a grade logo em seguida, e
    // apagar o aviso nesse momento sumia com a confirmação "N meta(s) salva(s)".
    setErro(null); setDados(null)
    api.get<OrcamentoResp>(`/dre/orcamento?ano=${ano}`, token)
      .then(d => {
        const orig: Record<string, number> = {}
        const cel: Record<string, string> = {}
        for (const g of d.grupos) for (const c of g.contas) for (let m = 1; m <= 12; m++) {
          const v = d.valores[c.id]?.[m] ?? 0
          orig[chave(c.id, m)] = v
          cel[chave(c.id, m)] = v ? fmt.format(v) : ''
        }
        setOriginal(orig); setCelulas(cel); setDados(d)
      })
      .catch((e: Error) => setErro(e.message))
  }, [token, ano])

  useEffect(() => { carregar() }, [carregar])

  // Ordem das linhas da grade — base para colar blocos e para as ações em massa.
  const contas = useMemo(() => dados?.grupos.flatMap(g => g.contas) ?? [], [dados])
  const valor = (id: string, m: number) => lerNumero(celulas[chave(id, m)] ?? '') ?? 0
  const alteradas = useMemo(() => Object.keys(celulas).filter(k => {
    const n = lerNumero(celulas[k])
    return n !== null && Math.abs(n - (original[k] ?? 0)) > 0.004
  }), [celulas, original])
  const invalidas = Object.keys(celulas).filter(k => lerNumero(celulas[k]) === null)

  function definir(id: string, m: number, txt: string) {
    setCelulas(prev => ({ ...prev, [chave(id, m)]: txt }))
  }

  /** Cola um bloco (linhas × colunas separadas por TAB) a partir da célula clicada. */
  function colar(e: React.ClipboardEvent<HTMLInputElement>, id: string, m: number) {
    const texto = e.clipboardData.getData('text/plain')
    if (!texto.includes('\t') && !texto.includes('\n')) return  // valor único: deixa o navegador colar
    e.preventDefault()
    const linhas = texto.replace(/\r/g, '').split('\n').filter((l, i, arr) => l !== '' || i < arr.length - 1)
    const ini = contas.findIndex(c => c.id === id)
    const novo: Record<string, string> = {}
    let fora = 0
    linhas.forEach((linha, i) => {
      const conta = contas[ini + i]
      linha.split('\t').forEach((cel, j) => {
        const mes = m + j
        if (!conta || mes > 12) { fora++; return }
        novo[chave(conta.id, mes)] = cel.trim()
      })
    })
    setCelulas(prev => ({ ...prev, ...novo }))
    setAviso(`${Object.keys(novo).length} célula(s) coladas${fora ? ` · ${fora} ficaram fora da grade e foram ignoradas` : ''}.`)
  }

  function copiarParaSeguintes() {
    const novo: Record<string, string> = {}
    for (const c of contas) {
      const v = celulas[chave(c.id, mesBase)] ?? ''
      for (let m = mesBase + 1; m <= 12; m++) novo[chave(c.id, m)] = v
    }
    setCelulas(prev => ({ ...prev, ...novo }))
    setAviso(`${MESES_LONGOS[mesBase - 1]} copiado para os meses seguintes.`)
  }

  function aplicarReajuste() {
    const p = lerNumero(reajuste)
    if (p === null || p === 0) { setAviso('Informe um percentual de reajuste diferente de zero.'); return }
    const novo: Record<string, string> = {}
    for (const c of contas) for (let m = mesBase; m <= 12; m++) {
      const v = valor(c.id, m)
      if (v) novo[chave(c.id, m)] = fmt.format(v * (1 + p / 100))
    }
    setCelulas(prev => ({ ...prev, ...novo }))
    setAviso(`Reajuste de ${fmt.format(p)}% aplicado de ${MESES_LONGOS[mesBase - 1].toLowerCase()} a dezembro.`)
  }

  async function salvar() {
    if (!token || !alteradas.length) return
    if (invalidas.length) { setErro('Há células com valor inválido (em vermelho). Corrija antes de salvar.'); return }
    setSalvando(true); setErro(null)
    try {
      const itens = alteradas.map(k => {
        const [subitem_id, mes] = k.split(':')
        return { subitem_id, mes: Number(mes), valor: lerNumero(celulas[k]) ?? 0 }
      })
      const r = await api.put<{ salvos: number }>('/dre/orcamento', token, { ano, itens })
      setAviso(`${r.salvos} meta(s) salva(s).`)
      carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar as metas.')
    } finally {
      setSalvando(false)
    }
  }

  const totalGrupo = (g: Grupo, m: number) => g.contas.reduce((s, c) => s + valor(c.id, m), 0)
  const totalConta = (c: Conta) => Array.from({ length: 12 }, (_, i) => valor(c.id, i + 1)).reduce((a, b) => a + b, 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard/dre" className="text-xs font-medium text-blue-600 hover:underline">← DRE</Link>
          <h1 className="mt-1 text-xl font-bold text-navy md:text-2xl">Metas (Previsto)</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Orçamento mensal por conta · {ano}
            {!podeEditar && ' · somente leitura — Admin e Gestor podem editar'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Ano" value={ano} onChange={e => { setAviso(null); setAno(Number(e.target.value)) }}
            className={FILTRO_CAMPO}>
            {ANOS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {podeEditar && (
            <Button onClick={salvar} disabled={!alteradas.length || salvando} loading={salvando}>
              {salvando ? 'Salvando…' : alteradas.length ? `Salvar ${alteradas.length} alteração(ões)` : 'Sem alterações'}
            </Button>
          )}
        </div>
      </div>

      {podeEditar && dados && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-xs text-gray-600 shadow-sm">
          <label className="inline-flex items-center gap-1.5">
            A partir de
            <select value={mesBase} onChange={e => setMesBase(Number(e.target.value))}
              className={FILTRO_CAMPO}>
              {MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <Button variant="secondary" size="sm" onClick={copiarParaSeguintes} disabled={mesBase === 12}>
            Copiar {MESES[mesBase - 1]} para os meses seguintes
          </Button>
          <span className="inline-flex items-center gap-1.5">
            <input value={reajuste} onChange={e => setReajuste(e.target.value)} placeholder="0,0" inputMode="decimal"
              aria-label="Percentual de reajuste"
              className="w-16 rounded-md border border-gray-200 px-2 py-1 text-right tabular-nums focus-ring focus:outline-none" />%
            <Button variant="secondary" size="sm" onClick={aplicarReajuste}>Aplicar reajuste</Button>
          </span>
          <span className="text-gray-400">Dica: copie um bloco no Excel e cole numa célula — ele se espalha pela grade.</span>
        </div>
      )}

      {erro && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{erro}</div>}
      {aviso && !erro && <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">{aviso}</div>}

      {!dados && !erro ? <Skeleton variant="card" /> : dados && (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="sticky left-0 z-10 min-w-[220px] border-b border-gray-100 bg-white px-3 py-2 text-left font-semibold">Conta</th>
                  {MESES.map(m => <th key={m} className="border-b border-gray-100 px-1.5 py-2 text-right font-semibold">{m}</th>)}
                  <th className="border-b border-gray-100 px-2.5 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {dados.grupos.map(g => (
                  <GrupoLinhas key={g.codigo} g={g} celulas={celulas} original={original} podeEditar={podeEditar}
                    definir={definir} colar={colar} totalGrupo={totalGrupo} totalConta={totalConta} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function GrupoLinhas({ g, celulas, original, podeEditar, definir, colar, totalGrupo, totalConta }: {
  g: Grupo
  celulas: Record<string, string>
  original: Record<string, number>
  podeEditar: boolean
  definir: (id: string, m: number, txt: string) => void
  colar: (e: React.ClipboardEvent<HTMLInputElement>, id: string, m: number) => void
  totalGrupo: (g: Grupo, m: number) => number
  totalConta: (c: Conta) => number
}) {
  const totalAno = Array.from({ length: 12 }, (_, i) => totalGrupo(g, i + 1)).reduce((a, b) => a + b, 0)
  return (
    <>
      <tr className="bg-gray-50 font-semibold text-gray-800">
        <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2">{g.codigo} - {g.nome}</td>
        {Array.from({ length: 12 }, (_, i) => (
          <td key={i} className="px-1.5 py-2 text-right tabular-nums text-gray-500">{brl(totalGrupo(g, i + 1) || null)}</td>
        ))}
        <td className="px-2.5 py-2 text-right tabular-nums">{brl(totalAno || null)}</td>
      </tr>
      {g.contas.length === 0 && (
        <tr><td colSpan={14} className="py-1.5 pl-8 text-gray-400">Nenhuma conta ativa neste grupo.</td></tr>
      )}
      {g.contas.map(c => (
        <tr key={c.id} className="text-gray-700">
          <td className="sticky left-0 z-10 border-b border-gray-50 bg-white py-1 pl-8 pr-3" title={c.nome}>
            <span className="block max-w-[240px] truncate">{c.nome}</span>
          </td>
          {Array.from({ length: 12 }, (_, i) => {
            const m = i + 1
            const k = chave(c.id, m)
            const txt = celulas[k] ?? ''
            const n = lerNumero(txt)
            const mudou = n !== null && Math.abs(n - (original[k] ?? 0)) > 0.004
            return (
              <td key={m} className="border-b border-gray-50 px-0.5 py-0.5">
                <input value={txt} readOnly={!podeEditar} inputMode="decimal"
                  aria-label={`${c.nome} — ${MESES_LONGOS[i]}`}
                  onChange={e => definir(c.id, m, e.target.value)}
                  onPaste={e => colar(e, c.id, m)}
                  className={cn('w-[84px] rounded border px-1.5 py-1 text-right tabular-nums focus:border-navy focus:outline-none',
                    n === null ? 'border-red-300 bg-red-50 text-red-700'
                      : mudou ? 'border-amber-300 bg-amber-50'
                        // Borda leve sempre visível: sem ela a grade vazia parecia
                        // uma tabela de leitura, sem indicar que dá para digitar.
                        : podeEditar ? 'border-gray-200 hover:border-gray-300' : 'border-transparent',
                    !podeEditar && 'cursor-default bg-transparent')} />
              </td>
            )
          })}
          <td className="border-b border-gray-50 px-2.5 py-1 text-right tabular-nums text-gray-500">{brl(totalConta(c) || null)}</td>
        </tr>
      ))}
    </>
  )
}
