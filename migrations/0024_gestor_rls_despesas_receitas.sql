-- ═══════════════════════════════════════════════════════════════
-- 0024 — RLS: gestor com leitura completa de despesas e receitas
-- ═══════════════════════════════════════════════════════════════
-- Contexto: desde a v1.2 o perfil gestor tem, no código da API, os
-- mesmos poderes do admin em lançamentos. As políticas RLS abaixo
-- ainda refletiam as regras antigas:
--   • despesas_gestor: escondia categorias 'pessoal', 'nao_operacional'
--     e 'investimento_imobilizado' — INSERT ... RETURNING de despesa de
--     salário por gestor falhava com 42501 ("new row violates RLS"),
--     e a listagem omitia essas despesas silenciosamente.
--   • receitas_outras_select: não incluía gestor — gestor via zero
--     receitas manuais na listagem.
-- Decisão de negócio (03/07/2026): gestor vê tudo em lançamentos.

-- ── DESPESAS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS despesas_gestor ON despesas;

DROP POLICY IF EXISTS despesas_select ON despesas;
CREATE POLICY despesas_select ON despesas
  FOR SELECT TO authenticated
  USING (
    _tenant_ok(tenant_id)
    AND get_meu_role() = ANY (ARRAY['admin', 'gestor', 'contador', 'super_admin']::user_role[])
  );

-- ── RECEITAS MANUAIS ──────────────────────────────────────────
DROP POLICY IF EXISTS receitas_outras_select ON receitas_outras;
CREATE POLICY receitas_outras_select ON receitas_outras
  FOR SELECT TO authenticated
  USING (
    _tenant_ok(tenant_id)
    AND get_meu_role() = ANY (ARRAY['admin', 'gestor', 'contador', 'super_admin']::user_role[])
  );
