export interface Categoria { id: string; nome: string; natureza: string; ordem: number; ativo: boolean }
export interface TipoLancamento { id: string; nome: string; natureza: string; categoria_id: string | null; custo_tipo: string | null }
export interface Banco { id: string; nome: string }
export interface CentroCusto { id: string; nome: string; codigo: string; ativo: boolean }

export interface Despesa {
  id: string; competencia: string; tipo_lancamento_id: string | null; banco_id: string | null
  tipo_nome: string | null; categoria: string | null; descricao: string
  centro_custo: string; banco_nome: string | null; valor: number
  data_vencimento: string | null; paga_em: string | null; status: string
  recorrente: boolean; parcela_atual: number | null; parcela_total: number | null
  criado_em: string | null; atualizado_em?: string | null
}
export interface DespesasResp { total: number; items: Despesa[]; soma_total: number; total_pendentes: number }

export interface Receita {
  id: string; competencia: string; tipo_lancamento_id: string | null; banco_id: string | null
  tipo_nome: string | null; descricao: string; centro_custo: string | null
  banco_nome: string | null; valor: number; data_vencimento: string | null; recebido_em: string | null
  observacao: string | null; origem: string; criado_em: string | null; atualizado_em?: string | null
  /** So receita manual tem status (migration 0032); comissao vem de apolice e nao passa por aprovacao. */
  status?: 'pendente' | 'aprovada' | 'rejeitada' | 'excluida' | null
  rejeitado_motivo?: string | null
}
export interface ReceitasResp { total: number; items: Receita[]; soma_total: number }

export interface OrdemCompra {
  id: string; solicitante: string; assunto: string; descricao: string
  valor: number | null; data_solicitacao: string; status: string
  criado_por: string | null; aprovado_por: string | null
  aprovado_em: string | null; rejeitado_motivo: string | null; criado_em: string | null; atualizado_em?: string | null
}
export interface OrdensCompraResp { total: number; items: OrdemCompra[]; soma_total: number; total_pendentes: number }

// Tipos de receita com valor único mensal
export const TIPOS_VALOR_UNICO = ['comissões de vendas', 'comissões - adicionais / premiações', 'receitas de vendas']

// Sugestão do Copiloto de IA (POST /lancamentos/sugestao)
export type SugestaoIA = {
  disponivel: boolean
  subitem_id?: string | null
  subitem_nome?: string | null
  categoria_id?: string | null
  categoria_nome?: string | null
  classificacao?: string | null
  confianca?: string | null
  motivo?: string | null
  duplicata?: { quantidade: number } | null
}

export function fmtCompetencia(d: string) {
  const dt = new Date(d + 'T12:00:00')
  return dt.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
}

export function Badge({ text, cor }: { text: string; cor: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${cor}`}>{text}</span>
}

export function tipoCor(_tipo?: string | null) {
  // Todas as tags da coluna Tipo usam a mesma cor: bg #FEF2F2 (red-50) / texto #DC2626 (red-600)
  return 'bg-red-50 text-red-600'
}

// Fonte única do badge de status. Reexportado aqui só para não quebrar os
// imports existentes de `./shared` — a implementação vive em components/ui.
export { StatusBadge } from '@/components/ui/StatusBadge'

// ── Ícones de ação ─────────────────────────────────────────────
export const IconLapis = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
export const IconLixo = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
)
export const IconCarrinho = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
)
export const IconShare = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
)

// ── Campo de formulário reutilizável ───────────────────────────
export function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-0.5">{label}</label>
      {children}
    </div>
  )
}

export const inputCls = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-navy focus-ring focus:outline-none"
export const selectCls = inputCls

export function periodoParaDatas(mIni: string, mFim: string): [string, string] {
  const [yi, moi] = mIni.split('-')
  const [yf, mof] = mFim.split('-')
  const last = new Date(Number(yf), Number(mof), 0).getDate()
  return [`${yi}-${moi}-01`, `${yf}-${mof}-${String(last).padStart(2, '0')}`]
}
