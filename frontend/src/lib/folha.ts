// Folha CLT (migration 0049, 25/11/2026) — só Admin.

export type TipoContrato = 'clt' | 'estagio' | 'pj' | 'pro_labore'

export interface Contrato {
  tipo_contrato: TipoContrato
  cargo: string | null
  data_admissao: string | null
  data_desligamento: string | null
  salario_base: number
  adicionais: Record<string, { pct?: number; valor?: number }>
  dependentes_ir: number
  filhos_salario_familia: number
  pensao_alimenticia: number
  vt_custo_mensal: number
  vt_descontar: boolean
  va_valor: number
  plano_saude_empresa: number
  plano_saude_desconto: number
  seguro_vida: number
  outros_beneficios: { nome: string; valor: number }[]
  sindical: { valor?: number }
  banco_pagamento: string | null
}

export interface CalculoFolha {
  proventos: Record<string, number>
  salario_familia: number
  descontos: Record<string, number>
  irrf_detalhe: { base: number; deducao: number; simplificado: boolean; imposto_tabela: number; redutor: number; valor: number }
  bruto: number
  remuneracao: number
  total_descontos: number
  liquido: number
  encargos: Record<string, number>
  beneficios: Record<string, number>
  provisoes: Record<string, number>
  custo_mes: number
  custo_com_provisoes: number
  guias: { fgts: number; inss: number; irrf: number }
  parametros_conferidos: boolean
  parametros_ano: number | null
}

export interface ContratoResp extends Contrato {
  funcionario_id: string
  cadastrado: boolean
  calculo: CalculoFolha
}

export interface CustosFolha {
  por_funcionario: Record<string, { salario_base: number; liquido: number; custo_mes: number; custo_com_provisoes: number }>
  por_centro: Record<string, { pessoas: number; custo_mes: number; custo_com_provisoes: number }>
  total_mes: number
  parametros_conferidos: boolean
  parametros_ano: number | null
}

export const TIPOS_CONTRATO: { id: TipoContrato; nome: string }[] = [
  { id: 'clt', nome: 'CLT' },
  { id: 'estagio', nome: 'Estágio' },
  { id: 'pj', nome: 'PJ' },
  { id: 'pro_labore', nome: 'Pró-labore' },
]

export const ROTULOS: Record<string, string> = {
  salario: 'Salário base', adicionais: 'Adicionais', he50: 'Horas extras 50%', he100: 'Horas extras 100%',
  comissao: 'Comissão', premio: 'Prêmio', dsr: 'DSR',
  faltas: 'Faltas', inss: 'INSS', irrf: 'IRRF', vt: 'Vale-transporte', plano_saude: 'Plano de saúde',
  pensao: 'Pensão alimentícia', sindical: 'Contribuição sindical', adiantamento: 'Adiantamento', outros: 'Outros descontos',
  fgts: 'FGTS (8%)', inss_patronal: 'INSS patronal', va: 'Vale-alimentação', seguro_vida: 'Seguro de vida',
  decimo_terceiro: '13º (1/12)', ferias: 'Férias + 1/3 (1/12)', fgts_provisoes: 'FGTS s/ provisões',
}
