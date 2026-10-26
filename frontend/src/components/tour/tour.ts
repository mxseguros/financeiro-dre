'use client'
import { driver, type DriveStep, type Side } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * Tour guiado (Driver.js): escurece o fundo e destaca um elemento por vez.
 *
 * Os passos apontam para atributos `data-tour="..."` nas telas. Passo cujo
 * elemento não está na tela — sem permissão para aquele menu, bloco que não
 * carregou, menu lateral fechado no celular — é pulado em vez de abrir um
 * balão solto no meio da página.
 */

interface Passo {
  el?: string
  titulo: string
  texto: string
  lado?: Side
}

const PERIODO = (texto: string): Passo => ({
  el: 'periodo',
  titulo: 'Período',
  texto: `${texto} Escolha Dia, Mês, Ano ou Período, de uma data até outra (Dia e Período usam vencimento/recebimento). O mês escolhido acompanha você nas outras telas até uma nova escolha.`,
})

const MENU: Passo[] = [
  {
    titulo: 'Bem-vindo ao DRE da MX Seguros',
    texto: 'Um passeio rápido pelo sistema. Use as setas do teclado ou os botões abaixo, e Esc para sair a qualquer momento.',
  },
  { el: 'menu-dashboard',     lado: 'right', titulo: 'Visão Geral',      texto: 'Previsto x pago do mês, totais dos próximos 12 meses e a posição por banco.' },
  { el: 'menu-dre',           lado: 'right', titulo: 'DRE',              texto: 'Demonstração de Resultados: previsto x realizado, com as metas do ano.' },
  { el: 'menu-lancamentos',   lado: 'right', titulo: 'Lançamentos',      texto: 'Onde se registram despesas, receitas e ordens de compra, e se importa o extrato do banco.' },
  { el: 'menu-aprovacoes',    lado: 'right', titulo: 'Aprovações',       texto: 'Quadro para aprovar ou rejeitar o que foi lançado.' },
  { el: 'menu-exports',       lado: 'right', titulo: 'Exportações',      texto: 'Baixe os relatórios em planilha.' },
  { el: 'menu-relatorios',    lado: 'right', titulo: 'Relatórios',       texto: 'Monte o seu relatório como na tabela dinâmica do Excel: escolha o que vai nas linhas, nas colunas e o que somar.' },
  { el: 'menu-ajuda',         lado: 'right', titulo: 'FAQ',              texto: 'Respostas para as dúvidas mais comuns.' },
  { el: 'menu-configuracoes', lado: 'right', titulo: 'Configurações',    texto: 'Cadastros (categorias, subitens, bancos e centros de custo) e usuários.' },
  { el: 'menu-tour',          lado: 'right', titulo: 'Tour guiado',      texto: 'Clique aqui quando quiser rever o passo a passo da tela em que estiver.' },
]

const TELAS: Record<string, Passo[]> = {
  '/dashboard': [
    PERIODO('Escolha o mês que quer analisar.'),
    { el: 'kpis',      titulo: 'Indicadores do mês', texto: 'Saldo do período do Itaú e do Santander: saldo inicial, empréstimo, saldo de aplicação, saldo do banco e o resultado.' },
    { el: 'por-banco', titulo: 'Por Banco',          texto: 'Receitas e despesas por conta bancária — pela data de pagamento ou de recebimento no período. Despesas: só Fixo e Variável; receitas só de Receitas de vendas.' },
  ],
  '/dashboard/lancamentos': [
    PERIODO('Defina o intervalo De/Até dos lançamentos listados.'),
    { el: 'novos-lancamentos', titulo: 'Novo lançamento',  texto: 'Registre uma despesa, uma receita ou uma ordem de compra.' },
    { el: 'importar',          titulo: 'Importar extrato', texto: 'Envie o extrato do banco (OFX ou CSV) para lançar várias movimentações de uma vez.' },
    { el: 'resumo',            titulo: 'Totais',           texto: 'Somatório do período selecionado.' },
    { el: 'filtros',           titulo: 'Filtros', texto: 'Abra pelo ícone: Categoria e Subitem (tipo), banco, centro de custo e status. O número no botão mostra quantos filtros estão ativos.' },
    { el: 'tabela',            titulo: 'Lista',            texto: 'Lançamentos separados em Despesas, Receitas e Ordens de Compra, com busca por descrição.', lado: 'top' },
  ],
  '/dashboard/lancamentos/aprovacoes': [
    PERIODO('Escolha o mês a aprovar.'),
    { el: 'kanban', titulo: 'Quadro de aprovação', texto: 'Despesas e ordens de compra a aprovar. Arraste os cards entre as colunas para aprovar ou rejeitar. Receitas não passam por aqui: já nascem aprovadas.', lado: 'top' },
  ],
  '/dashboard/dre': [
    PERIODO('Escolha o ano e o mês de referência.'),
    { el: 'visao',         titulo: 'Visão',                     texto: 'Mês, Acumulado do ano ou últimos 12 meses.' },
    { el: 'metas',         titulo: 'Metas (Previsto)',          texto: 'Cadastre o previsto que é comparado com o realizado.' },
    { el: 'kpis',          titulo: 'Indicadores',               texto: 'Os principais números do período escolhido.' },
    { el: 'demonstrativo', titulo: 'Demonstração de Resultados', texto: 'A DRE linha a linha, previsto x realizado.', lado: 'top' },
  ],
  '/dashboard/assistente': [
    PERIODO('O Monitor analisa os lançamentos deste mês.'),
    { el: 'severidades', titulo: 'Pontos de atenção', texto: 'Quantos alertas há em cada nível: Crítico, Atenção e Info. A lista detalhada fica logo abaixo.' },
    { el: 'conciliacao', titulo: 'Visão Geral × DRE', texto: 'Por que a receita da Visão Geral é diferente da linha Receita da DRE, motivo a motivo, com o que corrigir.', lado: 'top' },
    { el: 'resumo-ia',   titulo: 'Resumo com IA',     texto: 'Gera um resumo priorizado dos alertas do mês.' },
  ],
  '/dashboard/relatorios': [
    PERIODO('O relatório usa os lançamentos deste período.'),
    { el: 'rel-modelos', titulo: 'Modelos prontos', texto: 'Comece por um modelo (despesas por categoria × mês, fluxo por banco…) e ajuste a partir dele.' },
    { el: 'rel-campos',  titulo: 'Campos',          texto: 'Arraste um campo para uma das áreas ao lado, ou clique no + do campo. Para tirar, arraste de volta ou clique no ×.', lado: 'right' },
    { el: 'rel-areas',   titulo: 'Linhas, colunas, valores e filtros', texto: 'Linhas e Colunas agrupam; Valores escolhe o que somar (Soma, Média, % do total…); Filtros abre uma lista com caixas de marcar.' },
    { el: 'rel-tabela',  titulo: 'Resultado',       texto: 'Recalcula a cada mudança. Clique num número para ver os lançamentos que o formam; ▾ recolhe um grupo.', lado: 'top' },
  ],
}

/** Elemento existe e está dentro da tela (o menu lateral fica fora dela no celular). */
function noViewport(el: Element | null): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth
}

function montar(passos: Passo[]): DriveStep[] {
  return passos
    .filter(p => !p.el || noViewport(document.querySelector(`[data-tour="${p.el}"]`)))
    .map(p => ({
      element: p.el ? `[data-tour="${p.el}"]` : undefined,
      popover: { title: p.titulo, description: p.texto, side: p.lado ?? 'bottom', align: 'start' },
    }))
}

export const temTourDaTela = (pathname: string) => pathname in TELAS

/**
 * `completo`: menu + tela atual (primeiro acesso).
 * Sem ele: só a tela atual — ou o menu, se a tela não tem tour próprio.
 */
export function iniciarTour(pathname: string, { completo = false } = {}) {
  const daTela = TELAS[pathname] ?? []
  const passos = montar(completo || daTela.length === 0 ? [...MENU, ...daTela] : daTela)
  if (passos.length === 0) return

  driver({
    steps: passos,
    showProgress: passos.length > 1,
    progressText: '{{current}} de {{total}}',
    nextBtnText: 'Próximo',
    prevBtnText: 'Anterior',
    doneBtnText: 'Concluir',
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: 'tour-mx',
  }).drive()
}

const CHAVE_VISTO = 'dre.tour.v1.'

/** Primeiro acesso do usuário neste navegador: roda o tour completo uma vez. */
export function tourInicialPendente(userId: string): boolean {
  try { return !window.localStorage.getItem(CHAVE_VISTO + userId) } catch { return false }
}

export function marcarTourVisto(userId: string) {
  try { window.localStorage.setItem(CHAVE_VISTO + userId, '1') } catch { /* sem storage: só não lembra */ }
}
