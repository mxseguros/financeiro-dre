-- 0053 — Empréstimo: despesa ↔ receita vinculadas (28/11/2026, pedido do Gabriel)
--
-- Ao lançar uma despesa (ou receita) de categoria Empréstimo, o usuário pode
-- marcar "Lançar também como receita" (ou "como despesa"). O sistema cria o
-- outro lado e grava o MESMO UUID nas duas linhas. Valor, descrição,
-- competência e vencimento ficam sincronizados (app/services/emprestimo_vinculo.py).
--
-- Rodar no SQL Editor do Supabase ANTES de publicar o código que cria espelhos.
-- O resto do app tolera a coluna ausente.

ALTER TABLE despesas        ADD COLUMN IF NOT EXISTS vinculo_emprestimo UUID;
ALTER TABLE receitas_outras ADD COLUMN IF NOT EXISTS vinculo_emprestimo UUID;

CREATE INDEX IF NOT EXISTS idx_despesas_vinculo_emprestimo
  ON despesas (vinculo_emprestimo) WHERE vinculo_emprestimo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receitas_outras_vinculo_emprestimo
  ON receitas_outras (vinculo_emprestimo) WHERE vinculo_emprestimo IS NOT NULL;

-- PostgREST passa a enxergar as colunas novas sem esperar o cache.
NOTIFY pgrst, 'reload schema';
