-- 0045 — Anexos de lançamentos: Nota Fiscal, Boleto, comprovante (24/11/2026)
--
-- O arquivo vai direto do navegador para o Storage do Supabase (bucket
-- privado "anexos"), por uma URL de upload assinada que o backend gera depois
-- de conferir o acesso ao lançamento. Assim o arquivo não passa pela função
-- da Vercel, que limita o corpo da requisição a 4,5 MB. A leitura também é
-- por URL assinada, de curta duração: o bucket não tem policy pública.
--
-- Caminho no bucket: {tenant_id}/{entidade}/{entidade_id}/{uuid}-{arquivo}
--
-- Sem esta migration, anexar devolve o aviso "Anexos ainda não habilitados".
-- Rodar no SQL Editor do Supabase.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'anexos', 'anexos', false, 10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS anexos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),
  entidade        TEXT NOT NULL CHECK (entidade IN ('despesa', 'receita', 'ordem_compra')),
  entidade_id     UUID NOT NULL,
  tipo_documento  TEXT NOT NULL DEFAULT 'outro'
                  CHECK (tipo_documento IN ('nota_fiscal', 'boleto', 'comprovante', 'outro')),
  path            TEXT NOT NULL,
  nome_arquivo    TEXT NOT NULL,
  mime            TEXT,
  tamanho         BIGINT,
  criado_por      UUID REFERENCES auth.users(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anexos_entidade ON anexos (entidade, entidade_id);

-- Todo acesso passa pelo backend (service_role), que confere quem pode ver o
-- lançamento — inclusive a regra de salários confidenciais. Por isso a RLS fica
-- ligada SEM policy: consulta direta pelo navegador (anon key + JWT) não vê
-- nada, nem o nome dos arquivos.
ALTER TABLE anexos ENABLE ROW LEVEL SECURITY;
