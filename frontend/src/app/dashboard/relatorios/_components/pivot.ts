/**
 * Motor da tabela dinâmica de Relatórios (código próprio, roda no navegador).
 *
 * O backend entrega os lançamentos do período "planos" (GET /relatorios/dados);
 * aqui eles são filtrados, agrupados em linhas × colunas e somados. Com ~1.300
 * lançamentos hoje, recalcular a cada mudança é instantâneo.
 */

export interface Lancamento {
  id: string
  tipo: 'Despesa' | 'Receita'
  data: string | null
  mes: string | null          // YYYY-MM da Data de Pagamento (em aberto: vencimento)
  competencia: string | null  // YYYY-MM
  vencimento: string | null   // YYYY-MM
  pago: boolean
  categoria: string | null
  subitem: string | null
  classificacao: string | null
  banco: string | null
  centro: string | null
  status: string | null
  descricao: string | null
  parcela: string | null
  criado_por: string | null
  so_dre: boolean
  valor: number
}

export type CampoId =
  | 'mes' | 'competencia' | 'vencimento'
  | 'categoria' | 'subitem' | 'classificacao'
  | 'tipo' | 'banco' | 'centro' | 'status' | 'pago'
  | 'descricao' | 'parcela' | 'criado_por'
export type MedidaId = 'valor' | 'qtd' | 'saldo'
export type Agg = 'soma' | 'media' | 'min' | 'max' | 'pct' | 'contagem'
export type Fonte = 'despesa' | 'receita' | 'ambos'
export type Zona = 'filtros' | 'colunas' | 'linhas' | 'valores'

export interface Valor { f: MedidaId; a: Agg }

export interface Config {
  nome: string
  fonte: Fonte
  linhas: CampoId[]
  colunas: CampoId[]
  valores: Valor[]
  /** Valores marcados por campo; null = todos. */
  filtros: Partial<Record<CampoId, string[] | null>>
}

export interface CampoDef { id: CampoId | MedidaId; nome: string; grupo: string; medida?: boolean }

export const CAMPOS: CampoDef[] = [
  { id: 'mes',           nome: 'Mês de pagamento',  grupo: 'Datas' },
  { id: 'competencia',   nome: 'Competência',       grupo: 'Datas' },
  { id: 'vencimento',    nome: 'Mês de vencimento', grupo: 'Datas' },
  { id: 'categoria',     nome: 'Categoria',         grupo: 'Classificação' },
  { id: 'subitem',       nome: 'Subitem',           grupo: 'Classificação' },
  { id: 'classificacao', nome: 'Classificação',     grupo: 'Classificação' },
  { id: 'tipo',          nome: 'Tipo (Despesa/Receita)', grupo: 'Origem' },
  { id: 'banco',         nome: 'Banco',             grupo: 'Origem' },
  { id: 'centro',        nome: 'Centro de custo',   grupo: 'Origem' },
  { id: 'status',        nome: 'Status',            grupo: 'Origem' },
  { id: 'pago',          nome: 'Pago / Em aberto',  grupo: 'Origem' },
  { id: 'descricao',     nome: 'Descrição',         grupo: 'Detalhe' },
  { id: 'parcela',       nome: 'Parcela',           grupo: 'Detalhe' },
  { id: 'criado_por',    nome: 'Criado por',        grupo: 'Detalhe' },
  { id: 'valor',         nome: 'Valor',             grupo: 'Valores', medida: true },
  { id: 'qtd',           nome: 'Quantidade',        grupo: 'Valores', medida: true },
  { id: 'saldo',         nome: 'Saldo (receitas − despesas)', grupo: 'Valores', medida: true },
]
export const CAMPO = Object.fromEntries(CAMPOS.map(c => [c.id, c])) as Record<CampoId | MedidaId, CampoDef>
export const ehMedida = (id: string): id is MedidaId => id === 'valor' || id === 'qtd' || id === 'saldo'

export const AGGS: Record<MedidaId, Agg[]> = {
  valor: ['soma', 'media', 'min', 'max', 'pct'],
  qtd:   ['contagem'],
  saldo: ['soma'],
}
export const NOME_AGG: Record<Agg, string> = {
  soma: 'Soma', media: 'Média', min: 'Mín.', max: 'Máx.', pct: '% do total', contagem: 'Contagem',
}

export const ZONAS: [Zona, string][] = [['filtros', 'Filtros'], ['colunas', 'Colunas'], ['linhas', 'Linhas'], ['valores', 'Valores']]

export const MODELOS: Config[] = [
  { nome: 'Despesas por categoria × mês', fonte: 'despesa', linhas: ['categoria', 'subitem'], colunas: ['mes'], valores: [{ f: 'valor', a: 'soma' }], filtros: {} },
  { nome: 'Receitas por subitem × banco', fonte: 'receita', linhas: ['subitem'], colunas: ['banco'], valores: [{ f: 'valor', a: 'soma' }], filtros: {} },
  { nome: 'Fixas × Variáveis por centro de custo', fonte: 'despesa', linhas: ['centro'], colunas: ['classificacao'], valores: [{ f: 'valor', a: 'soma' }], filtros: { classificacao: ['Fixo', 'Variável'] } },
  { nome: 'Empréstimos por banco e subitem', fonte: 'ambos', linhas: ['banco', 'subitem'], colunas: ['tipo'], valores: [{ f: 'valor', a: 'soma' }], filtros: { categoria: ['Empréstimo'] } },
  { nome: 'Aplicações por banco', fonte: 'ambos', linhas: ['banco'], colunas: ['tipo'], valores: [{ f: 'valor', a: 'soma' }, { f: 'qtd', a: 'contagem' }], filtros: { classificacao: ['Aplicações'] } },
  { nome: 'Fluxo por banco × mês', fonte: 'ambos', linhas: ['banco'], colunas: ['mes'], valores: [{ f: 'saldo', a: 'soma' }], filtros: {} },
]

export const copiaConfig = (c: Config): Config => ({
  ...c, linhas: [...c.linhas], colunas: [...c.colunas], valores: c.valores.map(v => ({ ...v })),
  filtros: Object.fromEntries(Object.entries(c.filtros).map(([k, v]) => [k, v ? [...v] : null])),
})

// ── Valores dos campos ──────────────────────────────────────

export const VAZIO = '(vazio)'
const CAMPOS_MES = new Set<CampoId>(['mes', 'competencia', 'vencimento'])
const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

/** Chave de agrupamento do campo (meses ficam em YYYY-MM, que ordena certo). */
export function chave(l: Lancamento, campo: CampoId): string {
  if (campo === 'pago') return l.pago ? 'Pago' : 'Em aberto'
  const v = l[campo]
  return v == null || v === '' ? VAZIO : String(v)
}

/** Texto mostrado para uma chave. */
export function rotulo(campo: CampoId, k: string): string {
  if (CAMPOS_MES.has(campo) && /^\d{4}-\d{2}$/.test(k)) return `${MES_ABREV[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}`
  return k
}

export function ordenar(campo: CampoId, a: string, b: string): number {
  if (a === VAZIO) return b === VAZIO ? 0 : 1
  if (b === VAZIO) return -1
  if (CAMPOS_MES.has(campo)) return a < b ? -1 : a > b ? 1 : 0
  return a.localeCompare(b, 'pt-BR', { numeric: true })
}

/** Valores distintos de um campo (para o filtro com caixas de marcar). */
export function valoresDistintos(rows: Lancamento[], campo: CampoId): string[] {
  return [...new Set(rows.map(r => chave(r, campo)))].sort((a, b) => ordenar(campo, a, b))
}

// ── Cálculo ─────────────────────────────────────────────────

export function linhasBase(dados: Lancamento[], cfg: Config): Lancamento[] {
  const filtros = Object.entries(cfg.filtros).filter(([, v]) => v) as [CampoId, string[]][]
  const sets = filtros.map(([f, v]) => [f, new Set(v)] as const)
  return dados.filter(d =>
    (cfg.fonte === 'ambos' || (cfg.fonte === 'despesa' ? d.tipo === 'Despesa' : d.tipo === 'Receita')) &&
    sets.every(([f, s]) => s.has(chave(d, f))))
}

export function agregar(rows: Lancamento[], v: Valor, totalGeral: number): number | null {
  if (v.f === 'qtd') return rows.length
  if (v.f === 'saldo') return rows.reduce((s, r) => s + (r.tipo === 'Receita' ? r.valor : -r.valor), 0)
  if (!rows.length) return null
  if (v.a === 'media') return rows.reduce((s, r) => s + r.valor, 0) / rows.length
  if (v.a === 'min') return Math.min(...rows.map(r => r.valor))
  if (v.a === 'max') return Math.max(...rows.map(r => r.valor))
  const soma = rows.reduce((s, r) => s + r.valor, 0)
  if (v.a === 'pct') return totalGeral ? (soma / totalGeral) * 100 : 0
  return soma
}

export type Formato = 'brl' | 'pct' | 'int'
export const formatoDe = (v: Valor): Formato => v.f === 'qtd' ? 'int' : v.a === 'pct' ? 'pct' : 'brl'

export function fmt(x: number | null, f: Formato): string {
  if (x == null) return ''
  if (f === 'int') return x.toLocaleString('pt-BR')
  if (f === 'pct') return x.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
  return (x < 0 ? '−' : '') + 'R$ ' + Math.abs(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface ColunaFolha { chaves: string[]; rotulo: string }

export interface Celula { valor: number | null; formato: Formato; col: number }   // col = -1: total da linha

export interface LinhaTabela {
  caminho: string[]
  nivel: number
  rotulo: string
  tipo: 'item' | 'sub' | 'tot'
  temFilhos: boolean
  fechado: boolean
  celulas: Celula[]
}

export interface Tabela {
  titulo: string          // cabeçalho da 1ª coluna
  cabecalho: string[]     // demais colunas
  linhas: LinhaTabela[]
  colunas: ColunaFolha[]
  truncada: boolean
}

const SEP = '␟'
export const chaveCaminho = (p: string[]) => p.join(SEP)

interface No { k: string; rows: Lancamento[]; filhos: No[] | null }

function agrupar(rows: Lancamento[], campos: CampoId[]): No[] | null {
  if (!campos.length) return null
  const [f, ...resto] = campos
  const m = new Map<string, Lancamento[]>()
  for (const r of rows) {
    const k = chave(r, f)
    const lista = m.get(k)
    if (lista) lista.push(r)
    else m.set(k, [r])
  }
  return [...m.entries()]
    .sort((a, b) => ordenar(f, a[0], b[0]))
    .map(([k, rs]) => ({ k, rows: rs, filhos: agrupar(rs, resto) }))
}

function folhasColunas(rows: Lancamento[], colunas: CampoId[]): ColunaFolha[] {
  if (!colunas.length) return [{ chaves: [], rotulo: '' }]
  const out: ColunaFolha[] = []
  const walk = (nos: No[], caminho: string[]) => nos.forEach(n => {
    const c = [...caminho, n.k]
    if (n.filhos) walk(n.filhos, c)
    else out.push({ chaves: c, rotulo: c.map((k, i) => rotulo(colunas[i], k)).join(' · ') })
  })
  walk(agrupar(rows, colunas)!, [])
  return out
}

const nomeValor = (v: Valor) => CAMPO[v.f].nome + (v.a !== 'soma' && v.a !== 'contagem' ? ` (${NOME_AGG[v.a]})` : '')

/** Limite de linhas desenhadas na tela (Descrição nas linhas pode gerar milhares). */
export const MAX_LINHAS_TELA = 2000

export function montarTabela(base: Lancamento[], cfg: Config, fechados: Set<string>, limite = Infinity): Tabela {
  const cols = folhasColunas(base, cfg.colunas)
  const temCols = cfg.colunas.length > 0
  const multi = cfg.valores.length > 1
  const totalValor = base.reduce((s, r) => s + r.valor, 0)
  const chaveCol = (r: Lancamento) => cfg.colunas.map(f => chave(r, f)).join(SEP)
  const idxCol = new Map(cols.map((c, i) => [c.chaves.join(SEP), i]))

  const cabecalho = cols.flatMap(c => cfg.valores.map(v =>
    [c.rotulo, multi || !c.rotulo ? nomeValor(v) : ''].filter(Boolean).join(' · ')))
  if (temCols) cfg.valores.forEach(v => cabecalho.push('Total' + (multi ? ' · ' + nomeValor(v) : '')))

  const celulas = (rows: Lancamento[]): Celula[] => {
    const porCol: Lancamento[][] = cols.map(() => [])
    if (temCols) for (const r of rows) porCol[idxCol.get(chaveCol(r))!]?.push(r)
    else porCol[0] = rows
    const out: Celula[] = []
    porCol.forEach((rs, ci) => cfg.valores.forEach(v => out.push({ valor: agregar(rs, v, totalValor), formato: formatoDe(v), col: ci })))
    if (temCols) cfg.valores.forEach(v => out.push({ valor: agregar(rows, v, totalValor), formato: formatoDe(v), col: -1 }))
    return out
  }

  const linhas: LinhaTabela[] = []
  let truncada = false
  const walk = (nos: No[], nivel: number, caminho: string[]) => {
    for (const no of nos) {
      if (linhas.length >= limite) { truncada = true; return }
      const path = [...caminho, no.k]
      const fechado = fechados.has(chaveCaminho(path))
      const temFilhos = !!no.filhos
      linhas.push({
        caminho: path, nivel, rotulo: rotulo(cfg.linhas[nivel], no.k),
        tipo: temFilhos ? 'sub' : 'item', temFilhos, fechado, celulas: celulas(no.rows),
      })
      if (temFilhos && !fechado) walk(no.filhos!, nivel + 1, path)
    }
  }
  const arvore = agrupar(base, cfg.linhas)
  if (arvore) walk(arvore, 0, [])
  linhas.push({ caminho: [], nivel: 0, rotulo: 'Total geral', tipo: 'tot', temFilhos: false, fechado: false, celulas: celulas(base) })

  return {
    titulo: cfg.linhas.map(f => CAMPO[f].nome).join(' › ') || 'Total',
    cabecalho, linhas, colunas: cols, truncada,
  }
}

/** Lançamentos que formam uma célula (linha `caminho`, coluna `col`; -1 = total). */
export function lancamentosDaCelula(base: Lancamento[], cfg: Config, tabela: Tabela, caminho: string[], col: number): Lancamento[] {
  let rows = base.filter(r => caminho.every((k, i) => chave(r, cfg.linhas[i]) === k))
  const c = col >= 0 ? tabela.colunas[col] : null
  if (c && c.chaves.length) rows = rows.filter(r => cfg.colunas.every((f, i) => chave(r, f) === c.chaves[i]))
  return rows
}

/** Tabela em texto separado por tabulação — cola direto no Excel ou no WhatsApp. */
export function tabelaTSV(t: Tabela): string {
  const num = (c: Celula) => c.valor == null ? '' : c.formato === 'int'
    ? String(c.valor)
    : c.valor.toLocaleString('pt-BR', { minimumFractionDigits: c.formato === 'pct' ? 1 : 2, maximumFractionDigits: c.formato === 'pct' ? 1 : 2 }) + (c.formato === 'pct' ? '%' : '')
  const cab = [t.titulo, ...t.cabecalho].join('\t')
  const corpo = t.linhas.map(l => ['  '.repeat(l.nivel) + l.rotulo, ...l.celulas.map(num)].join('\t'))
  return [cab, ...corpo].join('\n')
}
