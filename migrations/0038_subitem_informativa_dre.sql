-- 0038 — Subitem "Informativa na DRE (não soma)" (22/10/2026)
--
-- A linha aparece na DRE com seus valores, mas NÃO entra no total do grupo nem
-- nos resultados — como as linhas 9 e 10 do 1.1 na planilha "DRE - MX SEGUROS",
-- em que o 1.1 soma só Comissões de Vendas.
-- Diferente de somente_dre (0037), que conta na DRE e sai da Visão Geral.
-- Ver app/services/somente_dre.py (ids_informativas).

ALTER TABLE subitens_lancamento
  ADD COLUMN IF NOT EXISTS informativa_dre BOOLEAN NOT NULL DEFAULT false;
