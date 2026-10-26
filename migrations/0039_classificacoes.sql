-- 0039 — Lista de classificações editável (22/10/2026)
--
-- Antes: subitens_lancamento.custo_tipo aceitava só fixo | variavel |
-- nao_operacional | imposto (CHECK da 0030). Agora a lista vive na tabela
-- `classificacoes`, editável em Configurações, e o CHECK vira FOREIGN KEY.
-- As 4 originais são "sistema": a DRE (dre_por_periodo) e o box Fixas vs.
-- Variáveis dependem delas — podem ser renomeadas, não excluídas/desativadas.
-- Novas: Aplicações e Empréstimos (pedido do Gabriel). Vale para despesa e receita.

CREATE TABLE IF NOT EXISTS classificacoes (
  codigo     TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  natureza   TEXT NOT NULL DEFAULT 'ambas' CHECK (natureza IN ('despesa', 'receita', 'ambas')),
  ordem      INT  NOT NULL DEFAULT 0,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  sistema    BOOLEAN NOT NULL DEFAULT false,
  tenant_id  UUID REFERENCES tenants(id),
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO classificacoes (codigo, nome, ordem, sistema, tenant_id)
SELECT v.codigo, v.nome, v.ordem, v.sistema, (SELECT id FROM tenants ORDER BY criado_em NULLS LAST LIMIT 1)
FROM (VALUES
  ('fixo',            'Fixo',            1, true),
  ('variavel',        'Variável',        2, true),
  ('imposto',         'Imposto',         3, true),
  ('nao_operacional', 'Não Operacional', 4, true),
  ('aplicacoes',      'Aplicações',      5, false),
  ('emprestimos',     'Empréstimos',     6, false)
) AS v(codigo, nome, ordem, sistema)
ON CONFLICT (codigo) DO NOTHING;

-- CHECK fixo → FK para a lista (renomear o código propaga para os subitens).
ALTER TABLE subitens_lancamento DROP CONSTRAINT IF EXISTS subitens_lancamento_custo_tipo_check;
ALTER TABLE subitens_lancamento DROP CONSTRAINT IF EXISTS tipos_lancamento_custo_tipo_check;
ALTER TABLE subitens_lancamento DROP CONSTRAINT IF EXISTS subitens_lancamento_custo_tipo_fk;
ALTER TABLE subitens_lancamento
  ADD CONSTRAINT subitens_lancamento_custo_tipo_fk
  FOREIGN KEY (custo_tipo) REFERENCES classificacoes(codigo) ON UPDATE CASCADE;

-- RLS: todos do tenant leem; escrita só pelo backend (service_role, admin).
ALTER TABLE classificacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS classificacoes_select ON classificacoes;
CREATE POLICY classificacoes_select ON classificacoes
  FOR SELECT TO authenticated
  USING (_tenant_ok(tenant_id));
