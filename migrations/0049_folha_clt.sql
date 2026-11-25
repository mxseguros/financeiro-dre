-- 0049 — Folha CLT: contrato do funcionário, parâmetros e folha do mês (25/11/2026)
--
-- Configurações → Funcionários ganha "Contrato e salário" (só Admin): salário,
-- adicionais, dependentes, VT, VA, plano de saúde, seguro... O sistema calcula
-- INSS e IRRF do empregado pela tabela (folha_parametros, editável por ano),
-- FGTS e o custo total. A folha do mês (folhas/folha_itens) gera as despesas.
--
-- Todas as tabelas: RLS ligada SEM policies — só a API acessa (salário é
-- confidencial; o detalhe sai só para o Admin). Mesmo padrão de funcionarios.

CREATE TABLE IF NOT EXISTS funcionarios_contrato (
  funcionario_id         UUID PRIMARY KEY REFERENCES funcionarios(id) ON DELETE CASCADE,
  tenant_id              UUID REFERENCES tenants(id),
  tipo_contrato          TEXT NOT NULL DEFAULT 'clt'
                           CHECK (tipo_contrato IN ('clt', 'estagio', 'pj', 'pro_labore')),
  cargo                  TEXT,
  data_admissao          DATE,
  data_desligamento      DATE,
  salario_base           NUMERIC(12,2) NOT NULL DEFAULT 0,
  adicionais             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"noturno": {"pct": 20}, "insalubridade": {"valor": 303.6}}
  dependentes_ir         INT NOT NULL DEFAULT 0,
  filhos_salario_familia INT NOT NULL DEFAULT 0,
  pensao_alimenticia     NUMERIC(12,2) NOT NULL DEFAULT 0,
  vt_custo_mensal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  vt_descontar           BOOLEAN NOT NULL DEFAULT true,
  va_valor               NUMERIC(12,2) NOT NULL DEFAULT 0,
  plano_saude_empresa    NUMERIC(12,2) NOT NULL DEFAULT 0,
  plano_saude_desconto   NUMERIC(12,2) NOT NULL DEFAULT 0,
  seguro_vida            NUMERIC(12,2) NOT NULL DEFAULT 0,
  outros_beneficios      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{"nome": "Auxílio-creche", "valor": 300}]
  sindical               JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"valor": 30}
  banco_pagamento        TEXT,                                 -- chave PIX / conta, texto livre
  atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE funcionarios_contrato ENABLE ROW LEVEL SECURITY;

-- Tabelas de INSS/IRRF etc. por ano. Sem linha, o backend usa os valores de
-- partida (folha_calculo.PARAMETROS_PADRAO), marcados como "a conferir".
CREATE TABLE IF NOT EXISTS folha_parametros (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id),
  ano        INT NOT NULL,
  dados      JSONB NOT NULL,
  conferido  BOOLEAN NOT NULL DEFAULT false,
  atualizado_por UUID,
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ano)
);
ALTER TABLE folha_parametros ENABLE ROW LEVEL SECURITY;

-- Em que subitem cada rubrica da folha vira despesa.
CREATE TABLE IF NOT EXISTS folha_rubrica_subitem (
  tenant_id  UUID REFERENCES tenants(id),
  rubrica    TEXT NOT NULL,
  subitem_id UUID REFERENCES subitens_lancamento(id),
  PRIMARY KEY (tenant_id, rubrica)
);
ALTER TABLE folha_rubrica_subitem ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS folhas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  competencia DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'gerada')),
  totais      JSONB NOT NULL DEFAULT '{}'::jsonb,
  gerada_por  UUID,
  gerada_em   TIMESTAMPTZ,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, competencia)
);
ALTER TABLE folhas ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS folha_itens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folha_id       UUID NOT NULL REFERENCES folhas(id) ON DELETE CASCADE,
  tenant_id      UUID REFERENCES tenants(id),
  funcionario_id UUID NOT NULL REFERENCES funcionarios(id),
  centro_custo   TEXT,
  variaveis      JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculo        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ajustes        JSONB NOT NULL DEFAULT '{}'::jsonb,
  despesa_ids    UUID[] NOT NULL DEFAULT '{}',
  UNIQUE (folha_id, funcionario_id)
);
CREATE INDEX IF NOT EXISTS idx_folha_itens_folha ON folha_itens (folha_id);
ALTER TABLE folha_itens ENABLE ROW LEVEL SECURITY;

-- Mapeamento inicial rubrica → subitem, pelos nomes que existem hoje em
-- "Despesas com pessoal". Dá para trocar em Configurações → Folha.
INSERT INTO folha_rubrica_subitem (tenant_id, rubrica, subitem_id)
SELECT s.tenant_id, m.rubrica, s.id
  FROM (VALUES
    ('salario_liquido', 'folha - sal%'),
    ('vt',              'folha - sal%'),
    ('variaveis',       'folha - adicionais%'),
    ('premio',          'folha - pr_mios%'),
    ('fgts',            'guia fgts%'),
    ('inss',            'encargos sociais%'),
    ('irrf',            'encargos sociais%'),
    ('va',              'vale alimenta%'),
    ('plano_saude',     'plano de sa%'),
    ('seguro_vida',     'seguro de vida%'),
    ('decimo_terceiro', '13%'),
    ('ferias',          'f_rias%')
  ) AS m(rubrica, padrao)
  JOIN LATERAL (
    SELECT id, tenant_id FROM subitens_lancamento
     WHERE natureza = 'despesa' AND ativo AND lower(btrim(nome)) LIKE m.padrao
     ORDER BY nome LIMIT 1
  ) s ON true
ON CONFLICT (tenant_id, rubrica) DO NOTHING;

-- Encargos (INSS/IRRF retidos) por centro trazem a soma dos salários do
-- centro: também confidenciais (para quem não é Admin, entram no total).
UPDATE subitens_lancamento SET confidencial = true
 WHERE natureza = 'despesa' AND lower(btrim(nome)) LIKE 'encargos sociais%';
