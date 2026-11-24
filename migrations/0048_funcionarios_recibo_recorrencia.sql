-- 0048 — Funcionários, recibo da Ordem de Compra e recorrência editável (24/11/2026)
--
-- 1. funcionarios: cadastro em Configurações → Funcionários (nome completo e
--    centro de custo). É a lista do campo "Quem é você?" no link /oc.
--    RLS ligada SEM policies: o acesso é só pela API (mesmo padrão de anexos).
-- 2. ordens_compra: funcionário da ordem e o fluxo do recibo depois da
--    aprovação: aguardando → enviado → aprovado | devolvido (volta ao
--    funcionário com o motivo).
-- 3. grupo_recorrencia em despesas e receitas_outras (e recorrente em
--    receitas_outras): marca a série criada por "Repetir até", para a edição
--    estender, encurtar ou desligar a recorrência sem adivinhar as irmãs.
--
-- O código tolera as colunas ausentes: pode rodar antes ou depois do deploy.

CREATE TABLE IF NOT EXISTS funcionarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES tenants(id),
  nome         TEXT NOT NULL,
  centro_custo TEXT,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funcionarios_tenant ON funcionarios (tenant_id);
ALTER TABLE funcionarios ENABLE ROW LEVEL SECURITY;

ALTER TABLE ordens_compra
  ADD COLUMN IF NOT EXISTS funcionario_id      UUID REFERENCES funcionarios(id),
  ADD COLUMN IF NOT EXISTS recibo_status       TEXT
    CHECK (recibo_status IN ('aguardando', 'enviado', 'aprovado', 'devolvido')),
  ADD COLUMN IF NOT EXISTS recibo_motivo       TEXT,
  ADD COLUMN IF NOT EXISTS recibo_enviado_em   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recibo_conferido_por UUID,
  ADD COLUMN IF NOT EXISTS recibo_conferido_em TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ordens_compra_recibo ON ordens_compra (recibo_status);

-- OC aprovada antes desta migration (já virou despesa) passa a aguardar o recibo.
UPDATE ordens_compra SET recibo_status = 'aguardando'
 WHERE despesa_id IS NOT NULL AND recibo_status IS NULL AND status = 'aprovada';

ALTER TABLE despesas ADD COLUMN IF NOT EXISTS grupo_recorrencia UUID;
CREATE INDEX IF NOT EXISTS idx_despesas_grupo_recorrencia ON despesas (grupo_recorrencia);

ALTER TABLE receitas_outras
  ADD COLUMN IF NOT EXISTS recorrente        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grupo_recorrencia UUID;
CREATE INDEX IF NOT EXISTS idx_receitas_outras_grupo_recorrencia ON receitas_outras (grupo_recorrencia);
