-- 0047 — Ordem de Compra para funcionários: perfil Colaborador (24/11/2026)
--
-- Funcionário da MX entra por um link fácil (/oc) e lança a despesa que vai
-- ter — ex.: "viajo amanhã para SP, R$ 150 de gasolina" — com foto da nota.
-- A ordem passa pela aprovação; ao ser APROVADA vira despesa automaticamente
-- (a pagar, no mês da data prevista), com os anexos da ordem.
--
-- Perfil "colaborador": só abre /oc e só vê as próprias ordens. A API nega
-- todo o resto (app/auth.py). A RLS de ordens_compra (0031) já restringe quem
-- não é admin/gestor/contador às próprias ordens; nas demais tabelas o perfil
-- não aparece nas policies, então não lê nada.
--
-- Pode rodar inteira de uma vez no SQL Editor do Supabase: nada aqui usa o
-- valor novo do enum na mesma transação (o Postgres não deixaria).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'colaborador';

ALTER TABLE ordens_compra
  ADD COLUMN IF NOT EXISTS data_prevista      DATE,
  ADD COLUMN IF NOT EXISTS centro_custo       TEXT,
  ADD COLUMN IF NOT EXISTS tipo_lancamento_id UUID REFERENCES subitens_lancamento(id),
  ADD COLUMN IF NOT EXISTS despesa_id         UUID REFERENCES despesas(id);

-- Ordens antigas: a data prevista é a da solicitação.
UPDATE ordens_compra SET data_prevista = data_solicitacao WHERE data_prevista IS NULL;

CREATE INDEX IF NOT EXISTS idx_ordens_compra_criado_por ON ordens_compra (criado_por);
