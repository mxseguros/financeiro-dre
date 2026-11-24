// Centros de custo em grupos e subgrupos (24/11/2026).
// O lançamento guarda o CODIGO do centro. Grupo com subgrupos não recebe
// lançamento; filtrar por ele traz os subgrupos (o backend expande).

export interface CentroCusto {
  id: string; nome: string; codigo: string; ativo: boolean
  parent_id?: string | null; numero?: string | null; ordem?: number
}

/** "1.21 - Saúde e Vida", ou só o nome quando não há número. */
export function rotuloCentro(c: Pick<CentroCusto, 'nome' | 'numero'>): string {
  const num = (c.numero ?? '').trim()
  return num ? `${num} - ${c.nome}` : c.nome
}

/** Nome para exibir a partir do código gravado no lançamento. */
export function nomeCentro(codigo: string | null | undefined, centros: CentroCusto[]): string {
  if (!codigo) return '—'
  const c = centros.find(x => x.codigo === codigo)
  return c ? rotuloCentro(c) : codigo.replace(/_/g, ' ')
}

/** Raízes na ordem da API (já ordenada pelo número), cada uma com seus subgrupos. */
export function arvoreCentros(centros: CentroCusto[]): { grupo: CentroCusto; filhos: CentroCusto[] }[] {
  const ids = new Set(centros.map(c => c.id))
  return centros
    // Subgrupo cujo pai sumiu (inativo/oculto) aparece como raiz, para não se perder.
    .filter(c => !c.parent_id || !ids.has(c.parent_id))
    .map(grupo => ({ grupo, filhos: centros.filter(c => c.parent_id === grupo.id) }))
}

/**
 * <option>s do select de centro. Grupos com subgrupos viram <optgroup> (não
 * selecionáveis). Em filtros (`filtro`), o grupo também é uma opção — traz
 * todos os subgrupos. `atual` mantém visível o valor já gravado, mesmo
 * inativo ou num centro que virou grupo depois.
 */
export function OpcoesCentro({ centros, atual, filtro = false }: {
  centros: CentroCusto[]; atual?: string; filtro?: boolean
}) {
  const visivel = (c: CentroCusto) => filtro || c.ativo || c.codigo === atual
  return (
    <>
      {arvoreCentros(centros).map(({ grupo, filhos }) => {
        const subs = filhos.filter(visivel)
        if (!filhos.length) {
          return visivel(grupo)
            ? <option key={grupo.id} value={grupo.codigo}>{rotuloCentro(grupo)}</option>
            : null
        }
        if (!subs.length && !(filtro || grupo.codigo === atual)) return null
        return [
          (filtro || grupo.codigo === atual) && (
            <option key={`g-${grupo.id}`} value={grupo.codigo}>
              {rotuloCentro(grupo)}{filtro ? ' (todo o grupo)' : ''}
            </option>
          ),
          subs.length > 0 && (
            <optgroup key={`og-${grupo.id}`} label={rotuloCentro(grupo)}>
              {subs.map(c => <option key={c.id} value={c.codigo}>{rotuloCentro(c)}</option>)}
            </optgroup>
          ),
        ]
      })}
    </>
  )
}
