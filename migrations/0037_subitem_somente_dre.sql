-- 0037 — Subitem "Constar apenas na DRE" (22/10/2026)
--
-- Receitas de um subitem marcado aparecem só na DRE: ficam fora da Visão
-- Geral e dos totais de Lançamentos (onde continuam listadas, com etiqueta).
-- A DRE e a função dre_por_periodo não mudam.
-- Ver app/services/somente_dre.py.

ALTER TABLE subitens_lancamento
  ADD COLUMN IF NOT EXISTS somente_dre BOOLEAN NOT NULL DEFAULT false;
