-- 0043 — Relatórios dinâmicos salvos (26/10/2026)
--
-- A tela Relatórios (tabela dinâmica que substituiu o Monitoramento IA) passa a
-- guardar os relatórios montados: nome + configuração (campos, filtros, fonte,
-- período). "Meus" = dono é o usuário; "Da equipe" = compartilhado = true.
-- Só o dono altera ou exclui. Quem pode compartilhar é decidido no backend pela
-- permissão relatorios.compartilhar (padrão: Admin e Gestor).
--
-- O código tolera a tabela ausente: sem esta migration a tela funciona, só não
-- salva (mostra o aviso). Rodar no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS relatorios (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id),
  nome           TEXT NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  config         JSONB NOT NULL,
  dono           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  compartilhado  BOOLEAN NOT NULL DEFAULT false,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relatorios_dono ON relatorios (dono);
CREATE INDEX IF NOT EXISTS idx_relatorios_compartilhado ON relatorios (tenant_id) WHERE compartilhado;

-- atualizado_em mantido pelo banco, como em despesas (0034).
CREATE OR REPLACE FUNCTION relatorios_tocar_atualizado() RETURNS trigger AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_relatorios_atualizado ON relatorios;
CREATE TRIGGER trg_relatorios_atualizado BEFORE UPDATE ON relatorios
  FOR EACH ROW EXECUTE FUNCTION relatorios_tocar_atualizado();

ALTER TABLE relatorios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS relatorios_select ON relatorios;
CREATE POLICY relatorios_select ON relatorios
  FOR SELECT TO authenticated
  USING (_tenant_ok(tenant_id) AND (dono = auth.uid() OR compartilhado));

DROP POLICY IF EXISTS relatorios_insert ON relatorios;
CREATE POLICY relatorios_insert ON relatorios
  FOR INSERT TO authenticated
  WITH CHECK (dono = auth.uid() AND _tenant_ok(tenant_id));

DROP POLICY IF EXISTS relatorios_update ON relatorios;
CREATE POLICY relatorios_update ON relatorios
  FOR UPDATE TO authenticated
  USING (dono = auth.uid())
  WITH CHECK (dono = auth.uid() AND _tenant_ok(tenant_id));

DROP POLICY IF EXISTS relatorios_delete ON relatorios;
CREATE POLICY relatorios_delete ON relatorios
  FOR DELETE TO authenticated
  USING (dono = auth.uid());

-- Permissão própria da tela. Usuários com permissões personalizadas herdam o
-- "Ver" do antigo Monitoramento IA; criar acompanha o ver; compartilhar só
-- Admin e Gestor. Quem não tem permissões personalizadas usa o padrão do
-- perfil (app/permissions.py), que já traz "relatorios".
UPDATE usuarios
SET permissions = permissions || jsonb_build_object('relatorios', jsonb_build_object(
      'visualizar',   COALESCE((permissions -> 'assistente' ->> 'visualizar')::boolean, false),
      'criar',        COALESCE((permissions -> 'assistente' ->> 'visualizar')::boolean, false),
      'compartilhar', role IN ('admin', 'gestor')))
WHERE permissions IS NOT NULL
  AND NOT (permissions ? 'relatorios');
