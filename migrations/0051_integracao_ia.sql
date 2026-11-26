-- 0051 — Chave da API de IA (Anthropic) gerenciada em Configurações (só Admin).
--
-- A chave fica CIFRADA (Fernet/AES; a chave de cifra é derivada de um segredo do
-- servidor, nunca do banco). RLS ligado e SEM policies: só a API (service_role)
-- lê e grava — a chave nunca chega ao navegador; a tela mostra só a máscara.
-- Sem linha aqui, o sistema usa ANTHROPIC_API_KEY do ambiente (comportamento atual).

CREATE TABLE IF NOT EXISTS integracoes_ia (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),
  provedor        TEXT NOT NULL DEFAULT 'anthropic' CHECK (provedor IN ('anthropic')),
  chave_cifrada   TEXT NOT NULL,
  mascara         TEXT NOT NULL,          -- ex.: sk-ant-…QAA (para exibir)
  atualizada_por  UUID,
  atualizada_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_ia_tenant_provedor
  ON integracoes_ia (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), provedor);

ALTER TABLE integracoes_ia ENABLE ROW LEVEL SECURITY;
-- Sem policies de propósito (acesso só pela API com service_role).
REVOKE ALL ON integracoes_ia FROM anon, authenticated;
