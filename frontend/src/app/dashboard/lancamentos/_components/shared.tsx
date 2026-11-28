export interface Categoria { id: string; nome: string; natureza: string; ordem: number; ativo: boolean }
export interface TipoLancamento { id: string; nome: string; natureza: string; categoria_id: string | null; custo_tipo: string | null; somente_dre?: boolean }
export interface Banco { id: string; nome: string }

/** Classificação dos subitens — lista editável em Configurações (migration 0039). */
export interface Classificacao { codigo: string; nome: string; natureza: string; ordem: number; ativo: boolean; sistema: boolean; usada_dre?: boolean }
export const CLASSIFICACOES_PADRAO: Classificacao[] = [
  { codigo: 'fixo', nome: 'Fixo', natureza: 'ambas', ordem: 1, ativo: true, sistema: true, usada_dre: true },
  { codigo: 'variavel', nome: 'Variável', natureza: 'ambas', ordem: 2, ativo: true, sistema: true, usada_dre: true },
  { codigo: 'imposto', nome: 'Imposto', natureza: 'ambas', ordem: 3, ativo: true, sistema: true, usada_dre: true },
  { codigo: 'nao_operacional', nome: 'Não Operacional', natureza: 'ambas', ordem: 4, ativo: true, sistema: true, usada_dre: true },
]
/** Opções do campo Classificação para a natureza (ativas + a atual, mesmo se desativada). */
export function classificacoesDe(lista: Classificacao[] | undefined, natureza: 'despesa' | 'receita', atual?: string | null) {
  return (lista?.length ? lista : CLASSIFICACOES_PADRAO)
    .filter(c => (c.natureza === natureza || c.natureza === 'ambas') && (c.ativo || c.codigo === atual))
}
export type { CentroCusto } from '@/lib/centros'

export interface Despesa {
  id: string; competencia: string; tipo_lancamento_id: string | null; banco_id: string | null
  tipo_nome: string | null; categoria: string | null; descricao: string
  centro_custo: string; banco_nome: string | null; valor: number
  data_vencimento: string | null; paga_em: string | null; status: string
  recorrente: boolean; parcela_atual: number | null; parcela_total: number | null
  /** "Total Salários Funcionários" (0046): soma de salários para quem não é Admin. Não é editável. */
  agregado?: boolean; quantidade?: number | null
  criado_em: string | null; atualizado_em?: string | null
  criado_por?: string | null
  /** Classificação do lançamento (migration 0040). */
  custo_tipo?: string | null
}
export interface DespesasResp {
  total: number; items: Despesa[]; soma_total: number; total_pendentes: number
  /** Resumo da aba (26/11/2026), sobre o período inteiro: pago + a pagar + vencido = soma_total. */
  soma_paga?: number | string; soma_a_pagar?: number | string; soma_vencida?: number | string
  qtd_paga?: number; qtd_a_pagar?: number; qtd_vencida?: number
  /** Chips de Situação (28/11/2026): quantidade por situação, sem a situação escolhida. */
  contagem_situacao?: Record<string, number>
}

export interface Receita {
  id: string; competencia: string; tipo_lancamento_id: string | null; banco_id: string | null
  tipo_nome: string | null; descricao: string; centro_custo: string | null
  banco_nome: string | null; valor: number; data_vencimento: string | null; recebido_em: string | null
  observacao: string | null; origem: string; criado_em: string | null; atualizado_em?: string | null
  /** Bloco Recebimento do modal (0054). */
  recebido_de?: string | null; forma_recebimento?: string | null
  /** So receita manual tem status (migration 0032); comissao vem de apolice e nao passa por aprovacao. */
  status?: 'pendente' | 'aprovada' | 'rejeitada' | 'excluida' | null
  /** Subitem "Constar apenas na DRE": listada, mas fora dos totais. */
  somente_dre?: boolean
  rejeitado_motivo?: string | null
  /** Classificação do lançamento (migration 0040). */
  custo_tipo?: string | null
}
export interface ReceitasResp {
  total: number; items: Receita[]; soma_total: number
  contagem_situacao?: Record<string, number>
}

export interface OrdemCompra {
  id: string; solicitante: string; assunto: string; descricao: string
  valor: number | null; data_solicitacao: string; status: string
  criado_por: string | null; aprovado_por: string | null
  aprovado_em: string | null; rejeitado_motivo: string | null; criado_em: string | null; atualizado_em?: string | null
  /** 0047: quando a despesa acontece (pode ser futura), centro e a despesa gerada na aprovação. */
  data_prevista?: string | null; centro_custo?: string | null
  tipo_lancamento_id?: string | null; despesa_id?: string | null
  /** 0048: funcionário da ordem e recibo depois da aprovação. */
  funcionario_id?: string | null
  recibo_status?: 'aguardando' | 'enviado' | 'aprovado' | 'devolvido' | null
  recibo_motivo?: string | null; recibo_enviado_em?: string | null; recibo_conferido_em?: string | null
}
export interface OrdensCompraResp { total: number; items: OrdemCompra[]; soma_total: number; total_pendentes: number }

// Tipos de receita com valor único mensal
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

/**
 * Espelha app/regras_lancamento.py: admin/gestor excluem qualquer lançamento;
 * os demais só o que criaram, e só enquanto não aprovado. Serve para esconder
 * o botão que o backend recusaria — a regra de verdade é a do servidor.
 */
export function podeExcluirLancamento(
  item: { status?: string | null; criado_por?: string | null },
  role: string | null,
  userId: string | null,
): boolean {
  if (role === 'admin' || role === 'gestor') return true
  return item.status !== 'aprovada' && !!userId && item.criado_por === userId
}

/** No lugar de editar/excluir, na linha "Total Salários Funcionários" (0046). */
export function CadeadoConfidencial({ n }: { n?: number | null }) {
  const qtd = n ? `${n} lançamento${n > 1 ? 's' : ''}` : 'lançamentos'
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"
      title={`Soma de ${qtd} de salário. O detalhe por funcionário é visível só para o Admin.`}>
      <span aria-hidden>🔒</span>{n ? n : ''}
      <span className="sr-only">Confidencial: soma de {qtd}, detalhe só para o Admin</span>
    </span>
  )
}
