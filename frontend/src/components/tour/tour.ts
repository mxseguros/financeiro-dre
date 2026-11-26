'use client'
import { driver, type DriveStep, type Side } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * Tour guiado (Driver.js): escurece o fundo e destaca um elemento por vez.
 *
 * Os passos apontam para atributos `data-tour="..."` nas telas. Passo cujo
 * elemento não está na tela — sem permissão para aquele menu, bloco que não
 * carregou, menu lateral escondido no celular — é pulado em vez de abrir um
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
  { el: 'menu-dashboard',     lado: 'right', titulo: 'Visão Geral',      texto: 'O menu tem três grupos: Acompanhar, Operar e Ajustar. A Visão Geral mostra o previsto x pago do mês, os totais dos próximos 12 meses e a posição por banco.' },
  { el: 'menu-dre',           lado: 'right', titulo: 'DRE',              texto: 'Demonstração de Resultados: previsto x realizado, com as metas do ano.' },
  { el: 'menu-relatorios',    lado: 'right', titulo: 'Relatórios',       texto: 'Monte o seu relatório como na tabela dinâmica do Excel: escolha o que vai nas linhas, nas colunas e o que somar.' },
  { el: 'menu-chat',          lado: 'right', titulo: 'Assistente IA',    texto: 'Pergunte em português sobre os números do período escolhido. O assistente só vê o que o seu perfil pode ver.' },
  { el: 'menu-lancamentos',   lado: 'right', titulo: 'Lançamentos',      texto: 'Onde se registram despesas, receitas e ordens de compra, e se importa o extrato do banco.' },
  { el: 'menu-aprovacoes',    lado: 'right', titulo: 'Aprovações',       texto: 'Quadro para aprovar ou rejeitar o que foi lançado. O número ao lado mostra as ordens de compra aguardando aprovação.' },
  { el: 'menu-pagamentos',    lado: 'right', titulo: 'Pagamentos',       texto: 'Pague as despesas aprovadas por arquivo do banco (Santander e Itaú): gere a remessa, importe no banco e, com o retorno, a baixa é feita sozinha. O número ao lado mostra o que vence até hoje.' },
  { el: 'menu-configuracoes', lado: 'right', titulo: 'Configurações',    texto: 'Cadastros (categorias, subitens, bancos, centros de custo, funcionários, fornecedores e contas pagadoras) e usuários.' },
  { el: 'menu-ajuda',         lado: 'right', titulo: 'Ajuda e tour guiado', texto: 'Respostas para as dúvidas mais comuns.' },
  { el: 'exportar',           titulo: 'Exportar',         texto: 'Na barra do topo: baixe os relatórios em planilha.' },
  { el: 'menu-tour',          lado: 'right', titulo: 'Seu perfil',       texto: 'Clique no seu nome para rever o tour da tela em que estiver ou para sair do sistema.' },
]

const TELAS: Record<string, Passo[]> = {
  '/dashboard': [
    PERIODO('Escolha o mês que quer analisar.'),
    { el: 'kpis',      titulo: 'Saldo do período por banco', texto: 'Itaú e Santander lidos como extrato: saldo inicial, empréstimo e aplicação (acumulados desde outubro/2026) e o movimento do período, somando no Resultado. "Como é calculado" explica cada linha. Clique num valor para ver os lançamentos que o formam.' },
    { el: 'pagamentos-resumo', titulo: 'Pagamentos', texto: 'O que vence até hoje, o que está com o banco aguardando retorno, o que espera autorização no banco e o que voltou rejeitado. Clique num bloco para abrir a tela Pagamentos.' },
    { el: 'por-banco', titulo: 'Por banco',          texto: 'Receitas, despesas e saldo por conta bancária, pela data de pagamento ou de recebimento no período. Despesas: só Fixas e Variáveis; receitas só de Receitas de vendas.' },
  ],
  '/dashboard/lancamentos': [
    PERIODO('Defina o intervalo De/Até dos lançamentos listados.'),
    { el: 'novos-lancamentos', titulo: 'Novo lançamento',  texto: 'Em "+ Novo": registre uma despesa, uma receita ou uma ordem de compra, ou importe o extrato do banco (OFX ou CSV). Na despesa, o bloco Pagamento guarda o favorecido, a forma (Pix, TED, boleto, guia…) e o documento usados na remessa do banco.' },
    { el: 'resumo',            titulo: 'Resumo da aba',    texto: 'Totais da aba aberta no período: em Despesas, o que já foi pago, o que falta pagar e o que venceu; em Receitas, o recebido, o a receber e o atrasado.' },
    { el: 'filtros',           titulo: 'Filtros', texto: 'Busca e filtros à vista: Categoria, Subitem, Banco, Centro e Status. O filtro escolhido fica em azul; "Limpar filtros" tira todos.' },
    { el: 'tabela',            titulo: 'Lista',            texto: 'Clique numa linha para abrir e editar (o Excluir fica no rodapé da janela). Marque as caixas para agir em lote: marcar como paga ou levar para a remessa do banco.', lado: 'top' },
  ],
  '/dashboard/lancamentos/aprovacoes': [
    PERIODO('Escolha o mês a aprovar.'),
    { el: 'kanban', titulo: 'Quadro de aprovação', texto: 'Pendentes, Aprovadas e Rejeitadas. Use os botões Aprovar e Rejeitar do card ou arraste o card para a coluna. Marque várias despesas para aprovar de uma vez. Ordem de compra sem recibo fica com borda vermelha. Receitas não passam por aqui: já nascem aprovadas.', lado: 'top' },
  ],
  '/dashboard/lancamentos/pagamentos': [
    { el: 'pag-cartoes', titulo: 'Resumo dos pagamentos', texto: 'Quanto há a pagar, o que está em remessa ou aguardando autorização no banco, o que já foi agendado e o que voltou rejeitado ou devolvido.' },
    { el: 'pag-abas',    titulo: 'Abas', texto: 'A pagar: despesas aprovadas sem pagamento. Em andamento: o que está com o banco. Remessas: arquivos gerados, para baixar, marcar como enviados ou cancelar. Retornos: importe o arquivo que o banco devolve.' },
    { el: 'pag-tabela',  titulo: 'Despesas a pagar', texto: 'Marque as despesas prontas. Se uma não pode ser marcada, o motivo aparece em amarelo: abra a despesa em Lançamentos e preencha o bloco Pagamento. Rejeições do banco aparecem em vermelho.', lado: 'top' },
    { el: 'pag-criar',   titulo: 'Criar remessa', texto: 'Escolha a conta e a data do débito; o sistema confere cada pagamento e gera o arquivo. Baixe, importe e autorize no Internet Banking, depois clique em Marcar como enviada.' },
    { el: 'pag-retorno', titulo: 'Importar retorno', texto: 'Arraste o retorno do banco (crítica ou movimento): pagos recebem a data de pagamento sozinhos e rejeitados voltam para A pagar com o motivo.' },
  ],
  '/dashboard/configuracoes': [
    { el: 'cfg-abas', titulo: 'Seções', texto: 'As configurações em quatro grupos: Acesso (usuários), Estrutura (categorias e subitens, classificações, centros e bancos), Pessoas (funcionários, fornecedores e folha) e Pagamentos (contas pagadoras). Editar abre um painel ao lado. Cada seção tem endereço próprio, para voltar ou compartilhar.' },
  ],
  '/dashboard/dre': [
    { el: 'periodo',       titulo: 'Mês de referência',         texto: 'Use as setas ‹ › ou clique no mês para escolher. A DRE segue por competência.' },
    { el: 'visao',         titulo: 'Visão',                     texto: 'Mês, Acumulado no ano ou últimos 12 meses.' },
    { el: 'metas',         titulo: 'Metas (Previsto)',          texto: 'Cadastre o previsto que é comparado com o realizado.' },
    { el: 'kpis',          titulo: 'Indicadores',               texto: 'Cada número mostra a meta e quanto ficou acima ou abaixo dela, por escrito.' },
    { el: 'demonstrativo', titulo: 'Demonstração de resultados', texto: 'A DRE linha a linha: previsto, realizado, a diferença (melhor ou pior que a meta) e o peso na receita. Clique num grupo para abrir ou fechar; os que você fechar ficam fechados até sair do sistema.', lado: 'top' },
  ],
  '/dashboard/chat': [
    PERIODO('O assistente responde sobre o período escolhido aqui.'),
  ],
  '/dashboard/relatorios': [
    PERIODO('O relatório usa os lançamentos deste período.'),
    { el: 'rel-modelos', titulo: 'Abrir relatório', texto: 'Seus relatórios salvos, os compartilhados pela equipe e os modelos prontos. Comece por um e ajuste a partir dele; Salvar guarda do seu jeito.' },
    { el: 'rel-campos',  titulo: 'Campos',          texto: 'Arraste um campo para uma das áreas ao lado, ou clique no + do campo. Para tirar, arraste de volta ou clique no ×.', lado: 'right' },
    { el: 'rel-areas',   titulo: 'Linhas, colunas, valores e filtros', texto: 'Linhas e Colunas agrupam; Valores escolhe o que somar (Soma, Média, % do total…); Filtros abre uma lista com caixas de marcar.' },
    { el: 'rel-tabela',  titulo: 'Resultado',       texto: 'Recalcula a cada mudança. Clique num número para ver e editar os lançamentos que o formam; ▾ recolhe um grupo. Tabela, Gráfico ou Ambos ficam no canto.', lado: 'top' },
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

// v2 (25/11/2026): Pagamentos por arquivo — o tour completo roda de novo uma vez para todos.
const CHAVE_VISTO = 'dre.tour.v3.'  // v3: menu novo do redesenho (25/11/2026)

/** Primeiro acesso do usuário neste navegador: roda o tour completo uma vez. */
export function tourInicialPendente(userId: string): boolean {
  try { return !window.localStorage.getItem(CHAVE_VISTO + userId) } catch { return false }
}

export function marcarTourVisto(userId: string) {
  try { window.localStorage.setItem(CHAVE_VISTO + userId, '1') } catch { /* sem storage: só não lembra */ }
}
