-- ================================================================
-- 0025_categorias_lancamento.sql
-- Épico 1 (Task 1.1) — Cria o nível 1 da nova hierarquia
-- categoria → subitem de lançamento.
--
-- Nesta migration: apenas a tabela nova (categorias_lancamento) e o
-- seed das 8 categorias do ENUM legado despesa_categoria + categorias
-- "Legado" (despesa/receita) que vão acolher os subitens órfãos.
--
-- O rename de tipos_lancamento -> subitens_lancamento, o vínculo
-- categoria_id e a correção de dre_por_periodo()/mv_dre_custos_mensais
-- acontecem na migration seguinte (0026), num arquivo único e atômico,
-- para nunca deixar a função apontando para uma tabela inexistente.
-- ================================================================

CREATE TABLE categorias_lancamento (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      TEXT NOT NULL,
  natureza  TEXT NOT NULL CHECK (natureza IN ('despesa', 'receita')),
  -- codigo mapeia para o ENUM legado despesa_categoria (NULL para receita,
  -- ou marcadores internos 'legado_despesa'/'legado_receita' — ver seed abaixo)
  codigo    TEXT,
  ordem     INT NOT NULL DEFAULT 0,
  ativo     BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT now(),
  tenant_id UUID REFERENCES tenants(id)
);

CREATE UNIQUE INDEX idx_categorias_lancamento_nome
  ON categorias_lancamento (tenant_id, natureza, lower(nome));

-- ── RLS — mesmo padrão de tipos_lancamento (0019): todos leem,
-- só admin/gestor/super_admin criam e editam. Sem policy de DELETE
-- (exclusão de categoria não é permitida — só soft-delete via `ativo`).

ALTER TABLE categorias_lancamento ENABLE ROW LEVEL SECURITY;

CREATE POLICY categorias_lancamento_select ON categorias_lancamento
  FOR SELECT TO authenticated
  USING (_tenant_ok(tenant_id));

CREATE POLICY categorias_lancamento_insert ON categorias_lancamento
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_meu_tenant() AND get_meu_role() IN ('admin', 'gestor', 'super_admin'));

CREATE POLICY categorias_lancamento_update ON categorias_lancamento
  FOR UPDATE TO authenticated
  USING (_tenant_ok(tenant_id) AND get_meu_role() IN ('admin', 'gestor', 'super_admin'));

-- ── Seed: 8 categorias legadas de despesa + "Legado" (despesa/receita) ──

DO $$
DECLARE v_tenant_id UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'mx-seguros';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant mx-seguros não encontrado. Execute 0017_tenants.sql primeiro.';
  END IF;

  INSERT INTO categorias_lancamento (nome, natureza, codigo, ordem, tenant_id) VALUES
    ('Despesas com pessoal',                           'despesa', 'pessoal',                    10, v_tenant_id),
    ('Despesa comercial',                              'despesa', 'comercial',                  20, v_tenant_id),
    ('Despesa administrativa',                         'despesa', 'administrativa_operacional', 30, v_tenant_id),
    ('Despesa com veículos',                           'despesa', 'veiculos',                   40, v_tenant_id),
    ('Serviços prestados por terceiros',               'despesa', 'terceiros',                  50, v_tenant_id),
    ('Despesa financeira',                             'despesa', 'financeira',                 60, v_tenant_id),
    ('Despesas não operacionais',                      'despesa', 'nao_operacional',             70, v_tenant_id),
    ('Despesas com investimentos e ativo imobilizado', 'despesa', 'investimento_imobilizado',    80, v_tenant_id),
    ('Despesas — Legado',                              'despesa', 'legado_despesa',              99, v_tenant_id),
    ('Receitas Diversas',                              'receita', NULL,                          10, v_tenant_id),
    ('Receitas — Legado',                              'receita', 'legado_receita',               99, v_tenant_id);

  RAISE NOTICE 'categorias_lancamento seedada com sucesso para tenant: %', v_tenant_id;
END;
$$;
