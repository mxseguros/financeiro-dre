-- ================================================================
-- 0028_data_vencimento.sql
-- Épico 3 (Task 3.2) — Adiciona "Data de Vencimento", distinta da
-- competência (mês de referência) e da data de pagamento/recebimento.
--
-- Sem NOT NULL no banco (padrão já usado no projeto para colunas
-- novas — ver 0018_add_tenant_id.sql): obrigatoriedade para despesa
-- fica na camada Pydantic (DespesaCreate.data_vencimento sem default).
-- ================================================================

ALTER TABLE despesas       ADD COLUMN IF NOT EXISTS data_vencimento DATE;
ALTER TABLE receitas_outras ADD COLUMN IF NOT EXISTS data_vencimento DATE;

-- Backfill best-effort para lançamentos existentes (usa a competência
-- como vencimento aproximado, já que não existia esse conceito antes).
UPDATE despesas       SET data_vencimento = competencia WHERE data_vencimento IS NULL;
UPDATE receitas_outras SET data_vencimento = competencia WHERE data_vencimento IS NULL;

CREATE INDEX IF NOT EXISTS idx_despesas_vencimento ON despesas(data_vencimento);
