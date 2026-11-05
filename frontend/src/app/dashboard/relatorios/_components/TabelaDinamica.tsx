'use client'
import { cn, fmtData } from '@/lib/utils'
import { fmt, type Lancamento, type Tabela } from './pivot'

interface Props {
  tabela: Tabela
  onAlternar: (caminho: string[]) => void
  onCelula: (caminho: string[], col: number) => void
}

export function TabelaDinamica({ tabela, onAlternar, onCelula }: Props) {
  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border-b border-gray-200 bg-white px-3 py-2 text-left text-[11px] font-semibold text-gray-500">
              {tabela.titulo}
            </th>
            {tabela.cabecalho.map((h, i) => (
              <th key={i} className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-gray-200 bg-white px-3 py-2 text-right text-[11px] font-semibold text-gray-500',
                h.startsWith('Total') && 'text-gray-700')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.linhas.map((l, li) => {
            const fundo = l.tipo === 'sub' ? 'bg-gray-50' : 'bg-white'
            return (
              <tr key={li} className={cn(l.tipo !== 'item' && 'font-semibold', l.tipo === 'tot' && 'font-bold')}>
                <th
                  className={cn('sticky left-0 z-[5] whitespace-nowrap border-b border-gray-100 py-1.5 pr-3 text-left font-[inherit] text-gray-800', fundo,
                    l.tipo === 'tot' && 'border-t-2 border-t-navy')}
                  style={{ paddingLeft: 12 + l.nivel * 18 }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {l.temFilhos ? (
                      <button type="button" onClick={() => onAlternar(l.caminho)} className="w-3.5 text-[10px] text-gray-400 hover:text-navy"
                        aria-label={l.fechado ? 'Abrir' : 'Recolher'}>{l.fechado ? '▸' : '▾'}</button>
                    ) : l.tipo !== 'tot' && <span className="w-3.5" />}
                    {l.rotulo}
                  </span>
                </th>
                {l.celulas.map((c, ci) => {
                  // Período anterior e variação não abrem detalhe (são de outro período).
                  const clicavel = c.col !== -2
                  return (
                    <td
                      key={ci}
                      onClick={clicavel ? () => onCelula(l.caminho, c.col) : undefined}
                      className={cn('whitespace-nowrap border-b border-gray-100 px-3 py-1.5 text-right tabular-nums', fundo,
                        clicavel ? 'cursor-pointer hover:bg-navy/5' : 'text-gray-500',
                        c.col === -1 && 'font-semibold', c.formato !== 'var' && c.valor != null && c.valor < 0 && 'text-red-700',
                        l.tipo === 'tot' && 'border-t-2 border-t-navy')}
                    >
                      {c.formato === 'var' && c.valor != null && c.valor !== 0 && (
                        <span aria-hidden className="mr-1 text-[9px]">{c.valor > 0 ? '▲' : '▼'}</span>
                      )}
                      {fmt(c.valor, c.formato)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const MAX_DETALHE = 100

interface DetalheProps {
  titulo: string
  lancamentos: Lancamento[]
  onFechar: () => void
  /** Abre o lançamento no modal de edição de Lançamentos; ausente = sem edição. */
  onEditar?: (l: Lancamento) => void
  editando?: string | null
}

export function Detalhe({ titulo, lancamentos, onFechar, onEditar, editando }: DetalheProps) {
  const soma = lancamentos.reduce((s, r) => s + (r.tipo === 'Receita' ? r.valor : -r.valor), 0)
  return (
    <div className="grid gap-2 border-t border-gray-200 bg-gray-50 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          <b className="text-navy">{lancamentos.length} lançamento{lancamentos.length === 1 ? '' : 's'}</b> em {titulo}
          <span className="ml-2 text-gray-500">saldo {fmt(soma, 'brl')}</span>
        </span>
        <button type="button" onClick={onFechar} className="font-medium text-navy hover:underline">Fechar</button>
      </div>
      <TabelaLancamentos lancamentos={lancamentos} onEditar={onEditar} editando={editando} />
    </div>
  )
}

/** Tabela de lançamentos, também usada na modal dos valores da Visão Geral. */
export function TabelaLancamentos({ lancamentos, onEditar, editando, zebrada = false }: Pick<DetalheProps, 'lancamentos' | 'onEditar' | 'editando'> & {
  /** Linhas intercaladas em cinza claro e branco. */
  zebrada?: boolean
}) {
  const ordenados = [...lancamentos].sort((a, b) => b.valor - a.valor)
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-gray-500">
              {['Data', 'Tipo', 'Descrição', 'Subitem', 'Banco', 'Status'].map(h => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}
              <th className="px-2 py-1 text-right font-semibold">Valor</th>
              {onEditar && <th className="px-2 py-1"><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {ordenados.slice(0, MAX_DETALHE).map((r, i) => (
              // O índice cobre um lançamento listado duas vezes no Resultado da Visão Geral.
              <tr key={`${r.id}-${i}`} className={cn('border-t border-gray-200', zebrada && (i % 2 === 0 ? 'bg-white' : 'bg-gray-100'))}>
                <td className="whitespace-nowrap px-2 py-1">{fmtData(r.data)}</td>
                <td className="px-2 py-1">{r.tipo}</td>
                <td className="px-2 py-1">{r.descricao}{r.parcela && <span className="ml-1 text-gray-400">{r.parcela}</span>}</td>
                <td className="px-2 py-1">{r.subitem ?? '—'}</td>
                <td className="px-2 py-1">{r.banco ?? '—'}</td>
                <td className="px-2 py-1">{r.status}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{fmt(r.valor, 'brl')}</td>
                {onEditar && (
                  <td className="px-2 py-1 text-right">
                    <button type="button" onClick={() => onEditar(r)} disabled={editando === r.id}
                      className="font-medium text-navy hover:underline disabled:opacity-50">
                      {editando === r.id ? 'Abrindo…' : 'Editar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lancamentos.length > MAX_DETALHE && (
        <span className="text-[11px] text-gray-500">+ {lancamentos.length - MAX_DETALHE} lançamentos (mostrando os {MAX_DETALHE} maiores).</span>
      )}
    </>
  )
}
