-- ================================================================
-- 0029_categoria_legada_opcional.sql
-- Corrige regressão introduzida no Épico 1: despesas.categoria (ENUM
-- legado despesa_categoria) é NOT NULL desde 0001_init.sql. O backend
-- deriva esse valor a partir de subitens_lancamento.categoria (campo
-- legado) quando não informado explicitamente — mas os subitens novos
-- da taxonomia (0027) e qualquer subitem criado pela nova tela de
-- Configurações só têm categoria_id preenchido, não o campo legado.
-- Resultado: INSERT em despesas falha com 23502 (null value in column
-- "categoria" violates not-null constraint) para qualquer despesa nova
-- que use um subitem sem o campo legado — não é específico de
-- recorrência, afeta lançamento normal também.
--
-- dre_por_periodo() já tolera categoria NULL (o teste é
-- "d.categoria IN (...) OR EXISTS (subitens_lancamento...)"), então
-- não há necessidade de manter a coluna obrigatória.
-- ================================================================

ALTER TABLE despesas ALTER COLUMN categoria DROP NOT NULL;

-- Backfill best-effort: preenche o campo legado dos subitens novos a
-- partir do código da categoria nova, para manter o máximo de
-- compatibilidade em código que ainda lê subitens_lancamento.categoria
-- (ex.: etl_service.py, fallback de criar_despesa).
UPDATE subitens_lancamento sl
SET categoria = cl.codigo
FROM categorias_lancamento cl
WHERE sl.categoria_id = cl.id
  AND sl.categoria IS NULL
  AND cl.codigo IS NOT NULL;
