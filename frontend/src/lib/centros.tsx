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

/**
 * Número do k-ésimo subgrupo (espelha financeiro_service.numero_sub). Regra de
 * 28/11/2026: uma só sequência dentro de cada grupo, começando em 11 —
 * "1" → 1.11, 1.12 … 1.19, 1.20…; "2" → 2.11… Grupo decimal (legado, "1.10")
 * soma na última casa: 1.11, 1.12… Grupo sem número: ''.
 */
export function numeroSub(grupoNumero: string | null | undefined, k: number): string {
  const g = (grupoNumero ?? '').trim()
  if (/^\d+$/.test(g)) return `${parseInt(g, 10)}.${10 + k}`
  if (!/^\d+\.\d+$/.test(g)) return ''
  const [inteiro, dec] = g.split('.')
  const casas = dec.length
  // Em inteiros na menor casa, para não errar com ponto flutuante.
  const escala = 10 ** casas
  const total = parseInt(inteiro, 10) * escala + parseInt(dec, 10) + k
  return `${Math.floor(total / escala)}.${String(total % escala).padStart(casas, '0')}`
}

/** Prévia do número que um subgrupo novo recebe no grupo (entra no fim). */
export function proximoNumeroSub(grupo: CentroCusto | undefined, centros: CentroCusto[], excetoId?: string): string {
  if (!grupo) return ''
  const n = centros.filter(c => c.parent_id === grupo.id && c.id !== excetoId).length
  return numeroSub(grupo.numero, n + 1)
}

/** Opções planas do filtro de centro (chip de Lançamentos): grupo inteiro e, abaixo, os subgrupos. */
export function opcoesCentroFiltro(centros: CentroCusto[]): { valor: string; texto: string }[] {
  return arvoreCentros(centros).flatMap(({ grupo, filhos }) => filhos.length
    ? [{ valor: grupo.codigo, texto: `${rotuloCentro(grupo)} (todo o grupo)` },
       ...filhos.map(c => ({ valor: c.codigo, texto: `  ${rotuloCentro(c)}` }))]
    : [{ valor: grupo.codigo, texto: rotuloCentro(grupo) }])
}
