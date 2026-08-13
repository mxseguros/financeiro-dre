-- ================================================================
-- 0026_rename_subitens_e_fix_funcoes.sql
-- Épico 1 (Task 1.1) — Renomeia tipos_lancamento -> subitens_lancamento
-- (nível 2 da hierarquia) e vincula cada subitem a uma categoria.
--
-- ATENÇÃO — arquivo único e atômico de propósito: dre_por_periodo()
-- contém a referência literal `FROM tipos_lancamento`. Se o rename
-- rodasse num arquivo separado da correção dessa função, /dre e
-- /dashboard quebrariam em produção entre uma migration e outra.
-- Por isso: rename -> backfill -> validação -> função, tudo aqui.
-- (mv_dre_custos_mensais/refresh_mv_dre() não existem nesta produção
-- — ver nota na seção 5 no fim do arquivo — então não entram aqui.)
--
-- Ordem de deploy: aplicar esta migration imediatamente antes do
-- deploy do backend atualizado (que já troca "tipos_lancamento" por
-- "subitens_lancamento" em todas as queries) — ver Riscos no plano.
-- ================================================================

-- ── 1) Rename da tabela e novo vínculo de categoria ────────────

ALTER TABLE tipos_lancamento RENAME TO subitens_lancamento;

ALTER TABLE subitens_lancamento
  ADD COLUMN categoria_id UUID REFERENCES categorias_lancamento(id);

CREATE INDEX idx_subitens_lancamento_categoria ON subitens_lancamento(categoria_id);

-- ── 2) Backfill: casa subitens de despesa pelo código legado ───
-- (subitens_lancamento.categoria é o TEXT do ENUM despesa_categoria,
-- categorias_lancamento.codigo foi seedado com os mesmos valores em 0025)

UPDATE subitens_lancamento sl
SET categoria_id = cl.id
FROM categorias_lancamento cl
WHERE sl.natureza = 'despesa'
  AND cl.natureza = 'despesa'
  AND cl.codigo = sl.categoria
  AND (sl.tenant_id = cl.tenant_id OR sl.tenant_id IS NULL);

-- Órfãos de despesa (sem categoria legada, ou categoria sem match) -> "Despesas — Legado"
UPDATE subitens_lancamento sl
SET categoria_id = (
  SELECT cl.id FROM categorias_lancamento cl
  WHERE cl.codigo = 'legado_despesa' AND (cl.tenant_id = sl.tenant_id OR sl.tenant_id IS NULL)
  LIMIT 1
)
WHERE sl.natureza = 'despesa' AND sl.categoria_id IS NULL;

-- Receitas: hoje não têm nenhuma hierarquia de categoria -> "Receitas — Legado"
UPDATE subitens_lancamento sl
SET categoria_id = (
  SELECT cl.id FROM categorias_lancamento cl
  WHERE cl.codigo = 'legado_receita' AND (cl.tenant_id = sl.tenant_id OR sl.tenant_id IS NULL)
  LIMIT 1
)
WHERE sl.natureza = 'receita' AND sl.categoria_id IS NULL;

-- ── 3) Validação de sanidade antes de travar NOT NULL ──────────

DO $$
DECLARE v_sem_categoria INT;
BEGIN
  SELECT COUNT(*) INTO v_sem_categoria FROM subitens_lancamento WHERE categoria_id IS NULL;
  IF v_sem_categoria > 0 THEN
    RAISE EXCEPTION
      'Migration 0026 abortada: % subitem(ns) ficaram sem categoria_id após o backfill.',
      v_sem_categoria;
  END IF;
  RAISE NOTICE 'Backfill de categoria_id concluído: todos os subitens vinculados.';
END;
$$;

ALTER TABLE subitens_lancamento ALTER COLUMN categoria_id SET NOT NULL;

-- Nota: as policies RLS de tipos_lancamento (0019: tipos_lancamento_select/
-- insert/update) sobrevivem ao RENAME automaticamente — Postgres associa
-- policy ao OID da tabela, não ao nome. Não precisam ser recriadas.

-- ── 4) Recria dre_por_periodo() apontando para subitens_lancamento ─
-- Corpo idêntico ao vigente em 0022_dre_inclui_receitas_outras.sql,
-- só troca "FROM tipos_lancamento tl" -> "FROM subitens_lancamento tl"
-- (as 2 ocorrências, dentro das CTEs despesas_fixas/despesas_nao_operacionais).

CREATE OR REPLACE FUNCTION dre_por_periodo(p_inicio DATE, p_fim DATE)
RETURNS JSONB AS $$
DECLARE
  resultado JSONB;
BEGIN
  WITH
  comissoes_periodo AS (
    SELECT COALESCE(SUM(c.valor), 0) AS total
    FROM comissoes c
    WHERE DATE_TRUNC('month', c.competencia)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
  ),
  receitas_outras_periodo AS (
    SELECT COALESCE(SUM(r.valor), 0) AS total
    FROM receitas_outras r
    WHERE DATE_TRUNC('month', r.competencia)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
  ),
  receita AS (
    SELECT
      (SELECT total FROM comissoes_periodo) +
      (SELECT total FROM receitas_outras_periodo) AS total
  ),
  estornos_periodo AS (
    SELECT COALESCE(SUM(e.valor), 0) AS total
    FROM estornos e
    WHERE DATE_TRUNC('month', e.competencia_estorno)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
  ),
  impostos_periodo AS (
    SELECT COALESCE(SUM(i.valor), 0) AS total
    FROM impostos i
    WHERE DATE_TRUNC('month', i.competencia)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
  ),
  repasses_periodo AS (
    SELECT COALESCE(SUM(r.valor), 0) AS total
    FROM repasses r
    WHERE DATE_TRUNC('month', r.competencia)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
      AND r.status != 'estornado'
  ),
  despesas_fixas AS (
    SELECT COALESCE(SUM(d.valor), 0) AS total
    FROM despesas d
    WHERE DATE_TRUNC('month', d.competencia)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
      AND d.status NOT IN ('rejeitada', 'excluida')
      AND (
        d.categoria IN (
          'pessoal', 'comercial', 'administrativa_operacional',
          'veiculos', 'terceiros', 'financeira'
        )
        OR (
          d.tipo_lancamento_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subitens_lancamento tl
             WHERE tl.id = d.tipo_lancamento_id
               AND tl.custo_tipo IN ('fixo', 'variavel')
          )
        )
      )
  ),
  despesas_nao_operacionais AS (
    SELECT COALESCE(SUM(d.valor), 0) AS total
    FROM despesas d
    WHERE DATE_TRUNC('month', d.competencia)
          BETWEEN DATE_TRUNC('month', p_inicio)
              AND DATE_TRUNC('month', p_fim)
      AND d.status NOT IN ('rejeitada', 'excluida')
      AND (
        d.categoria IN ('nao_operacional', 'investimento_imobilizado')
        OR (
          d.tipo_lancamento_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subitens_lancamento tl
             WHERE tl.id = d.tipo_lancamento_id
               AND tl.custo_tipo = 'nao_operacional'
          )
        )
      )
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

-- ── 5) mv_dre_custos_mensais / refresh_mv_dre() ────────────────
-- NÃO recriar aqui: confirmado em produção (erro "function
-- refresh_mv_dre() does not exist") que a migration 0011 nunca foi de
-- fato aplicada neste banco — mv_dre_receita_mensal, mv_dre_custos_mensais
-- e refresh_mv_dre() não existem em produção, apesar de estarem no
-- histórico do repositório. Como nenhum código Python lê essas views,
-- não há necessidade de criá-las agora só para "consertar" algo que
-- nunca existiu de fato neste ambiente.
