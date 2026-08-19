-- ═══════════════════════════════════════════════════════════════
-- 0033 — Busca de lançamentos sem sensibilidade a acento
-- ═══════════════════════════════════════════════════════════════
-- Contexto (19/08/2026): "a busca não traz a descrição digitada".
-- Medido no banco, com o filtro que a API monta hoje:
--
--   'CPFL'      -> 1    ok
--   'Refeição'  -> 2    ok (o dado tem acento)
--   'Refeicao'  -> 0    FALHA — mesma palavra, sem acento
--   '%'         -> 91   FALHA — retorna a tabela inteira
--
-- O `ilike` do Postgres é case-insensitive mas ACCENT-sensitive. Como
-- descrição vinda de extrato bancário costuma chegar sem acento
-- ("COMPRA CAMINHAO"), quem digita "Caminhão" não acha — e vice-versa.
-- Não dá para resolver só na aplicação: quem compara é o banco.
--
-- A coluna gerada abaixo guarda a descrição normalizada (sem acento,
-- minúscula) e concatena `subcategoria`. Hoje a busca faz um OR entre as
-- duas colunas, mas `subcategoria` é cópia literal de `descricao` em todo
-- o código — o OR compara duas vezes o mesmo texto. Unificar num campo só
-- simplifica o filtro e permite um índice único.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- `unaccent()` é STABLE, não IMMUTABLE, porque depende do dicionário ativo.
-- Coluna gerada exige IMMUTABLE, daí o wrapper que fixa o dicionário.
CREATE OR REPLACE FUNCTION imutavel_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS descricao_busca TEXT
  GENERATED ALWAYS AS (
    lower(imutavel_unaccent(coalesce(descricao, '') || ' ' || coalesce(subcategoria, '')))
  ) STORED;

ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS descricao_busca TEXT
  GENERATED ALWAYS AS (
    lower(imutavel_unaccent(coalesce(descricao, '') || ' ' || coalesce(observacao, '')))
  ) STORED;

-- ILIKE '%termo%' não usa índice B-tree — o curinga à esquerda impede.
-- gin_trgm_ops resolve, e passa a valer também para a busca por trecho.
CREATE INDEX IF NOT EXISTS idx_despesas_descricao_busca
  ON despesas USING gin (descricao_busca gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_receitas_outras_descricao_busca
  ON receitas_outras USING gin (descricao_busca gin_trgm_ops);

COMMIT;
