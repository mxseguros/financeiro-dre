// Pagamentos por CNAB 240 (migration 0050): favorecidos, contas pagadoras e o
// bloco "Pagamento" da despesa. Dados bancários chegam mascarados para quem
// não gera remessa (os campos completos vêm null).

export type FormaPagamento = 'pix' | 'pix_qr' | 'ted' | 'credito_conta' | 'boleto' | 'concessionaria' | 'tributo'
export type TipoChave = 'telefone' | 'email' | 'cpf_cnpj' | 'aleatoria'
export type TipoConta = 'corrente' | 'poupanca' | 'pagamento'

export const FORMAS: { id: FormaPagamento; nome: string; dica: string }[] = [
  { id: 'pix', nome: 'Pix', dica: 'Pela chave ou pela conta do favorecido' },
  { id: 'pix_qr', nome: 'Pix QR Code', dica: 'Copia-e-cola (inclui a guia do FGTS Digital)' },
  { id: 'ted', nome: 'TED', dica: 'Conta em outro banco' },
  { id: 'credito_conta', nome: 'Crédito em conta', dica: 'Conta no mesmo banco da conta pagadora' },
  { id: 'boleto', nome: 'Boleto', dica: 'Linha digitável de 47 números' },
  { id: 'concessionaria', nome: 'Conta ou tributo com código', dica: 'Água, luz, telefone, DAS, guias com código de 48 números' },
  { id: 'tributo', nome: 'DARF / GPS sem código', dica: 'Guia sem código de barras' },
]
export const FORMAS_FAVORECIDO = FORMAS.filter(f => ['pix', 'ted', 'credito_conta', 'boleto'].includes(f.id))
export const nomeForma = (f: string | null | undefined) => FORMAS.find(x => x.id === f)?.nome ?? '—'

export const TIPOS_CHAVE: { id: TipoChave; nome: string; exemplo: string }[] = [
  { id: 'cpf_cnpj', nome: 'CPF/CNPJ', exemplo: '000.000.000-00' },
  { id: 'email', nome: 'E-mail', exemplo: 'financeiro@empresa.com.br' },
  { id: 'telefone', nome: 'Celular', exemplo: '(11) 99999-0000' },
  { id: 'aleatoria', nome: 'Chave aleatória', exemplo: '123e4567-e89b-12d3-a456-426614174000' },
]

export const TIPOS_CONTA: { id: TipoConta; nome: string }[] = [
  { id: 'corrente', nome: 'Conta corrente' },
  { id: 'poupanca', nome: 'Poupança' },
  { id: 'pagamento', nome: 'Conta de pagamento' },
]

export interface DadosBancarios {
  banco_codigo: string | null
  ispb: string | null
  agencia: string | null
  agencia_dv: string | null
  conta: string | null
  conta_dv: string | null
  tipo_conta: TipoConta | null
  pix_tipo_chave: TipoChave | null
  pix_chave: string | null
  forma_pagamento_padrao: FormaPagamento | null
}

export interface Fornecedor extends DadosBancarios {
  id: string
  nome: string
  tipo_pessoa: 'F' | 'J'
  cpf_cnpj: string | null
  funcionario_id: string | null
  ativo: boolean
  conta_mascarada: string | null
  pix_mascarada: string | null
  documento_mascarado: string | null
  tem_conta: boolean
  tem_pix: boolean
}

export interface OpcoesConvenio {
  sequencial_teste: boolean
  seu_numero_obrigatorio: boolean
  sequencia: 'nenhuma' | 'restrita' | 'diferente'
  enviar_bloqueado: boolean
}

export interface ContaPagadora {
  id: string
  codigo_banco: '033' | '341'
  apelido: string | null
  agencia: string
  agencia_dv: string | null
  conta: string | null
  conta_dv: string | null
  cnpj_empresa: string
  razao_social: string
  codigo_convenio: string | null
  endereco: Record<string, string> | null
  proximo_nsa: number
  ambiente: 'homologacao' | 'producao'
  opcoes: OpcoesConvenio
  ativa: boolean
  descricao: string
}

export type StatusPagamento = 'em_remessa' | 'agendada' | 'bloqueada_banco' | 'paga' | 'rejeitada' | 'devolvida' | 'paga_manual'

export const STATUS_PAGAMENTO: Record<StatusPagamento, { nome: string; cor: string }> = {
  em_remessa:      { nome: 'Em remessa', cor: 'bg-blue-50 text-blue-700' },
  agendada:        { nome: 'Agendado no banco', cor: 'bg-indigo-50 text-indigo-700' },
  bloqueada_banco: { nome: 'Autorizar no banco', cor: 'bg-amber-50 text-amber-700' },
  paga:            { nome: 'Pago', cor: 'bg-green-50 text-green-700' },
  paga_manual:     { nome: 'Pago (baixa manual)', cor: 'bg-green-50 text-green-700' },
  rejeitada:       { nome: 'Rejeitado pelo banco', cor: 'bg-red-50 text-red-700' },
  devolvida:       { nome: 'Devolvido', cor: 'bg-red-50 text-red-700' },
}
export const TRAVADOS: StatusPagamento[] = ['em_remessa', 'agendada', 'bloqueada_banco', 'paga', 'paga_manual']

export interface Tributo {
  tipo: 'darf' | 'gps'
  codigo_receita: string
  periodo_apuracao?: string
  competencia?: string
  numero_referencia?: string
  valor_principal?: string
  valor_multa?: string
  valor_juros?: string
  valor_outras?: string
  contribuinte_doc?: string
}

export interface PagamentoDespesa {
  habilitado: boolean
  fornecedor_id?: string | null
  forma_pagamento?: FormaPagamento | null
  valor_pagamento?: string | null
  codigo_barras?: string | null
  linha_digitavel?: string | null
  vencimento_boleto?: string | null
  cedente_cpf_cnpj?: string | null
  cedente_nome?: string | null
  pix_copia_cola?: string | null
  tributo?: Tributo | null
  status_pagamento?: StatusPagamento | null
  valor_despesa?: string
  favorecido?: Fornecedor | null
  avisos?: string[]
}

export interface DocumentoLido {
  tipo: 'boleto' | 'concessionaria' | 'pix_qr'
  valor: string | null
  vencimento?: string | null
  codigo_barras?: string
  dinamico?: boolean
  recebedor?: string | null
}

export const somenteDigitos = (s: string) => s.replace(/\D/g, '')
