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
  data: string | null         // YYYY-MM-DD da Data de Pagamento (em aberto: vencimento)
  competencia: string | null  // YYYY-MM-DD
  vencimento: string | null   // YYYY-MM-DD
  pago_em: string | null
  pago: boolean
  categoria: string | null
  subitem: string | null
  classificacao: string | null
  banco: string | null
  centro_grupo?: string | null
  centro: string | null
  status: string | null
  descricao: string | null
  parcela: string | null
  criado_por: string | null
  so_dre: boolean
  /** "Total Salários Funcionários" (0046): soma, não abre para editar. */
  agregado?: boolean
  valor: number
}

export type CampoId =
  | 'mes' | 'competencia' | 'vencimento'
  | 'categoria' | 'subitem' | 'classificacao'
  | 'tipo' | 'banco' | 'centro_grupo' | 'centro' | 'status' | 'pago'
  | 'descricao' | 'parcela' | 'criado_por'
export type MedidaId = 'valor' | 'qtd' | 'saldo'
export type Agg = 'soma' | 'media' | 'min' | 'max' | 'pct' | 'pct_linha' | 'pct_coluna' | 'contagem'
export type Fonte = 'despesa' | 'receita' | 'ambos'
export type Zona = 'filtros' | 'colunas' | 'linhas' | 'valores'
export type Granularidade = 'dia' | 'semana' | 'mes' | 'trimestre' | 'ano'
export type Ordem = 'rotulo' | 'maior' | 'menor'
export type Visao = 'tabela' | 'grafico' | 'ambos'

/** Período do relatório. "tela" segue o seletor das outras telas. */
export type PeriodoRel =
  | { modo: 'tela' }
  | { modo: 'relativo'; rel: PeriodoRelativo }
  | { modo: 'fixo'; inicio: string; fim: string }
export type PeriodoRelativo = 'mes_atual' | 'mes_anterior' | 'ultimos_3' | 'ultimos_6' | 'ultimos_12' | 'ano_atual' | 'ano_anterior'

export interface Valor { f: MedidaId; a: Agg }

export interface Config {
  nome: string
  fonte: Fonte
  linhas: CampoId[]
  colunas: CampoId[]
  valores: Valor[]
  /** Valores marcados por campo; null = todos. */
  filtros: Partial<Record<CampoId, string[] | null>>
  /** Agrupamento dos campos de data (padrão: mês). */
  datas?: Partial<Record<CampoId, Granularidade>>
  ordem?: Ordem
  comparar?: boolean
  visao?: Visao
  periodo?: PeriodoRel
}

export interface CampoDef { id: CampoId | MedidaId; nome: string; grupo: string; medida?: boolean }

export const CAMPOS: CampoDef[] = [
  { id: 'mes',           nome: 'Data de pagamento',  grupo: 'Datas' },
  { id: 'competencia',   nome: 'Competência',        grupo: 'Datas' },
  { id: 'vencimento',    nome: 'Vencimento',         grupo: 'Datas' },
  { id: 'categoria',     nome: 'Categoria',          grupo: 'Classificação' },
  { id: 'subitem',       nome: 'Subitem',            grupo: 'Classificação' },
  { id: 'classificacao', nome: 'Classificação',      grupo: 'Classificação' },
  { id: 'tipo',          nome: 'Tipo (Despesa/Receita)', grupo: 'Origem' },
  { id: 'banco',         nome: 'Banco',              grupo: 'Origem' },
  { id: 'centro_grupo',  nome: 'Grupo de centro',    grupo: 'Origem' },
  { id: 'centro',        nome: 'Centro de custo',    grupo: 'Origem' },
  { id: 'status',        nome: 'Status',             grupo: 'Origem' },
  { id: 'pago',          nome: 'Pago / Em aberto',   grupo: 'Origem' },
  { id: 'descricao',     nome: 'Descrição',          grupo: 'Detalhe' },
  { id: 'parcela',       nome: 'Parcela',            grupo: 'Detalhe' },
  { id: 'criado_por',    nome: 'Criado por',         grupo: 'Detalhe' },
  { id: 'valor',         nome: 'Valor',              grupo: 'Valores', medida: true },
  { id: 'qtd',           nome: 'Quantidade',         grupo: 'Valores', medida: true },
  { id: 'saldo',         nome: 'Saldo (receitas − despesas)', grupo: 'Valores', medida: true },
]
export const CAMPO = Object.fromEntries(CAMPOS.map(c => [c.id, c])) as Record<CampoId | MedidaId, CampoDef>
export const ehMedida = (id: string): id is MedidaId => id === 'valor' || id === 'qtd' || id === 'saldo'

export const AGGS: Record<MedidaId, Agg[]> = {
  valor: ['soma', 'media', 'min', 'max', 'pct', 'pct_linha', 'pct_coluna'],
  qtd:   ['contagem'],
  saldo: ['soma'],
}
export const NOME_AGG: Record<Agg, string> = {
  soma: 'Soma', media: 'Média', min: 'Mín.', max: 'Máx.', pct: '% do total',
  pct_linha: '% da linha', pct_coluna: '% da coluna', contagem: 'Contagem',
}

export const CAMPOS_DATA = new Set<CampoId>(['mes', 'competencia', 'vencimento'])
export const GRANULARIDADES: [Granularidade, string][] = [
  ['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês'], ['trimestre', 'Trimestre'], ['ano', 'Ano'],
]

export const ZONAS: [Zona, string][] = [['filtros', 'Filtros'], ['colunas', 'Colunas'], ['linhas', 'Linhas'], ['valores', 'Valores']]

export const MODELOS: Config[] = [
  { nome: 'Despesas por categoria × mês', fonte: 'despesa', linhas: ['categoria', 'subitem'], colunas: ['mes'], valores: [{ f: 'valor', a: 'soma' }], filtros: {} },
  { nome: 'Receitas por subitem × banco', fonte: 'receita', linhas: ['subitem'], colunas: ['banco'], valores: [{ f: 'valor', a: 'soma' }], filtros: {}, ordem: 'maior' },
  { nome: 'Fixas × Variáveis por centro de custo', fonte: 'despesa', linhas: ['centro'], colunas: ['classificacao'], valores: [{ f: 'valor', a: 'soma' }], filtros: { classificacao: ['Fixo', 'Variável'] } },
  { nome: 'Empréstimos por banco e subitem', fonte: 'ambos', linhas: ['banco', 'subitem'], colunas: ['tipo'], valores: [{ f: 'valor', a: 'soma' }], filtros: { categoria: ['Empréstimo'] } },
  { nome: 'Aplicações por banco', fonte: 'ambos', linhas: ['banco'], colunas: ['tipo'], valores: [{ f: 'valor', a: 'soma' }, { f: 'qtd', a: 'contagem' }], filtros: { classificacao: ['Aplicações'] } },
  { nome: 'Fluxo por banco × mês', fonte: 'ambos', linhas: ['banco'], colunas: ['mes'], valores: [{ f: 'saldo', a: 'soma' }], filtros: {} },
  // Herdado do Monitoramento IA: mesma descrição e valor no mesmo mês. Ordenado
  // pela quantidade, as duplicidades (2 ou mais) ficam no topo.
  { nome: 'Possíveis duplicidades', fonte: 'despesa', linhas: ['descricao', 'mes'], colunas: [], valores: [{ f: 'qtd', a: 'contagem' }, { f: 'valor', a: 'soma' }], filtros: {}, ordem: 'maior' },
  { nome: 'Contas em aberto por vencimento', fonte: 'ambos', linhas: ['vencimento', 'descricao'], colunas: ['tipo'], valores: [{ f: 'valor', a: 'soma' }], filtros: { pago: ['Em aberto'] }, datas: { vencimento: 'semana' } },
]

export const copiaConfig = (c: Config): Config => ({
  ...c, linhas: [...c.linhas], colunas: [...c.colunas], valores: c.valores.map(v => ({ ...v })),
  filtros: Object.fromEntries(Object.entries(c.filtros).map(([k, v]) => [k, v ? [...v] : null])),
  datas: { ...(c.datas ?? {}) },
  periodo: c.periodo ? { ...c.periodo } : undefined,
})

// ── Valores dos campos ──────────────────────────────────────

export const VAZIO = '(vazio)'
const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const COLUNA_DATA: Record<string, 'data' | 'competencia' | 'vencimento'> = { mes: 'data', competencia: 'competencia', vencimento: 'vencimento' }

/** Segunda-feira da semana de uma data YYYY-MM-DD (sem fuso: meio-dia). */
function inicioSemana(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function chaveData(iso: string, g: Granularidade): string {
  if (g === 'dia') return iso.slice(0, 10)
  if (g === 'semana') return inicioSemana(iso)
  if (g === 'ano') return iso.slice(0, 4)
  if (g === 'trimestre') return `${iso.slice(0, 4)}-T${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`
  return iso.slice(0, 7)
}

export const granularidade = (cfg: Pick<Config, 'datas'>, campo: CampoId): Granularidade => cfg.datas?.[campo] ?? 'mes'

/** Chave de agrupamento do campo. Datas viram chaves que ordenam como texto. */
export function chave(l: Lancamento, campo: CampoId, g: Granularidade = 'mes'): string {
  if (campo === 'pago') return l.pago ? 'Pago' : 'Em aberto'
  if (CAMPOS_DATA.has(campo)) {
    const v = l[COLUNA_DATA[campo]]
    return v ? chaveData(v, g) : VAZIO
  }
  const v = l[campo as Exclude<CampoId, 'mes' | 'pago'>]
  return v == null || v === '' ? VAZIO : String(v)
}

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Texto mostrado para uma chave. */
export function rotulo(campo: CampoId, k: string): string {
  if (!CAMPOS_DATA.has(campo) || k === VAZIO) return k
  if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return br(k)
  if (/^\d{4}-\d{2}$/.test(k)) return `${MES_ABREV[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}`
  if (/^\d{4}-T\d$/.test(k)) return `${k.slice(6)}º tri/${k.slice(0, 4)}`
  return k
}

/** Rótulo com a granularidade (semana mostra "Sem. de dd/mm/aaaa"). */
export function rotuloCampo(cfg: Pick<Config, 'datas'>, campo: CampoId, k: string): string {
  if (CAMPOS_DATA.has(campo) && granularidade(cfg, campo) === 'semana' && k !== VAZIO) return `Sem. de ${br(k)}`
  return rotulo(campo, k)
}

export function ordenar(campo: CampoId, a: string, b: string): number {
  if (a === VAZIO) return b === VAZIO ? 0 : 1
  if (b === VAZIO) return -1
  if (CAMPOS_DATA.has(campo)) return a < b ? -1 : a > b ? 1 : 0
  return a.localeCompare(b, 'pt-BR', { numeric: true })
}

/** Valores distintos de um campo (para o filtro com caixas de marcar). */
export function valoresDistintos(rows: Lancamento[], campo: CampoId, g: Granularidade = 'mes'): string[] {
  return [...new Set(rows.map(r => chave(r, campo, g)))].sort((a, b) => ordenar(campo, a, b))
}

// ── Cálculo ─────────────────────────────────────────────────

export function linhasBase(dados: Lancamento[], cfg: Config): Lancamento[] {
  const sets = (Object.entries(cfg.filtros).filter(([, v]) => v) as [CampoId, string[]][])
    .map(([f, v]) => [f, new Set(v), granularidade(cfg, f)] as const)
  return dados.filter(d =>
    (cfg.fonte === 'ambos' || (cfg.fonte === 'despesa' ? d.tipo === 'Despesa' : d.tipo === 'Receita')) &&
    sets.every(([f, s, g]) => s.has(chave(d, f, g))))
}

const soma = (rows: Lancamento[]) => rows.reduce((s, r) => s + r.valor, 0)

/**
 * Valor de um conjunto de lançamentos.
 * `ref` = base dos percentuais: total geral (pct), total da linha (pct_linha)
 * ou total da coluna (pct_coluna) — quem chama escolhe.
 */
export function agregar(rows: Lancamento[], v: Valor, ref = 0): number | null {
  if (v.f === 'qtd') return rows.length
  if (v.f === 'saldo') return rows.reduce((s, r) => s + (r.tipo === 'Receita' ? r.valor : -r.valor), 0)
  if (!rows.length) return null
  if (v.a === 'media') return soma(rows) / rows.length
  if (v.a === 'min') return Math.min(...rows.map(r => r.valor))
  if (v.a === 'max') return Math.max(...rows.map(r => r.valor))
  if (v.a === 'pct' || v.a === 'pct_linha' || v.a === 'pct_coluna') return ref ? (soma(rows) / ref) * 100 : 0
  return soma(rows)
}

export type Formato = 'brl' | 'pct' | 'int' | 'var'
const ehPct = (a: Agg) => a === 'pct' || a === 'pct_linha' || a === 'pct_coluna'
export const formatoDe = (v: Valor): Formato => v.f === 'qtd' ? 'int' : ehPct(v.a) ? 'pct' : 'brl'

export function fmt(x: number | null, f: Formato): string {
  if (x == null) return ''
  if (f === 'int') return x.toLocaleString('pt-BR')
  if (f === 'pct') return x.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
  if (f === 'var') return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
  return (x < 0 ? '−' : '') + 'R$ ' + Math.abs(x).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export interface ColunaFolha { chaves: string[]; rotulo: string }

/** col ≥ 0: coluna da tabela; -1: total da linha; -2: período anterior / variação (sem detalhe). */
export interface Celula { valor: number | null; formato: Formato; col: number }

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
  /** Caminhos de todas as linhas com filhos (para "Recolher tudo"). */
  grupos: string[][]
}

const SEP = '␟'
export const chaveCaminho = (p: string[]) => p.join(SEP)

interface No { k: string; rows: Lancamento[]; filhos: No[] | null }

function agrupar(rows: Lancamento[], campos: CampoId[], cfg: Config, ordenarPorValor?: Ordem): No[] | null {
  if (!campos.length) return null
  const [f, ...resto] = campos
  const g = granularidade(cfg, f)
  const m = new Map<string, Lancamento[]>()
  for (const r of rows) {
    const k = chave(r, f, g)
    const lista = m.get(k)
    if (lista) lista.push(r)
    else m.set(k, [r])
  }
  const entradas = [...m.entries()]
  const v0 = cfg.valores[0]
  if (ordenarPorValor && ordenarPorValor !== 'rotulo' && v0) {
    const sinal = ordenarPorValor === 'maior' ? -1 : 1
    const val = (rs: Lancamento[]) => agregar(rs, { ...v0, a: ehPct(v0.a) ? 'soma' : v0.a }) ?? 0
    entradas.sort((a, b) => sinal * (val(a[1]) - val(b[1])) || ordenar(f, a[0], b[0]))
  } else {
    entradas.sort((a, b) => ordenar(f, a[0], b[0]))
  }
  return entradas.map(([k, rs]) => ({ k, rows: rs, filhos: agrupar(rs, resto, cfg, ordenarPorValor) }))
}

function folhasColunas(rows: Lancamento[], cfg: Config): ColunaFolha[] {
  if (!cfg.colunas.length) return [{ chaves: [], rotulo: '' }]
  const out: ColunaFolha[] = []
  const walk = (nos: No[], caminho: string[]) => nos.forEach(n => {
    const c = [...caminho, n.k]
    if (n.filhos) walk(n.filhos, c)
    else out.push({ chaves: c, rotulo: c.map((k, i) => rotuloCampo(cfg, cfg.colunas[i], k)).join(' · ') })
  })
  walk(agrupar(rows, cfg.colunas, cfg)!, [])
  return out
}

export const nomeValor = (v: Valor) => CAMPO[v.f].nome + (v.a !== 'soma' && v.a !== 'contagem' ? ` (${NOME_AGG[v.a]})` : '')

/** Limite de linhas desenhadas na tela (Descrição nas linhas pode gerar milhares). */
export const MAX_LINHAS_TELA = 2000

/** Lançamentos de cada caminho de linha (todos os prefixos), para casar o período anterior. */
function indicePorCaminho(rows: Lancamento[], cfg: Config): Map<string, Lancamento[]> {
  const idx = new Map<string, Lancamento[]>()
  const gs = cfg.linhas.map(f => granularidade(cfg, f))
  for (const r of rows) {
    const p: string[] = []
    for (let i = 0; i < cfg.linhas.length; i++) {
      p.push(chave(r, cfg.linhas[i], gs[i]))
      const k = chaveCaminho(p)
      const l = idx.get(k)
      if (l) l.push(r)
      else idx.set(k, [r])
    }
  }
  return idx
}

/**
 * `anterior`: lançamentos do período anterior (já filtrados). Quando vem, cada
 * valor ganha as colunas "Anterior" e "Var. %" depois do total — as linhas são
 * casadas pelo nome do grupo.
 */
export function montarTabela(
  base: Lancamento[], cfg: Config, fechados: Set<string>, limite = Infinity, anterior?: Lancamento[] | null,
): Tabela {
  const cols = folhasColunas(base, cfg)
  const temCols = cfg.colunas.length > 0
  const multi = cfg.valores.length > 1
  const totalGeral = soma(base)
  const chaveCol = (r: Lancamento) => cfg.colunas.map(f => chave(r, f, granularidade(cfg, f))).join(SEP)
  const idxCol = new Map(cols.map((c, i) => [c.chaves.join(SEP), i]))
  const porColuna = (rows: Lancamento[]) => {
    const out: Lancamento[][] = cols.map(() => [])
    if (temCols) for (const r of rows) out[idxCol.get(chaveCol(r))!]?.push(r)
    else out[0] = rows
    return out
  }
  const totalCol = porColuna(base).map(soma)
  const comparar = !!anterior
  const idxAnt = comparar ? indicePorCaminho(anterior!, cfg) : null
  const totalAnt = comparar ? soma(anterior!) : 0

  const cabecalho = cols.flatMap(c => cfg.valores.map(v =>
    [c.rotulo, multi || !c.rotulo ? nomeValor(v) : ''].filter(Boolean).join(' · ')))
  if (temCols) cfg.valores.forEach(v => cabecalho.push('Total' + (multi ? ' · ' + nomeValor(v) : '')))
  if (comparar) cfg.valores.forEach(v => {
    const sufixo = multi ? ' · ' + nomeValor(v) : ''
    cabecalho.push('Anterior' + sufixo, 'Var. %' + sufixo)
  })

  const ref = (v: Valor, linha: number, coluna: number) =>
    v.a === 'pct_linha' ? linha : v.a === 'pct_coluna' ? coluna : totalGeral

  const celulas = (rows: Lancamento[], caminho: string[] | null): Celula[] => {
    const totalLinha = soma(rows)
    const out: Celula[] = []
    porColuna(rows).forEach((rs, ci) => cfg.valores.forEach(v =>
      out.push({ valor: agregar(rs, v, ref(v, totalLinha, totalCol[ci])), formato: formatoDe(v), col: ci })))
    if (temCols) cfg.valores.forEach(v =>
      out.push({ valor: agregar(rows, v, ref(v, totalLinha, totalGeral)), formato: formatoDe(v), col: -1 }))
    if (comparar) {
      const ant = caminho == null ? anterior! : (idxAnt!.get(chaveCaminho(caminho)) ?? [])
      const totalLinhaAnt = soma(ant)
      cfg.valores.forEach(v => {
        const atual = agregar(rows, v, ref(v, totalLinha, totalGeral))
        const antes = ant.length || v.f === 'qtd' ? agregar(ant, v, ref(v, totalLinhaAnt, totalAnt)) : null
        const variacao = atual != null && antes ? ((atual - antes) / Math.abs(antes)) * 100 : null
        out.push({ valor: antes, formato: formatoDe(v), col: -2 }, { valor: variacao, formato: 'var', col: -2 })
      })
    }
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
        caminho: path, nivel, rotulo: rotuloCampo(cfg, cfg.linhas[nivel], no.k),
        tipo: temFilhos ? 'sub' : 'item', temFilhos, fechado, celulas: celulas(no.rows, path),
      })
      if (temFilhos && !fechado) walk(no.filhos!, nivel + 1, path)
    }
  }
  const arvore = agrupar(base, cfg.linhas, cfg, cfg.ordem)
  if (arvore) walk(arvore, 0, [])

  // Todos os grupos, inclusive os recolhidos, para "Recolher tudo".
  const grupos: string[][] = []
  const coletar = (nos: No[], caminho: string[]) => nos.forEach(n => {
    if (!n.filhos) return
    const path = [...caminho, n.k]
    grupos.push(path)
    coletar(n.filhos, path)
  })
  if (arvore) coletar(arvore, [])
  linhas.push({ caminho: [], nivel: 0, rotulo: 'Total geral', tipo: 'tot', temFilhos: false, fechado: false, celulas: celulas(base, null) })

  return {
    titulo: cfg.linhas.map(f => CAMPO[f].nome).join(' › ') || 'Total',
    cabecalho, linhas, colunas: cols, truncada, grupos,
  }
}

/** Lançamentos que formam uma célula (linha `caminho`, coluna `col`; -1 = total). */
export function lancamentosDaCelula(base: Lancamento[], cfg: Config, tabela: Tabela, caminho: string[], col: number): Lancamento[] {
  let rows = base.filter(r => caminho.every((k, i) => chave(r, cfg.linhas[i], granularidade(cfg, cfg.linhas[i])) === k))
  const c = col >= 0 ? tabela.colunas[col] : null
  if (c && c.chaves.length) rows = rows.filter(r => cfg.colunas.every((f, i) => chave(r, f, granularidade(cfg, f)) === c.chaves[i]))
  return rows
}

/** Tabela em texto separado por tabulação — cola direto no Excel ou no WhatsApp. */
export function tabelaTSV(t: Tabela): string {
  const num = (c: Celula) => {
    if (c.valor == null) return ''
    if (c.formato === 'int') return String(c.valor)
    const pct = c.formato === 'pct' || c.formato === 'var'
    return c.valor.toLocaleString('pt-BR', { minimumFractionDigits: pct ? 1 : 2, maximumFractionDigits: pct ? 1 : 2 }) + (pct ? '%' : '')
  }
  const cab = [t.titulo, ...t.cabecalho].join('\t')
  const corpo = t.linhas.map(l => ['  '.repeat(l.nivel) + l.rotulo, ...l.celulas.map(num)].join('\t'))
  return [cab, ...corpo].join('\n')
}

// ── Gráfico ─────────────────────────────────────────────────

export const MAX_SERIES = 8
export interface DadosGrafico {
  forma: 'linha' | 'barra'
  valor: Valor
  categorias: string[]              // eixo X (linha) ou barras (barra)
  series: { nome: string; valores: (number | null)[] }[]
}

/**
 * Gráfico da tabela, sempre do 1º valor e do 1º nível das linhas.
 * Com uma data na 1ª coluna e 3+ períodos é evolução no tempo (linhas, uma por
 * grupo); sem isso, barras horizontais por grupo, uma série por coluna. Passou de 8 séries,
 * as menores viram "Outros" — cor nunca é gerada além da paleta.
 */
export function dadosGrafico(base: Lancamento[], cfg: Config): DadosGrafico | null {
  const v = cfg.valores[0]
  if (!v || !base.length) return null
  const valorG: Valor = ehPct(v.a) ? { ...v, a: 'soma' } : v
  const campoLinha = cfg.linhas[0]
  const campoCol = cfg.colunas[0]
  const grupos = campoLinha ? agrupar(base, [campoLinha], cfg)! : [{ k: 'Total', rows: base, filhos: null }]
  const rotLinha = (k: string) => campoLinha ? rotuloCampo(cfg, campoLinha, k) : k

  const dobrar = <T extends { nome: string; rows: Lancamento[] }>(itens: T[]) => {
    if (itens.length <= MAX_SERIES) return itens.map(i => ({ nome: i.nome, rows: i.rows }))
    const ordenados = [...itens].sort((a, b) => Math.abs(soma(b.rows)) - Math.abs(soma(a.rows)))
    const fica = ordenados.slice(0, MAX_SERIES - 1)
    const resto = ordenados.slice(MAX_SERIES - 1).flatMap(i => i.rows)
    return [...fica.map(i => ({ nome: i.nome, rows: i.rows })), { nome: 'Outros', rows: resto }]
  }

  // Linha só faz sentido com 3 ou mais períodos; com 1 ou 2, barras comparam melhor.
  const gT = campoCol && CAMPOS_DATA.has(campoCol) ? granularidade(cfg, campoCol) : null
  const tempos = gT ? valoresDistintos(base, campoCol!, gT).filter(k => k !== VAZIO) : []
  if (gT && tempos.length >= 3) {
    const g = gT
    const series = dobrar(grupos.map(n => ({ nome: rotLinha(n.k), rows: n.rows })))
    return {
      forma: 'linha', valor: valorG,
      categorias: tempos.map(k => rotuloCampo(cfg, campoCol, k)),
      series: series.map(s => ({
        nome: s.nome,
        valores: tempos.map(t => agregar(s.rows.filter(r => chave(r, campoCol, g) === t), valorG)),
      })),
    }
  }

  const ordenados = [...grupos].sort((a, b) => (agregar(b.rows, valorG) ?? 0) - (agregar(a.rows, valorG) ?? 0))
  const top = ordenados.slice(0, 15)
  if (!campoCol) {
    return { forma: 'barra', valor: valorG, categorias: top.map(n => rotLinha(n.k)), series: [{ nome: nomeValor(valorG), valores: top.map(n => agregar(n.rows, valorG)) }] }
  }
  const gC = granularidade(cfg, campoCol)
  const colunas = dobrar(valoresDistintos(base, campoCol, gC).map(k => ({ nome: rotuloCampo(cfg, campoCol, k), rows: base.filter(r => chave(r, campoCol, gC) === k) })))
  return {
    forma: 'barra', valor: valorG,
    categorias: top.map(n => rotLinha(n.k)),
    series: colunas.map(c => {
      const deste = new Set(c.rows.map(r => r.id))
      return { nome: c.nome, valores: top.map(n => agregar(n.rows.filter(r => deste.has(r.id)), valorG)) }
    }),
  }
}
