-- 0050 — Pagamentos por CNAB 240: fornecedores, contas pagadoras, remessas e
-- retornos (25/11/2026)
--
-- A despesa aprovada (status = 'aprovada', sem paga_em) entra numa remessa
-- CNAB 240 (Santander V11.7 / Itaú SISPAG v085). O usuário importa e autoriza
-- o arquivo no banco; o retorno dá a baixa.
--
-- Todas as tabelas novas: RLS ligada SEM policies — só a API (service_role)
-- acessa. Dados bancários e chaves Pix nunca chegam ao navegador direto.
-- Rodar no SQL Editor do Supabase.

-- ── Favorecidos ───────────────────────────────────────────────
-- Fornecedor ou funcionário (funcionario_id preenchido). CNPJ pode ser
-- alfanumérico (Receita, jul/2026).
CREATE TABLE IF NOT EXISTS fornecedores (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID REFERENCES tenants(id),
  nome                   TEXT NOT NULL,
  tipo_pessoa            TEXT NOT NULL DEFAULT 'J' CHECK (tipo_pessoa IN ('F', 'J')),
  cpf_cnpj               TEXT,
  banco_codigo           TEXT,
  ispb                   TEXT,
  agencia                TEXT,
  agencia_dv             TEXT,
  conta                  TEXT,
  conta_dv               TEXT,
  tipo_conta             TEXT CHECK (tipo_conta IN ('corrente', 'poupanca', 'pagamento')),
  pix_tipo_chave         TEXT CHECK (pix_tipo_chave IN ('telefone', 'email', 'cpf_cnpj', 'aleatoria')),
  pix_chave              TEXT,
  forma_pagamento_padrao TEXT,
  funcionario_id         UUID UNIQUE REFERENCES funcionarios(id) ON DELETE SET NULL,
  ativo                  BOOLEAN NOT NULL DEFAULT true,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fornecedores_tenant ON fornecedores (tenant_id, ativo);
ALTER TABLE fornecedores ENABLE ROW LEVEL SECURITY;

-- ── Contas de onde sai o pagamento ────────────────────────────
-- opcoes (convênio Santander): {"sequencial_teste": bool,
--   "seu_numero_obrigatorio": bool, "sequencia": "nenhuma|restrita|diferente",
--   "enviar_bloqueado": bool (instrução 09, padrão true)}
CREATE TABLE IF NOT EXISTS contas_pagadoras (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id),
  banco_id         UUID REFERENCES bancos(id),
  codigo_banco     TEXT NOT NULL CHECK (codigo_banco IN ('033', '341')),
  apelido          TEXT,
  agencia          TEXT NOT NULL,
  agencia_dv       TEXT,
  conta            TEXT NOT NULL,
  conta_dv         TEXT,
  cnpj_empresa     TEXT NOT NULL,
  razao_social     TEXT NOT NULL,
  codigo_convenio  TEXT,
  endereco         JSONB NOT NULL DEFAULT '{}'::jsonb,
  proximo_nsa      INT NOT NULL DEFAULT 1,
  ambiente         TEXT NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao', 'producao')),
  opcoes           JSONB NOT NULL DEFAULT '{"enviar_bloqueado": true}'::jsonb,
  ativa            BOOLEAN NOT NULL DEFAULT true,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE contas_pagadoras ENABLE ROW LEVEL SECURITY;

-- ── Remessa (lote lógico) e seus arquivos ─────────────────────
CREATE TABLE IF NOT EXISTS remessas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),
  conta_id        UUID NOT NULL REFERENCES contas_pagadoras(id),
  data_pagamento  DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'gerada'
                    CHECK (status IN ('gerada', 'enviada', 'parcial', 'processada', 'cancelada')),
  ambiente        TEXT NOT NULL DEFAULT 'homologacao',
  qtd_itens       INT NOT NULL DEFAULT 0,
  valor_total     NUMERIC(14,2) NOT NULL DEFAULT 0,
  criado_por      UUID,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_em      TIMESTAMPTZ,
  cancelada_em    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_remessas_tenant ON remessas (tenant_id, criado_em DESC);
ALTER TABLE remessas ENABLE ROW LEVEL SECURITY;

-- Itaú separa os lotes Pix num arquivo próprio: 1..n arquivos por remessa.
CREATE TABLE IF NOT EXISTS remessa_arquivos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remessa_id    UUID NOT NULL REFERENCES remessas(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id),
  tipo          TEXT NOT NULL DEFAULT 'geral' CHECK (tipo IN ('geral', 'pix')),
  nsa           INT NOT NULL,
  layout        TEXT NOT NULL,
  path          TEXT NOT NULL,
  nome_arquivo  TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  qtd_itens     INT NOT NULL DEFAULT 0,
  valor_total   NUMERIC(14,2) NOT NULL DEFAULT 0,
  retorno_ok    BOOLEAN NOT NULL DEFAULT false,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_remessa_arquivos_remessa ON remessa_arquivos (remessa_id);
ALTER TABLE remessa_arquivos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS remessa_itens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remessa_id       UUID NOT NULL REFERENCES remessas(id) ON DELETE CASCADE,
  arquivo_id       UUID REFERENCES remessa_arquivos(id) ON DELETE CASCADE,
  tenant_id        UUID REFERENCES tenants(id),
  despesa_id       UUID NOT NULL REFERENCES despesas(id),
  fornecedor_id    UUID REFERENCES fornecedores(id),
  forma_pagamento  TEXT NOT NULL,
  lote             INT,
  sequencial       INT,
  seu_numero       TEXT NOT NULL,
  valor            NUMERIC(14,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'em_remessa',
  ocorrencias      TEXT[] NOT NULL DEFAULT '{}',
  motivo           TEXT,
  autenticacao     TEXT,
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_remessa_itens_seu_numero ON remessa_itens (tenant_id, seu_numero);
CREATE INDEX IF NOT EXISTS idx_remessa_itens_despesa ON remessa_itens (despesa_id);
ALTER TABLE remessa_itens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS retornos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(id),
  codigo_banco   TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'movimento' CHECK (tipo IN ('critica', 'movimento')),
  nsa            INT,
  nome_arquivo   TEXT NOT NULL,
  path           TEXT,
  sha256         TEXT NOT NULL,
  resumo         JSONB NOT NULL DEFAULT '{}'::jsonb,
  importado_por  UUID,
  importado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);
ALTER TABLE retornos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS despesa_pagamento_eventos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  despesa_id  UUID NOT NULL REFERENCES despesas(id),
  item_id     UUID REFERENCES remessa_itens(id) ON DELETE SET NULL,
  evento      TEXT NOT NULL,
  detalhe     JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_id  UUID,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pag_eventos_despesa ON despesa_pagamento_eventos (despesa_id, criado_em);
ALTER TABLE despesa_pagamento_eventos ENABLE ROW LEVEL SECURITY;

-- Tabela de códigos de ocorrência por banco (seed na fase do retorno).
CREATE TABLE IF NOT EXISTS cnab_ocorrencias (
  codigo_banco  TEXT NOT NULL,
  codigo        TEXT NOT NULL,
  descricao     TEXT NOT NULL,
  resultado     TEXT NOT NULL CHECK (resultado IN ('ok', 'agendado', 'bloqueado', 'rejeitado', 'devolvido', 'info')),
  PRIMARY KEY (codigo_banco, codigo)
);
ALTER TABLE cnab_ocorrencias ENABLE ROW LEVEL SECURITY;

-- Feriados extras (municipais etc.). Os nacionais são calculados no código.
CREATE TABLE IF NOT EXISTS feriados (
  tenant_id  UUID REFERENCES tenants(id),
  data       DATE NOT NULL,
  descricao  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, data)
);
ALTER TABLE feriados ENABLE ROW LEVEL SECURITY;

-- ── Despesa: dados do pagamento ───────────────────────────────
ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS fornecedor_id     UUID REFERENCES fornecedores(id),
  ADD COLUMN IF NOT EXISTS forma_pagamento   TEXT,
  ADD COLUMN IF NOT EXISTS valor_pagamento   NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS codigo_barras     TEXT,
  ADD COLUMN IF NOT EXISTS linha_digitavel   TEXT,
  ADD COLUMN IF NOT EXISTS vencimento_boleto DATE,
  ADD COLUMN IF NOT EXISTS cedente_cpf_cnpj  TEXT,
  ADD COLUMN IF NOT EXISTS cedente_nome      TEXT,
  ADD COLUMN IF NOT EXISTS pix_copia_cola    TEXT,
  ADD COLUMN IF NOT EXISTS tributo           JSONB,
  ADD COLUMN IF NOT EXISTS status_pagamento  TEXT
    CHECK (status_pagamento IN ('em_remessa', 'agendada', 'bloqueada_banco', 'paga',
                                'rejeitada', 'devolvida', 'paga_manual')),
  ADD COLUMN IF NOT EXISTS remessa_item_id   UUID REFERENCES remessa_itens(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_despesas_status_pagamento ON despesas (tenant_id, status_pagamento);

-- ── NSA atômico ───────────────────────────────────────────────
-- Devolve o NSA reservado e avança o contador da conta.
CREATE OR REPLACE FUNCTION cnab_reservar_nsa(p_conta_id UUID)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE contas_pagadoras
     SET proximo_nsa = proximo_nsa + 1, atualizado_em = now()
   WHERE id = p_conta_id
  RETURNING proximo_nsa - 1;
$$;
REVOKE ALL ON FUNCTION cnab_reservar_nsa(UUID) FROM PUBLIC, anon, authenticated;

-- ── Bucket privado dos arquivos de remessa/retorno ────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('cnab', 'cnab', false, 5242880)
ON CONFLICT (id) DO NOTHING;
