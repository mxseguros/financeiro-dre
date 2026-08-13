-- ================================================================
-- 0030_impostos_e_dre_indexavel.sql
-- Revisão P2/P3 (itens 7 e 11 do relatório de melhorias):
--
-- 1) Nova classificação 'imposto' em subitens_lancamento.custo_tipo.
--    Impostos lançados como despesa deixam de inflar "Despesas Fixas"
--    (distorcendo o EBITDA) e passam a compor a linha de Impostos do
--    DRE, deduzidos na Receita Líquida — onde pertencem semanticamente.
--
-- 2) dre_por_periodo() reescrita:
--    - Predicados de período por intervalo direto (competencia >= X
--      AND competencia < Y) em vez de DATE_TRUNC na coluna, permitindo
--      uso de idx_despesas_competencia e afins.
--    - Classificação de despesas por CASE com precedência única
--      (custo_tipo do subitem primeiro, categoria legada como
--      fallback). Corrige também dupla contagem pré-existente: uma
--      despesa com categoria legada "fixa" e custo_tipo
--      'nao_operacional' contava nos dois grupos.
--    - Linha 'impostos' = tabela impostos + despesas com subitem
--      classificado como 'imposto'.
-- ================================================================

-- ── 1) Estende o CHECK de custo_tipo ───────────────────────────
-- O nome original vem de 0005 (tabela ainda se chamava tipos_lancamento;
-- o RENAME de 0026 preserva o nome da constraint).
ALTER TABLE subitens_lancamento DROP CONSTRAINT IF EXISTS tipos_lancamento_custo_tipo_check;
ALTER TABLE subitens_lancamento DROP CONSTRAINT IF EXISTS subitens_lancamento_custo_tipo_check;
ALTER TABLE subitens_lancamento
  ADD CONSTRAINT subitens_lancamento_custo_tipo_check
  CHECK (custo_tipo IN ('fixo', 'variavel', 'nao_operacional', 'imposto'));

-- Seed: subitens de despesa cujo nome menciona imposto passam a ser
-- classificados como 'imposto' (mesmo critério do endpoint legado
-- /dre/impostos). O usuário pode ajustar em Configurações.
UPDATE subitens_lancamento
SET custo_tipo = 'imposto'
WHERE natureza = 'despesa' AND nome ILIKE '%imposto%';

-- ── 2) dre_por_periodo() indexável e sem dupla contagem ────────

CREATE OR REPLACE FUNCTION dre_por_periodo(p_inicio DATE, p_fim DATE)
RETURNS JSONB AS $$
DECLARE
  resultado JSONB;
  v_ini DATE := date_trunc('month', p_inicio)::date;
  v_fim DATE := (date_trunc('month', p_fim) + interval '1 month')::date;  -- exclusivo
BEGIN
  WITH
  comissoes_periodo AS (
    SELECT COALESCE(SUM(c.valor), 0) AS total
    FROM comissoes c
    WHERE c.competencia >= v_ini AND c.competencia < v_fim
  ),
  receitas_outras_periodo AS (
    SELECT COALESCE(SUM(r.valor), 0) AS total
    FROM receitas_outras r
    WHERE r.competencia >= v_ini AND r.competencia < v_fim
  ),
  receita AS (
    SELECT
      (SELECT total FROM comissoes_periodo) +
      (SELECT total FROM receitas_outras_periodo) AS total
  ),
  estornos_periodo AS (
    SELECT COALESCE(SUM(e.valor), 0) AS total
    FROM estornos e
    WHERE e.competencia_estorno >= v_ini AND e.competencia_estorno < v_fim
  ),
  repasses_periodo AS (
    SELECT COALESCE(SUM(r.valor), 0) AS total
    FROM repasses r
    WHERE r.competencia >= v_ini AND r.competencia < v_fim
      AND r.status != 'estornado'
  ),
  -- Classificação única por despesa: custo_tipo do subitem tem
  -- precedência; categoria legada é fallback quando não há subitem
  -- classificado. Cada despesa cai em exatamente um grupo.
  despesas_classificadas AS (
    SELECT
      d.valor,
      CASE
        WHEN tl.custo_tipo = 'imposto'                  THEN 'imposto'
        WHEN tl.custo_tipo IN ('fixo', 'variavel')      THEN 'fixa'
        WHEN tl.custo_tipo = 'nao_operacional'          THEN 'nao_operacional'
        WHEN d.categoria IN (
          'pessoal', 'comercial', 'administrativa_operacional',
          'veiculos', 'terceiros', 'financeira'
        )                                               THEN 'fixa'
        WHEN d.categoria IN ('nao_operacional', 'investimento_imobilizado')
                                                        THEN 'nao_operacional'
        ELSE 'fixa'  -- sem classificação alguma: conserva no operacional
      END AS grupo
    FROM despesas d
    LEFT JOIN subitens_lancamento tl ON tl.id = d.tipo_lancamento_id
    WHERE d.competencia >= v_ini AND d.competencia < v_fim
      AND d.status NOT IN ('rejeitada', 'excluida')
  ),
  impostos_periodo AS (
    SELECT
      COALESCE((SELECT SUM(i.valor) FROM impostos i
                 WHERE i.competencia >= v_ini AND i.competencia < v_fim), 0)
      + COALESCE((SELECT SUM(valor) FROM despesas_classificadas WHERE grupo = 'imposto'), 0)
      AS total
  ),
  despesas_fixas AS (
    SELECT COALESCE(SUM(valor), 0) AS total
    FROM despesas_classificadas WHERE grupo = 'fixa'
  ),
  despesas_nao_operacionais AS (
    SELECT COALESCE(SUM(valor), 0) AS total
    FROM despesas_classificadas WHERE grupo = 'nao_operacional'
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object(
      'inicio', p_inicio,
      'fim',    p_fim
    ),
    'receita_bruta',          (SELECT total FROM receita),
    'estornos',               (SELECT total FROM estornos_periodo),
    'impostos',               (SELECT total FROM impostos_periodo),
    'receita_liquida',        (SELECT total FROM receita)
                              - (SELECT total FROM estornos_periodo)
                              - (SELECT total FROM impostos_periodo),
    'repasses_produtores',    (SELECT total FROM repasses_periodo),
    'margem_contribuicao',    (SELECT total FROM receita)
                              - (SELECT total FROM estornos_periodo)
                              - (SELECT total FROM impostos_periodo)
                              - (SELECT total FROM repasses_periodo),
    'despesas_fixas',         (SELECT total FROM despesas_fixas),
    'ebitda',                 (SELECT total FROM receita)
                              - (SELECT total FROM estornos_periodo)
                              - (SELECT total FROM impostos_periodo)
                              - (SELECT total FROM repasses_periodo)
                              - (SELECT total FROM despesas_fixas),
    'despesas_nao_operacionais', (SELECT total FROM despesas_nao_operacionais),
    'resultado_liquido',      (SELECT total FROM receita)
                              - (SELECT total FROM estornos_periodo)
                              - (SELECT total FROM impostos_periodo)
                              - (SELECT total FROM repasses_periodo)
                              - (SELECT total FROM despesas_fixas)
                              - (SELECT total FROM despesas_nao_operacionais)
  ) INTO resultado;

  RETURN resultado;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER STABLE;
