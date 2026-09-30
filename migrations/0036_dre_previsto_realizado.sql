-- ═══════════════════════════════════════════════════════════════
-- 0036 — DRE Previsto x Realizado: mapeamento da taxonomia + orçamento
-- ═══════════════════════════════════════════════════════════════
-- Contexto (29/09/2026): PLANEJAMENTO_DRE.md pede a DRE da planilha
-- "DRE - MX SEGUROS" (grupos 1.1 … 8.1) com Previsto cadastrável.
--
-- Decisão do Gabriel: REAPROVEITAR a taxonomia existente em vez de criar
-- um plano de contas paralelo. As categorias de despesa já são os grupos
-- 4.1–4.6, 7.1 e 7.2 da planilha (mesmos nomes) e os subitens já são as
-- contas. Um campo "Conta DRE" extra em cada formulário criaria duas
-- classificações por lançamento que podem divergir.
--
-- Esta migration é ADITIVA: só acrescenta colunas, categorias, subitens
-- e uma tabela. Nada existente é alterado além do mapeamento dre_grupo.
-- Idempotente: pode rodar duas vezes.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. colunas de mapeamento ───────────────────────────────────
ALTER TABLE categorias_lancamento ADD COLUMN IF NOT EXISTS dre_grupo TEXT;
-- Subitem pode sobrescrever o grupo da categoria (caso das receitas legadas,
-- que vivem numa categoria só mas pertencem a grupos diferentes).
ALTER TABLE subitens_lancamento ADD COLUMN IF NOT EXISTS dre_grupo TEXT;
-- Papel de sistema: liga a conta às tabelas que não têm subitem
-- (comissoes, estornos, repasses, impostos). Ver dre_gerencial_service.
ALTER TABLE subitens_lancamento ADD COLUMN IF NOT EXISTS dre_papel TEXT;

DO $$ BEGIN
  ALTER TABLE categorias_lancamento ADD CONSTRAINT categorias_dre_grupo_valido
    CHECK (dre_grupo IS NULL OR dre_grupo IN ('1.1','2.1','4.1','4.2','4.3','4.4','4.5','4.6','7.1','7.2','8.1'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE subitens_lancamento ADD CONSTRAINT subitens_dre_grupo_valido
    CHECK (dre_grupo IS NULL OR dre_grupo IN ('1.1','2.1','4.1','4.2','4.3','4.4','4.5','4.6','7.1','7.2','8.1'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE subitens_lancamento ADD CONSTRAINT subitens_dre_papel_valido
    CHECK (dre_papel IS NULL OR dre_papel IN ('comissoes','repasses','impostos'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. categorias existentes → grupos (pelo slug, que não muda com renomeação)
UPDATE categorias_lancamento SET dre_grupo = CASE codigo
    WHEN 'pessoal'                    THEN '4.1'
    WHEN 'comercial'                  THEN '4.2'
    WHEN 'administrativa_operacional' THEN '4.3'
    WHEN 'veiculos'                   THEN '4.4'
    WHEN 'terceiros'                  THEN '4.5'
    WHEN 'financeira'                 THEN '4.6'
    WHEN 'nao_operacional'            THEN '7.1'
    WHEN 'investimento_imobilizado'   THEN '7.2'
  END
WHERE codigo IN ('pessoal','comercial','administrativa_operacional','veiculos',
                 'terceiros','financeira','nao_operacional','investimento_imobilizado')
  AND dre_grupo IS NULL;

-- "Receitas Diversas" (sem slug) = receita fora da atividade principal.
UPDATE categorias_lancamento SET dre_grupo = '8.1'
WHERE natureza = 'receita' AND codigo IS NULL AND nome = 'Receitas Diversas' AND dre_grupo IS NULL;

-- ── 3. categorias e contas que a planilha tem e o sistema não ──
DO $$
DECLARE
  v_tenant UUID;
  v_var    UUID;
  v_rv     UUID;
  v_rno    UUID;
BEGIN
  SELECT id INTO v_tenant FROM tenants WHERE slug = 'mx-seguros';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant mx-seguros não encontrado.'; END IF;

  INSERT INTO categorias_lancamento (nome, natureza, codigo, ordem, tenant_id, dre_grupo)
  SELECT 'Despesas variáveis', 'despesa', 'variaveis', 5, v_tenant, '2.1'
  WHERE NOT EXISTS (SELECT 1 FROM categorias_lancamento WHERE tenant_id = v_tenant AND codigo = 'variaveis');
  INSERT INTO categorias_lancamento (nome, natureza, codigo, ordem, tenant_id, dre_grupo)
  SELECT 'Receitas de vendas', 'receita', 'receita_vendas', 1, v_tenant, '1.1'
  WHERE NOT EXISTS (SELECT 1 FROM categorias_lancamento WHERE tenant_id = v_tenant AND codigo = 'receita_vendas');
  INSERT INTO categorias_lancamento (nome, natureza, codigo, ordem, tenant_id, dre_grupo)
  SELECT 'Receitas não operacionais', 'receita', 'receita_nao_operacional', 20, v_tenant, '8.1'
  WHERE NOT EXISTS (SELECT 1 FROM categorias_lancamento WHERE tenant_id = v_tenant AND codigo = 'receita_nao_operacional');

  SELECT id INTO v_var FROM categorias_lancamento WHERE tenant_id = v_tenant AND codigo = 'variaveis';
  SELECT id INTO v_rv  FROM categorias_lancamento WHERE tenant_id = v_tenant AND codigo = 'receita_vendas';
  SELECT id INTO v_rno FROM categorias_lancamento WHERE tenant_id = v_tenant AND codigo = 'receita_nao_operacional';

  -- (nome, natureza, categoria_id, custo_tipo, ativo, dre_papel)
  -- Inativas: contas típicas de indústria (plano §8 q5) e "Recebimentos no
  -- mês", que pode duplicar as comissões (plano P1, em aberto) — existem no
  -- plano de contas mas não aparecem nos formulários.
  INSERT INTO subitens_lancamento (nome, natureza, categoria_id, custo_tipo, ativo, dre_papel, tenant_id)
  SELECT v.nome, v.natureza, v.cat, v.custo, v.ativo, v.papel, v_tenant
  FROM (VALUES
    ('Impostos sobre Vendas',                               'despesa', v_var, 'imposto',  TRUE,  'impostos'),
    ('Premiações',                                          'despesa', v_var, 'variavel', TRUE,  NULL),
    ('Custo do Serviço Prestado (CSP)',                     'despesa', v_var, 'variavel', TRUE,  'repasses'),
    ('Outros Custos de Vendas (Descontos, Rebate, Etc.)',   'despesa', v_var, 'variavel', TRUE,  NULL),
    ('Embalagens e Afins',                                  'despesa', v_var, 'variavel', FALSE, NULL),
    ('Fretes e Despesas de Transporte - Vendas',            'despesa', v_var, 'variavel', FALSE, NULL),
    ('Comissões de Vendas',                                 'receita', v_rv,  NULL,       TRUE,  'comissoes'),
    ('Comissões - Adicionais / Premiações',                 'receita', v_rv,  NULL,       TRUE,  NULL),
    ('Receitas de Vendas (Recebimentos no mês)',            'receita', v_rv,  NULL,       FALSE, NULL),
    ('Outras Receitas Não Operacionais',                    'receita', v_rno, NULL,       TRUE,  NULL)
  ) AS v(nome, natureza, cat, custo, ativo, papel)
  WHERE NOT EXISTS (
    SELECT 1 FROM subitens_lancamento s
    WHERE s.tenant_id = v_tenant AND s.natureza = v.natureza AND lower(s.nome) = lower(v.nome)
  );
END $$;

-- ── 4. receitas legadas: uma categoria, dois grupos ────────────
UPDATE subitens_lancamento SET dre_grupo = '1.1'
WHERE natureza = 'receita' AND nome = 'Receita de Serviço / Honorário' AND dre_grupo IS NULL;
UPDATE subitens_lancamento SET dre_grupo = '8.1'
WHERE natureza = 'receita' AND nome IN ('Receita Financeira', 'Recuperação de Despesa', 'Outras Receitas')
  AND dre_grupo IS NULL;

-- ── 5. Previsto (meta) mensal por conta ────────────────────────
CREATE TABLE IF NOT EXISTS dre_orcamento (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  subitem_id  UUID NOT NULL REFERENCES subitens_lancamento(id) ON DELETE CASCADE,
  ano         INT  NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  mes         INT  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor       NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subitem_id, ano, mes)
);
CREATE INDEX IF NOT EXISTS idx_dre_orcamento_tenant_ano ON dre_orcamento (tenant_id, ano);

-- RLS: mesmo padrão da taxonomia (0025) — o tenant lê; admin/gestor escrevem.
ALTER TABLE dre_orcamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dre_orcamento_select ON dre_orcamento;
CREATE POLICY dre_orcamento_select ON dre_orcamento
  FOR SELECT TO authenticated
  USING (_tenant_ok(tenant_id));

DROP POLICY IF EXISTS dre_orcamento_insert ON dre_orcamento;
CREATE POLICY dre_orcamento_insert ON dre_orcamento
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_meu_tenant() AND get_meu_role() IN ('admin', 'gestor', 'super_admin'));

DROP POLICY IF EXISTS dre_orcamento_update ON dre_orcamento;
CREATE POLICY dre_orcamento_update ON dre_orcamento
  FOR UPDATE TO authenticated
  USING (_tenant_ok(tenant_id) AND get_meu_role() IN ('admin', 'gestor', 'super_admin'));

DROP POLICY IF EXISTS dre_orcamento_delete ON dre_orcamento;
CREATE POLICY dre_orcamento_delete ON dre_orcamento
  FOR DELETE TO authenticated
  USING (_tenant_ok(tenant_id) AND get_meu_role() IN ('admin', 'gestor', 'super_admin'));

COMMIT;
