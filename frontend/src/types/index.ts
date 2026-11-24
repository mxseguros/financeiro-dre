export type Role = 'admin' | 'gestor' | 'comercial' | 'contador' | 'colaborador'

export interface Permissions {
  visao_geral:   { visualizar: boolean }
  dre:           { visualizar: boolean }
  lancamentos:   { visualizar: boolean; criar: boolean; editar: boolean; deletar: boolean }
  aprovacoes:    { visualizar: boolean; aprovar: boolean }
  /** Antigo Monitoramento IA. Fica só para ler permissões gravadas antes de Relatórios. */
  assistente:    { visualizar: boolean }
  /** Opcional: permissões personalizadas antigas não têm (ver permissaoRelatorios). */
  relatorios?:   { visualizar: boolean; criar: boolean; compartilhar: boolean }
  configuracoes: { visualizar: boolean; criar: boolean; editar: boolean; deletar: boolean }
  /** Perfil Colaborador (0047): só a página /oc. */
  ordem_compra?: { visualizar: boolean; criar: boolean }
}

export const DEFAULT_PERMISSIONS: Record<Role, Permissions> = {
  admin: {
    visao_geral:   { visualizar: true },
    dre:           { visualizar: true },
    lancamentos:   { visualizar: true, criar: true, editar: true, deletar: true },
    aprovacoes:    { visualizar: true, aprovar: true },
    assistente:    { visualizar: true },
    relatorios:    { visualizar: true, criar: true, compartilhar: true },
    configuracoes: { visualizar: true, criar: true, editar: true, deletar: true },
  },
  gestor: {
    visao_geral:   { visualizar: true },
    dre:           { visualizar: true },
    lancamentos:   { visualizar: true, criar: true, editar: true, deletar: false },
    aprovacoes:    { visualizar: true, aprovar: true },
    assistente:    { visualizar: true },
    relatorios:    { visualizar: true, criar: true, compartilhar: true },
    configuracoes: { visualizar: true, criar: true, editar: true, deletar: true },
  },
  comercial: {
    visao_geral:   { visualizar: true },
    dre:           { visualizar: true },
    lancamentos:   { visualizar: true, criar: true, editar: false, deletar: false },
    aprovacoes:    { visualizar: false, aprovar: false },
    assistente:    { visualizar: true },
    relatorios:    { visualizar: true, criar: true, compartilhar: false },
    configuracoes: { visualizar: true, criar: false, editar: false, deletar: false },
  },
  contador: {
    visao_geral:   { visualizar: true },
    dre:           { visualizar: true },
    lancamentos:   { visualizar: true, criar: true, editar: false, deletar: false },
    aprovacoes:    { visualizar: false, aprovar: false },
    assistente:    { visualizar: true },
    relatorios:    { visualizar: true, criar: true, compartilhar: false },
    configuracoes: { visualizar: true, criar: false, editar: false, deletar: false },
  },
  // Funcionário que só lança Ordem de Compra pelo link /oc (espelha app/permissions.py).
  colaborador: {
    visao_geral:   { visualizar: false },
    dre:           { visualizar: false },
    lancamentos:   { visualizar: false, criar: false, editar: false, deletar: false },
    aprovacoes:    { visualizar: false, aprovar: false },
    assistente:    { visualizar: false },
    relatorios:    { visualizar: false, criar: false, compartilhar: false },
    configuracoes: { visualizar: false, criar: false, editar: false, deletar: false },
    ordem_compra:  { visualizar: true, criar: true },
  },
}

/**
 * Permissão da tela Relatórios (espelha app/permissions.py). Permissões
 * personalizadas gravadas antes dela não têm a chave: ver e criar seguem o "Ver"
 * do antigo Monitoramento IA; compartilhar fica com Admin e Gestor.
 */
export function permissaoRelatorios(
  p: Permissions | null | undefined, role: Role | null | undefined, acao: 'visualizar' | 'criar' | 'compartilhar',
): boolean {
  if (!p) return false
  if (p.relatorios) return p.relatorios[acao] === true
  if (acao === 'compartilhar') return role === 'admin' || role === 'gestor'
  return p.assistente?.visualizar === true
}

export function getDefaultPermissions(role: Role): Permissions {
  return DEFAULT_PERMISSIONS[role]
}

export interface Usuario {
  id: string
  nome: string
  email: string
  role: Role
  equipe_id: string | null
  produtor_id: string | null
  ativo: boolean
  permissions?: Permissions | null
}

export interface LinhasDRE {
  receita_bruta: number
  estornos: number
  impostos: number
  receita_liquida: number | null
  repasses_produtores: number | null
  margem_contribuicao: number | null
  despesas_fixas: number | null
  ebitda: number | null
  despesas_nao_operacionais: number | null
  resultado_liquido: number | null
}

export interface DREResponse {
  periodo: { inicio: string; fim: string }
  dre: LinhasDRE
  perfil: string
}

export interface AlertaDashboard {
  tipo: string
  mensagem: string
  severidade: 'info' | 'aviso' | 'critico'
}

export interface DashboardResponse {
  periodo: { inicio: string; fim: string }
  dre: LinhasDRE
  perfil: string
  // Boxes da Visão Geral (escopo de 19/10/2026). Decimal chega como string no JSON.
  resumo?: {
    previsto: { receitas: number | string; despesas: number | string; saldo: number | string }
    despesas_pagas: number | string
    total_geral: { receitas: number | string; despesas: number | string; saldo: number | string; ate: string }
  } | null
  alertas: AlertaDashboard[]
  latencia_ms: number
}

export interface ChatMensagem {
  role: 'user' | 'assistant'
  content: string
}

export interface UsuarioItem {
  id: string
  nome: string
  email: string
  role: Role
  equipe_id: string | null
  produtor_id: string | null
  ativo: boolean
  permissions?: Permissions | null
}

export type StatusDespesa = 'pendente' | 'aprovada' | 'rejeitada'

export interface Despesa {
  id: string
  tipo_lancamento_id: string | null
  tipo_nome: string | null
  banco_id: string | null
  banco_nome: string | null
  categoria: string | null
  subcategoria: string
  descricao: string
  valor: number
  competencia: string
  data_vencimento: string | null
  paga_em: string | null
  /** "Total Salários Funcionários" (0046): soma para quem não é Admin, não é editável. */
  agregado?: boolean
  quantidade?: number | null
  centro_custo: string
  recorrente: boolean
  parcela_atual: number | null
  parcela_total: number | null
  criado_em: string | null; atualizado_em?: string | null
  status: StatusDespesa
  criado_por: string | null
  aprovado_por: string | null
  aprovado_em: string | null
  rejeitado_motivo: string | null
}

export interface DespesasResponse {
  total: number
  items: Despesa[]
  soma_total: number
  total_pendentes: number
}
