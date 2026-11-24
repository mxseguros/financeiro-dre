-- 0044 — Centros de custo em grupos e subgrupos (24/11/2026)
--
-- Ex.: "1.00 - Venda Nova" (grupo) › "1.21 - Saúde e Vida", "1.22 - Auto".
-- Até dois níveis: grupo (parent_id NULL) e subgrupo (parent_id = grupo).
-- O lançamento continua guardando o CODIGO do centro (texto) — nada muda nos
-- dados existentes. Grupo com subgrupos não recebe lançamento (validado no
-- backend); centro sem filhos segue aceitando lançamento normalmente.
--
-- Também corrige dois problemas antigos:
--   * centros criados pela tela ficavam com tenant_id NULL (o service não
--     gravava o tenant) e por isso a RLS os escondia de todos os usuários;
--   * UNIQUE(codigo) era global — passa a ser por tenant.
--
-- O código tolera as colunas ausentes: rodar no SQL Editor do Supabase
-- antes ou depois do deploy.

ALTER TABLE centros_custo
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES centros_custo(id),
  ADD COLUMN IF NOT EXISTS numero    TEXT,
  ADD COLUMN IF NOT EXISTS ordem     INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_centros_custo_parent ON centros_custo (parent_id);

-- Centros sem tenant: só há um tenant em produção (MX Seguros). Se houver
-- mais de um, não adivinha — deixa para correção manual.
DO $$
BEGIN
  IF (SELECT count(*) FROM tenants) = 1 THEN
    UPDATE centros_custo
       SET tenant_id = (SELECT id FROM tenants LIMIT 1)
     WHERE tenant_id IS NULL;
  END IF;
END $$;

-- UNIQUE(codigo) global → UNIQUE(tenant_id, codigo)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'centros_custo'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) = 'UNIQUE (codigo)'
  LOOP
    EXECUTE format('ALTER TABLE centros_custo DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_centros_custo_tenant_codigo
  ON centros_custo (tenant_id, codigo);

-- Exclusão pela tela (o backend bloqueia centro em uso ou com subgrupos).
DROP POLICY IF EXISTS centros_custo_delete ON centros_custo;
CREATE POLICY centros_custo_delete ON centros_custo FOR DELETE TO authenticated
  USING (_tenant_ok(tenant_id) AND get_meu_role() IN ('admin', 'super_admin'));
