-- ═══════════════════════════════════════════════════════════════
-- 0032 — Edição de lançamentos: contador no UPDATE, status em receitas
-- ═══════════════════════════════════════════════════════════════
-- Contexto (19/08/2026): "não consigo editar a despesa que veio do
-- extrato". A investigação achou três causas, todas tratadas aqui.
--
-- 1. tenant_id órfão
--    extrato_service e etl_service inserem com service_role e SEM
--    tenant_id. A policy de UPDATE começa com _tenant_ok(tenant_id), e
--    _tenant_ok(NULL) é falso — então NENHUM papel conseguia editar as
--    linhas importadas, nem admin. Eram 80 de 91 despesas e 140 de 140
--    receitas. O backfill já foi aplicado; o bloco abaixo é idempotente
--    e serve para ambientes que ainda não receberam a correção.
--
-- 2. contador via de fora do UPDATE
--    despesas_update listava apenas admin/gestor/super_admin, enquanto
--    a API (lancamentos.py:_ROLES_LEITURA) deixava contador passar. O
--    resultado era 0 linhas afetadas, que o serviço traduzia em
--    "404 Despesa não encontrada" — mensagem que mandou a investigação
--    para o lado errado.
--    Decisão de negócio (19/08/2026): quem enxerga lançamento pode
--    editar. Hoje isso é admin, gestor e contador (ver 0024).
--    COMERCIAL FICA DE FORA de propósito: ele não tem SELECT em
--    despesas/receitas, e dar UPDATE sem SELECT seria incoerente.
--
-- 3. receitas_outras não tinha status
--    Receita nunca passou por aprovação. A regra pedida — "editou,
--    volta para Aprovação" — não tinha onde existir. A coluna nasce
--    com DEFAULT 'pendente', mas as linhas já existentes viram
--    'aprovada': sem isso a fila de aprovação abriria com 140 itens
--    históricos no primeiro dia.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Backfill de tenant_id (idempotente) ────────────────────
-- Só existe um tenant. Se um dia houver mais, este UPDATE precisa de
-- critério — daí o guard: só roda com exatamente um tenant cadastrado.
DO $$
DECLARE
  v_tenant UUID;
  v_qtd    INT;
BEGIN
  SELECT count(*) INTO v_qtd FROM tenants;
  IF v_qtd = 1 THEN
    SELECT id INTO v_tenant FROM tenants LIMIT 1;
    UPDATE despesas        SET tenant_id = v_tenant WHERE tenant_id IS NULL;
    UPDATE receitas_outras SET tenant_id = v_tenant WHERE tenant_id IS NULL;
  ELSE
    RAISE NOTICE 'Backfill de tenant_id pulado: % tenants cadastrados (esperado 1).', v_qtd;
  END IF;
END $$;

-- ── 2. UPDATE liberado para quem já tem SELECT ────────────────
DROP POLICY IF EXISTS despesas_update ON despesas;
CREATE POLICY despesas_update ON despesas
  FOR UPDATE TO authenticated
  USING (
    _tenant_ok(tenant_id)
    AND get_meu_role() = ANY (ARRAY['admin', 'gestor', 'contador', 'super_admin']::user_role[])
  );

DROP POLICY IF EXISTS receitas_outras_update ON receitas_outras;
CREATE POLICY receitas_outras_update ON receitas_outras
  FOR UPDATE TO authenticated
  USING (
    _tenant_ok(tenant_id)
    AND get_meu_role() = ANY (ARRAY['admin', 'gestor', 'contador', 'super_admin']::user_role[])
  );

-- ── 3. status em receitas_outras ──────────────────────────────
-- Mesmo domínio de despesas (0012): pendente | aprovada | rejeitada | excluida.
ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'receitas_outras_status_check'
  ) THEN
    ALTER TABLE receitas_outras
      ADD CONSTRAINT receitas_outras_status_check
      CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'excluida'));
  END IF;
END $$;

-- Histórico entra como aprovado. O DEFAULT 'pendente' vale só para o
-- que for criado daqui pra frente.
UPDATE receitas_outras SET status = 'aprovada' WHERE status = 'pendente';

-- Campos de aprovação, espelhando despesas (0006).
ALTER TABLE receitas_outras ADD COLUMN IF NOT EXISTS aprovado_por      UUID REFERENCES usuarios(id);
ALTER TABLE receitas_outras ADD COLUMN IF NOT EXISTS aprovado_em       TIMESTAMPTZ;
ALTER TABLE receitas_outras ADD COLUMN IF NOT EXISTS rejeitado_motivo  TEXT;

-- O Kanban filtra por status; sem índice ele varre a tabela inteira.
CREATE INDEX IF NOT EXISTS idx_receitas_outras_status
  ON receitas_outras (status)
  WHERE status <> 'excluida';

COMMIT;
