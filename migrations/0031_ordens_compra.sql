-- ================================================================
-- 0031_ordens_compra.sql
-- Nova entidade Ordem de Compra, seguindo o padrão de despesas:
-- soft-delete via status, RLS multi-tenant, criado_por/tenant_id
-- injetados pelo backend. data_solicitacao é server-controlled
-- (DEFAULT CURRENT_DATE + injeção no service — cliente não sobrescreve).
--
-- Helpers RLS já existem: _tenant_ok / get_meu_role / get_meu_tenant
-- (migrations 0019 e 0002). auth.uid() = id do usuário logado.
-- ================================================================

CREATE TABLE ordens_compra (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitante      TEXT NOT NULL,
  assunto          TEXT NOT NULL,
  descricao        TEXT NOT NULL,
  valor            NUMERIC(14,2),                 -- opcional
  data_solicitacao DATE NOT NULL DEFAULT CURRENT_DATE,
  status           TEXT NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'excluida')),
  criado_por       UUID REFERENCES usuarios(id),
  aprovado_por     UUID REFERENCES usuarios(id),
  aprovado_em      TIMESTAMPTZ,
  rejeitado_motivo TEXT,
  criado_em        TIMESTAMPTZ DEFAULT now(),
  atualizado_em    TIMESTAMPTZ DEFAULT now(),
  tenant_id        UUID REFERENCES tenants(id)
);

CREATE INDEX idx_ordens_compra_tenant ON ordens_compra(tenant_id, data_solicitacao);
CREATE INDEX idx_ordens_compra_status ON ordens_compra(status) WHERE status != 'excluida';

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE ordens_compra ENABLE ROW LEVEL SECURITY;

-- Leitura: admin/gestor/contador/super_admin veem tudo do tenant;
-- comercial vê apenas as próprias. (mesma lógica de visibilidade de
-- despesas, mas consolidada numa policy só para simplicidade).
CREATE POLICY ordens_compra_select ON ordens_compra
  FOR SELECT TO authenticated
  USING (
    _tenant_ok(tenant_id)
    AND status != 'excluida'
    AND (
      get_meu_role() IN ('admin', 'gestor', 'contador', 'super_admin')
      OR criado_por = auth.uid()
    )
  );

-- Criação: qualquer usuário autenticado do tenant pode abrir uma ordem.
CREATE POLICY ordens_compra_insert ON ordens_compra
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_meu_tenant());

-- Atualização (editar / aprovar / rejeitar / soft-delete):
-- admin/gestor/super_admin em qualquer ordem; o criador na própria.
CREATE POLICY ordens_compra_update ON ordens_compra
  FOR UPDATE TO authenticated
  USING (
    _tenant_ok(tenant_id)
    AND (
      get_meu_role() IN ('admin', 'gestor', 'super_admin')
      OR criado_por = auth.uid()
    )
  );

-- Sem policy de DELETE: exclusão é soft (UPDATE status='excluida').
