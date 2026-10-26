-- 0042 — Filtros das telas pela Data de Pagamento (22/10/2026)
--
-- Pedido do Gabriel: os filtros de período de Lançamentos, Aprovações,
-- Visão Geral (inclusive o box dos bancos) e Monitor respeitam sempre a
-- Data de Pagamento. O que ainda não foi pago entra pelo vencimento (e, sem
-- vencimento, pela competência) — assim pendências e a fila de aprovação
-- continuam no mês certo. A DRE e as Metas seguem por competência.
--
-- `data_ref` é calculada pelo banco (não se grava nela) e é a coluna que o
-- backend usa quando a base do filtro é "pagamento" (app/services/periodo_base.py).

ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS data_ref DATE
  GENERATED ALWAYS AS (COALESCE(paga_em, data_vencimento, competencia)) STORED;

ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS data_ref DATE
  GENERATED ALWAYS AS (COALESCE(recebido_em, data_vencimento, competencia)) STORED;

ALTER TABLE comissoes
  ADD COLUMN IF NOT EXISTS data_ref DATE
  GENERATED ALWAYS AS (COALESCE(recebida_em, competencia)) STORED;

CREATE INDEX IF NOT EXISTS idx_despesas_data_ref        ON despesas (data_ref);
CREATE INDEX IF NOT EXISTS idx_receitas_outras_data_ref ON receitas_outras (data_ref);
CREATE INDEX IF NOT EXISTS idx_comissoes_data_ref       ON comissoes (data_ref);
