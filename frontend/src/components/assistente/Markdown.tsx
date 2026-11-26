import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Markdown simples das respostas do Assistente (redesenho UX, fase 9):
 * títulos, parágrafos, negrito/itálico/código, listas e tabelas. Monta
 * elementos React (sem HTML cru); células com número ficam à direita.
 */

const ehNumero = (s: string) => /^[\s(−\-+]*(R\$\s*)?[\d.,]+\s*%?\)?\s*$/.test(s.trim())

function inline(texto: string, chave: string): ReactNode[] {
  const partes: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let ultimo = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(texto))) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index))
    const t = m[0]
    const k = `${chave}-${i++}`
    if (t.startsWith('**')) partes.push(<strong key={k} className="font-semibold text-slate-900">{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) partes.push(<code key={k} className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">{t.slice(1, -1)}</code>)
    else partes.push(<em key={k}>{t.slice(1, -1)}</em>)
    ultimo = m.index + t.length
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo))
  return partes
}

const celulas = (linha: string) => linha.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

export function Markdown({ texto }: { texto: string }) {
  const linhas = texto.replace(/\r/g, '').split('\n')
  const blocos: ReactNode[] = []
  let i = 0
  while (i < linhas.length) {
    const l = linhas[i]
    // Tabela: linha com | seguida de separador |---|
    if (l.includes('|') && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1])) {
      const cab = celulas(l)
      const corpo: string[][] = []
      i += 2
      while (i < linhas.length && linhas[i].includes('|') && linhas[i].trim()) { corpo.push(celulas(linhas[i])); i++ }
      const numerica = cab.map((_, c) => corpo.length > 0 && corpo.every(r => !r[c] || ehNumero(r[c])))
      blocos.push(
        <div key={`t${i}`} className="my-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>{cab.map((h, c) => <th key={c} scope="col" className={cn('px-3 py-2 text-[13px] font-semibold text-slate-600', numerica[c] ? 'text-right' : 'text-left')}>{inline(h, `h${c}`)}</th>)}</tr>
            </thead>
            <tbody>
              {corpo.map((r, ri) => (
                <tr key={ri} className="border-t border-slate-100">
                  {cab.map((_, c) => <td key={c} className={cn('px-3 py-2 text-slate-800', numerica[c] && 'whitespace-nowrap text-right tabular-nums')}>{inline(r[c] ?? '', `c${ri}-${c}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    // Lista
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordenada = /^\s*\d+[.)]/.test(l)
      const itens: string[] = []
      while (i < linhas.length && /^\s*([-*•]|\d+[.)])\s+/.test(linhas[i])) { itens.push(linhas[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++ }
      const Tag = ordenada ? 'ol' : 'ul'
      blocos.push(
        <Tag key={`l${i}`} className={cn('my-2 space-y-1 pl-5', ordenada ? 'list-decimal' : 'list-disc')}>
          {itens.map((it, k) => <li key={k}>{inline(it, `li${i}-${k}`)}</li>)}
        </Tag>,
      )
      continue
    }
    const titulo = /^(#{1,4})\s+(.*)$/.exec(l)
    if (titulo) {
      blocos.push(<p key={`h${i}`} className="mb-1 mt-3 text-[15px] font-bold text-slate-900">{inline(titulo[2], `h${i}`)}</p>)
      i++; continue
    }
    if (!l.trim()) { i++; continue }
    // Parágrafo: junta linhas seguidas
    const par: string[] = []
    while (i < linhas.length && linhas[i].trim() && !linhas[i].includes('|') && !/^\s*([-*•]|\d+[.)])\s+/.test(linhas[i]) && !/^#{1,4}\s/.test(linhas[i])) { par.push(linhas[i]); i++ }
    if (!par.length) { blocos.push(<p key={`p${i}`} className="my-2">{inline(l, `p${i}`)}</p>); i++; continue }
    blocos.push(<p key={`p${i}`} className="my-2">{par.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inline(p, `p${i}-${k}`)}</Fragment>)}</p>)
  }
  return <div className="text-[15px] leading-relaxed text-slate-800">{blocos}</div>
}
