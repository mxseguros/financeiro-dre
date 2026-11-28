-- 0054 — Receita: "Recebido de" e "Forma de recebimento" (28/11/2026, pedido do Gabriel)
--
-- Novo layout do modal de Receita (bloco 4 · Recebimento). Texto livre para
-- quem pagou (seguradora ou cliente) e a forma em lista fechada.
--
-- Rodar no SQL Editor do Supabase ANTES de publicar o código: a lista de
-- receitas passa a ler estas colunas.

ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS recebido_de       TEXT,
  ADD COLUMN IF NOT EXISTS forma_recebimento TEXT;

DO $$ BEGIN
  ALTER TABLE receitas_outras ADD CONSTRAINT receitas_outras_forma_recebimento_chk
    CHECK (forma_recebimento IS NULL OR forma_recebimento IN
      ('pix', 'ted', 'boleto', 'deposito', 'cartao', 'dinheiro', 'outro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
