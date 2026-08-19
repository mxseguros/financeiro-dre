-- ═══════════════════════════════════════════════════════════════
-- 0034 — atualizado_em em despesas e receitas, mantido por trigger
-- ═══════════════════════════════════════════════════════════════
-- Contexto (19/08/2026): pedido para as telas de Lançamentos e
-- Aprovações mostrarem sempre o último lançado OU ALTERADO no topo.
--
-- Hoje só existe `criado_em`. Ordenar por ele resolve "último lançado",
-- mas um lançamento editado hoje e criado mês passado continua no fim da
-- lista — que é o oposto do que a tela precisa mostrar, já que editar
-- devolve o item para a fila de aprovação (migration 0032).
--
-- `ordens_compra` (0031) já nasceu com a coluna, mas quem a preenche é o
-- Python — `ordens_compra_service.py` a seta em 3 lugares. Para despesas
-- e receitas esse caminho seria frágil: há seis pontos de UPDATE (editar,
-- aprovar, rejeitar e o soft-delete, vezes duas tabelas), e esquecer um
-- deixa o registro com data velha exatamente quando ele deveria subir.
-- O trigger cobre todos, inclusive escrita por service_role (importação)
-- e correção manual pelo SQL Editor.
--
-- O trigger é aplicado também em `ordens_compra`. Não conflita com o
-- Python: os dois gravam now(), e o trigger roda por último.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── coluna ────────────────────────────────────────────────────
ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now();

-- Linhas já existentes nunca foram alteradas do ponto de vista do sistema:
-- a data de alteração começa igual à de criação, senão o backfill jogaria
-- todo o histórico para o topo da lista de uma vez.
UPDATE despesas        SET atualizado_em = criado_em WHERE criado_em IS NOT NULL;
UPDATE receitas_outras SET atualizado_em = criado_em WHERE criado_em IS NOT NULL;

-- ── trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION marcar_atualizado_em()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_despesas_atualizado_em ON despesas;
CREATE TRIGGER trg_despesas_atualizado_em
  BEFORE UPDATE ON despesas
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizado_em();

DROP TRIGGER IF EXISTS trg_receitas_outras_atualizado_em ON receitas_outras;
CREATE TRIGGER trg_receitas_outras_atualizado_em
  BEFORE UPDATE ON receitas_outras
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizado_em();

DROP TRIGGER IF EXISTS trg_ordens_compra_atualizado_em ON ordens_compra;
CREATE TRIGGER trg_ordens_compra_atualizado_em
  BEFORE UPDATE ON ordens_compra
  FOR EACH ROW EXECUTE FUNCTION marcar_atualizado_em();

-- ── índices ───────────────────────────────────────────────────
-- É a ordenação padrão das duas telas; sem índice cada abertura vira
-- sort completo da tabela.
CREATE INDEX IF NOT EXISTS idx_despesas_atualizado_em
  ON despesas (atualizado_em DESC);

CREATE INDEX IF NOT EXISTS idx_receitas_outras_atualizado_em
  ON receitas_outras (atualizado_em DESC);

COMMIT;
