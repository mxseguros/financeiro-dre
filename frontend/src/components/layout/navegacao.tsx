import { permissaoPagamentos, permissaoRelatorios, type Permissions, type Role } from '@/types'

/**
 * Navegação do painel (redesenho UX, fase 1 — 25/11/2026): itens do menu em
 * 3 grupos, título/subtítulo de cada rota na barra do topo e se a rota mostra
 * o seletor de período global. Menu lateral (desktop), barra inferior e
 * folha "Mais" (celular) leem daqui.
 */

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden="true">{d}</svg>
)

export const Icon = {
  grid:    svg(<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>),
  kanban:  svg(<><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="8" rx="1"/></>),
  chart:   svg(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>),
  book:    svg(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>),
  gear:    svg(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>),
  ajuda:   svg(<><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>),
  compass: svg(<><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></>),
  table:   svg(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></>),
  bank:    svg(<path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z"/>),
  chat:    svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>),
  mais:    svg(<><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>),
  sair:    svg(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>),
  download:svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>),
}

export type PermissaoTela = keyof Permissions
export type Contador = 'aprovacoes' | 'pagamentos'

export interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  permissaoTela?: PermissaoTela
  contador?: Contador
}

export interface NavGrupo { titulo: string; itens: NavItem[] }

// "Exportações" saiu do menu: exportar é o botão da barra do topo.
export const GRUPOS: NavGrupo[] = [
  { titulo: 'Acompanhar', itens: [
    { href: '/dashboard',            label: 'Visão Geral', icon: Icon.grid,  permissaoTela: 'visao_geral' },
    { href: '/dashboard/dre',        label: 'DRE',         icon: Icon.chart, permissaoTela: 'dre' },
    { href: '/dashboard/relatorios', label: 'Relatórios',  icon: Icon.table, permissaoTela: 'relatorios' },
    { href: '/dashboard/chat',       label: 'Assistente IA', icon: Icon.chat },
  ] },
  { titulo: 'Operar', itens: [
    { href: '/dashboard/lancamentos',            label: 'Lançamentos', icon: Icon.book,   permissaoTela: 'lancamentos' },
    { href: '/dashboard/lancamentos/aprovacoes', label: 'Aprovações',  icon: Icon.kanban, permissaoTela: 'aprovacoes', contador: 'aprovacoes' },
    { href: '/dashboard/lancamentos/pagamentos', label: 'Pagamentos',  icon: Icon.bank,   permissaoTela: 'pagamentos', contador: 'pagamentos' },
  ] },
  { titulo: 'Ajustar', itens: [
    { href: '/dashboard/configuracoes', label: 'Configurações',          icon: Icon.gear,  permissaoTela: 'configuracoes' },
    { href: '/dashboard/ajuda',         label: 'Ajuda e tour guiado',    icon: Icon.ajuda },
  ] },
]

const TODOS = GRUPOS.flatMap(g => g.itens)

/** Âncora do tour guiado: `menu-<último trecho da rota>` (ver components/tour/tour.ts). */
export const ancoraTour = (href: string) => `menu-${href.split('/').pop()}`

export function itemVisivel(item: NavItem, permissions: Permissions, role: Role): boolean {
  if (!item.permissaoTela) return true
  if (item.permissaoTela === 'relatorios') return permissaoRelatorios(permissions, role, 'visualizar')
  if (item.permissaoTela === 'pagamentos') return permissaoPagamentos(permissions, role, 'visualizar')
  return permissions[item.permissaoTela]?.visualizar === true
}

/** Item ativo: o mais específico que casa com a rota (Aprovações não acende Lançamentos). */
export function itemAtivo(href: string, pathname: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  if (pathname === href) return true
  if (pathname.startsWith(href + '/')) {
    return !TODOS.some(n => n.href !== href && n.href.startsWith(href + '/') && pathname.startsWith(n.href))
  }
  return false
}

/** `true` = seletor de período; `'intervalo'` = modo Mês com De/Até; `false` = sem período. */
export type ModoTopo = boolean | 'intervalo'

interface MetaRota { titulo: string; subtitulo: string; periodo: ModoTopo; exportar?: boolean }

const ROTAS: [string, MetaRota][] = [
  ['/dashboard/lancamentos/aprovacoes', { titulo: 'Aprovações',  subtitulo: 'Despesas e ordens de compra · arraste os cards para Aprovar ou Rejeitar', periodo: true, exportar: true }],
  ['/dashboard/lancamentos/pagamentos', { titulo: 'Pagamentos',  subtitulo: 'Despesas aprovadas pagas por arquivo do banco (CNAB)', periodo: false }],
  ['/dashboard/lancamentos',            { titulo: 'Lançamentos', subtitulo: 'Despesas e receitas por centro de custo e banco', periodo: 'intervalo', exportar: true }],
  ['/dashboard/dre/metas',              { titulo: 'Metas (Previsto)', subtitulo: 'Orçamento mensal por conta', periodo: false }],
  ['/dashboard/dre',                    { titulo: 'DRE',          subtitulo: 'Previsto x Realizado', periodo: false, exportar: true }],
  ['/dashboard/relatorios',             { titulo: 'Relatórios',   subtitulo: 'Monte o relatório como numa tabela dinâmica', periodo: false }],
  ['/dashboard/configuracoes',          { titulo: 'Configurações', subtitulo: 'Cadastros, usuários e parâmetros do sistema', periodo: false }],
  ['/dashboard/chat',                   { titulo: 'Assistente IA', subtitulo: 'Pergunte sobre os números do período', periodo: true }],
  ['/dashboard/ajuda',                  { titulo: 'Ajuda',        subtitulo: 'Respostas rápidas e tour guiado', periodo: false }],
  ['/dashboard/exports',                { titulo: 'Exportações',  subtitulo: 'Baixe os relatórios em planilha', periodo: false }],
  ['/dashboard',                        { titulo: 'Visão Geral',  subtitulo: 'Previsto x pago e posição por banco', periodo: true, exportar: true }],
]

export function metaDaRota(pathname: string): MetaRota {
  const achou = ROTAS.find(([r]) => pathname === r || pathname.startsWith(r + '/'))
  return achou ? achou[1] : { titulo: 'MX Seguros', subtitulo: '', periodo: false }
}

export function iniciais(nome: string, email: string): string {
  const base = (nome || email.split('@')[0] || '?').trim()
  const partes = base.split(/[\s._-]+/).filter(Boolean)
  return ((partes[0]?.[0] ?? '?') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

export const ROTULO_PERFIL: Record<Role, string> = {
  admin: 'Admin', gestor: 'Gestor', comercial: 'Comercial', contador: 'Contador', colaborador: 'Colaborador',
}
