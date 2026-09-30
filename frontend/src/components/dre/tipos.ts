// Payload de GET /dre/previsto-realizado (app/services/dre_calculo.py)

export type Visao = 'mes' | 'acumulado' | 'anual'
export type Sentido = 'maior_melhor' | 'menor_melhor'

export interface PontoMes { mes: number; previsto: number | null; realizado: number | null }

export interface LinhaValores {
  previsto: number | null
  realizado: number | null
  desvio: number | null
  pct_meta: number | null
  av: number | null
  sentido: Sentido
  // só na visão anual
  por_mes?: PontoMes[]
  acumulado?: number | null
  media_mensal?: number | null
}

export interface LinhaSecao { tipo: 'secao'; codigo: string; nome: string }
export interface LinhaConta extends LinhaValores { tipo: 'conta'; codigo: string; nome: string; natureza: string; ativo: boolean }
export interface LinhaGrupo extends LinhaValores { tipo: 'grupo'; codigo: string; nome: string; natureza: string; contas: LinhaConta[] }
export interface LinhaResultado extends LinhaValores { tipo: 'resultado'; codigo: string; nome: string; natureza: 'resultado' }
export type Linha = LinhaSecao | LinhaGrupo | LinhaResultado

export interface Kpi {
  realizado: number | null
  previsto: number | null
  pct_meta: number | null
  av: number | null
  sentido: Sentido
}

export interface DreResposta {
  ano: number
  mes: number
  visao: Visao
  meses: number[]
  meses_com_realizado: number[]
  ultimo_mes_realizado: number | null
  kpis: { receita: Kpi; margem: Kpi; resultado_operacional: Kpi; resultado_liquido: Kpi }
  linhas: Linha[]
  mensal: { mes: number; receita: number | null; resultado_liquido: number | null; rl_previsto: number | null }[]
  ponto_equilibrio: {
    receita: number | null
    operacional: number | null
    financeiro: number | null
    folga_op: number | null
    folga_fin: number | null
  }
  nao_classificado: { qtd: number; valor: number }
  pendentes: { qtd: number; valor: number }
}

export const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto',
  'Setembro', 'Outubro', 'Novembro', 'Dezembro']
