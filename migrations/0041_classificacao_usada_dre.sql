-- 0041 — Classificação "Usada na DRE" configurável (22/10/2026)
--
-- Cada classificação ganha `usada_dre` (padrão: sim). Desmarcada, os
-- lançamentos com ela ficam FORA da DRE — da Previsto x Realizado (filtro no
-- backend, dre_gerencial_service) e da dre_por_periodo() abaixo. Continuam em
-- Lançamentos e na Visão Geral. Pensado para Aplicações e Adiantamento a
-- cliente, que são movimento de caixa, não resultado.
-- A trava `sistema` deixa de ser usada pela tela/backend: todas as
-- classificações podem ser desativadas/excluídas (exclusão segue barrada
-- quando há lançamento ou subitem usando — a FK da 0039/0040 garante).

ALTER TABLE classificacoes ADD COLUMN IF NOT EXISTS usada_dre BOOLEAN NOT NULL DEFAULT true;

-- dre_por_periodo(): igual à 0040, sem os lançamentos de classificação fora da DRE.
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
      AND (r.custo_tipo IS NULL OR r.custo_tipo NOT IN (SELECT codigo FROM classificacoes WHERE NOT usada_dre))
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
  -- Classificação única por despesa: custo_tipo do lançamento tem
  -- precedência; categoria legada é fallback quando o lançamento não tem
  -- classificação. Cada despesa cai em exatamente um grupo.
  despesas_classificadas AS (
    SELECT
      d.valor,
      CASE
        WHEN d.custo_tipo = 'imposto'                  THEN 'imposto'
        WHEN d.custo_tipo IN ('fixo', 'variavel')      THEN 'fixa'
        WHEN d.custo_tipo = 'nao_operacional'          THEN 'nao_operacional'
        WHEN d.categoria IN (
          'pessoal', 'comercial', 'administrativa_operacional',
          'veiculos', 'terceiros', 'financeira'
        )                                               THEN 'fixa'
        WHEN d.categoria IN ('nao_operacional', 'investimento_imobilizado')
                                                        THEN 'nao_operacional'
        ELSE 'fixa'  -- sem classificação alguma: conserva no operacional
      END AS grupo
    FROM despesas d
    WHERE d.competencia >= v_ini AND d.competencia < v_fim
      AND d.status NOT IN ('rejeitada', 'excluida')
      AND (d.custo_tipo IS NULL OR d.custo_tipo NOT IN (SELECT codigo FROM classificacoes WHERE NOT usada_dre))
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
