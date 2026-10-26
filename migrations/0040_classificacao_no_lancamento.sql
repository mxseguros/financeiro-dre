-- 0040 — Classificação passa a ser do LANÇAMENTO (22/10/2026)
--
-- Antes: a classificação era do subitem (subitens_lancamento.custo_tipo),
-- editada em Configurações, e valia para todos os lançamentos dele.
-- Agora cada despesa/receita guarda a própria, escolhida no formulário.
--   * Lançamentos existentes herdam a classificação atual do subitem.
--   * Gatilho: lançamento gravado SEM classificação recebe a do subitem como
--     padrão (cobre importação de extrato, ETL, parcelamento e recorrência).
--     subitens_lancamento.custo_tipo fica só como esse padrão — sem tela.
--   * dre_por_periodo() e o box Fixas vs. Variáveis leem a do lançamento.
--   * Lista: sai "Empréstimos" (sem uso), entra "Adiantamento a cliente".

-- ── 1) Coluna nos lançamentos + herança do subitem ────────────
ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS custo_tipo TEXT REFERENCES classificacoes(codigo) ON UPDATE CASCADE;
ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS custo_tipo TEXT REFERENCES classificacoes(codigo) ON UPDATE CASCADE;

UPDATE despesas d SET custo_tipo = s.custo_tipo
FROM subitens_lancamento s
WHERE s.id = d.tipo_lancamento_id AND d.custo_tipo IS NULL AND s.custo_tipo IS NOT NULL;

UPDATE receitas_outras r SET custo_tipo = s.custo_tipo
FROM subitens_lancamento s
WHERE s.id = r.tipo_lancamento_id AND r.custo_tipo IS NULL AND s.custo_tipo IS NOT NULL;

-- ── 2) Padrão do subitem ao gravar sem classificação ──────────
CREATE OR REPLACE FUNCTION lancamento_classificacao_padrao() RETURNS trigger AS $$
BEGIN
  IF NEW.custo_tipo IS NULL AND NEW.tipo_lancamento_id IS NOT NULL THEN
    SELECT s.custo_tipo INTO NEW.custo_tipo
    FROM subitens_lancamento s WHERE s.id = NEW.tipo_lancamento_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_despesas_classificacao_padrao ON despesas;
CREATE TRIGGER trg_despesas_classificacao_padrao
  BEFORE INSERT ON despesas
  FOR EACH ROW EXECUTE FUNCTION lancamento_classificacao_padrao();

DROP TRIGGER IF EXISTS trg_receitas_outras_classificacao_padrao ON receitas_outras;
CREATE TRIGGER trg_receitas_outras_classificacao_padrao
  BEFORE INSERT ON receitas_outras
  FOR EACH ROW EXECUTE FUNCTION lancamento_classificacao_padrao();

-- ── 3) Lista: Empréstimos → Adiantamento a cliente ────────────
DELETE FROM classificacoes c
WHERE c.codigo = 'emprestimos'
  AND NOT EXISTS (SELECT 1 FROM subitens_lancamento WHERE custo_tipo = c.codigo)
  AND NOT EXISTS (SELECT 1 FROM despesas WHERE custo_tipo = c.codigo)
  AND NOT EXISTS (SELECT 1 FROM receitas_outras WHERE custo_tipo = c.codigo);

INSERT INTO classificacoes (codigo, nome, ordem, sistema, tenant_id)
SELECT 'adiantamento_cliente', 'Adiantamento a cliente', 6, false,
       (SELECT id FROM tenants ORDER BY criado_em NULLS LAST LIMIT 1)
ON CONFLICT (codigo) DO NOTHING;

-- ── 4) dre_por_periodo(): classificação do lançamento ─────────
-- Igual à 0030, trocando tl.custo_tipo (subitem) por d.custo_tipo.
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
