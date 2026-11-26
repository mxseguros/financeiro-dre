// Remuneração do funcionário (migration 0052, 26/11/2026) — só Admin.
// Substitui a Folha CLT: valores por item, sem cálculo de INSS/IRRF.

export const ITENS_REMUNERACAO = [
  { id: 'salario', nome: 'Salário' },
  { id: 'decimo_terceiro', nome: '13º Salário' },
  { id: 'terco_ferias', nome: '1/3 Férias' },
  { id: 'abono_ferias', nome: 'Abono de Férias' },
  { id: 'fgts', nome: 'FGTS' },
  { id: 'vale_refeicao', nome: 'Vale Refeição' },
  { id: 'odonto', nome: 'Odonto' },
  { id: 'plano_saude', nome: 'Plano de Saúde' },
  { id: 'seguro_vida', nome: 'Seguro de Vida' },
  { id: 'rescisao', nome: 'Rescisão' },
] as const

export type ItemRemuneracao = typeof ITENS_REMUNERACAO[number]['id']
/** Entram no custo mensal; 13º, férias, abono e rescisão são eventuais. */
export const MENSAIS: ItemRemuneracao[] = ['salario', 'fgts', 'vale_refeicao', 'odonto', 'plano_saude', 'seguro_vida']

export interface RemuneracaoResp {
  funcionario_id: string
  cadastrado: boolean
  valores: Record<ItemRemuneracao, number>
  custo_mensal: number
  banco_pagamento: string | null
}

export interface CustosPessoal {
  por_funcionario: Record<string, { salario: number; custo_mensal: number }>
  por_centro: Record<string, { pessoas: number; custo_mensal: number }>
  total_mes: number
}
