-- ═══════════════════════════════════════════════════════════════
-- 0035 — grupo_parcelamento: marcador explícito de grupo
-- ═══════════════════════════════════════════════════════════════
-- Contexto (20/08/2026): pedido para permitir alterar o número de
-- parcelas depois da importação. Isso exige saber, com certeza,
-- quais linhas formam um parcelamento — e hoje não existe essa
-- informação no banco.
--
-- A correlação atual é HEURÍSTICA: `deletar_despesa` junta as
-- irmãs por descricao + parcela_total + tipo_lancamento_id +
-- criado_por (financeiro_service.py:786-797). O próprio código
-- registra a limitação: "criam N linhas irmãs sem marcador de
-- grupo".
--
-- Isso já é um bug em produção, independente do pedido novo:
-- editar a descrição de uma parcela é permitido, e ao fazer isso
-- a linha deixa de casar com as irmãs. Ela desgarra do grupo em
-- silêncio, e "excluir futuras" passa a ignorá-la. Ninguém vê o
-- erro acontecer — só a consequência, meses depois.
--
-- Com a coluna, o vínculo passa a ser explícito e sobrevive a
-- qualquer edição de campo.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS grupo_parcelamento UUID;

COMMENT ON COLUMN despesas.grupo_parcelamento IS
  'Liga as parcelas de um mesmo parcelamento. NULL = lançamento avulso.';

-- ── backfill ──────────────────────────────────────────────────
-- Usa a heurística antiga UMA ÚNICA VEZ, para converter o que já
-- existe. Grupos que já tenham sido desgarrados por uma edição de
-- descrição não têm como ser reconstituídos — a informação se
-- perdeu quando a edição ocorreu. Eles ficam como avulsos, que é
-- o comportamento que já apresentam hoje na prática.
-- O trigger de 0034 grava atualizado_em=now() em QUALQUER update. Sem
-- desligá-lo, este backfill — que é técnico e não altera nada que o
-- usuário veja — jogaria todo o histórico de parcelas para o topo das
-- telas de Lançamentos e Aprovações, que ordenam pelo último alterado.
ALTER TABLE despesas DISABLE TRIGGER trg_despesas_atualizado_em;

WITH grupos AS (
  SELECT
    descricao,
    parcela_total,
    tipo_lancamento_id,
    criado_por,
    gen_random_uuid() AS gid
  FROM despesas
  WHERE parcela_total > 1
    AND grupo_parcelamento IS NULL
  GROUP BY descricao, parcela_total, tipo_lancamento_id, criado_por
)
UPDATE despesas d
   SET grupo_parcelamento = g.gid
  FROM grupos g
 WHERE d.parcela_total > 1
   AND d.grupo_parcelamento IS NULL
   AND d.descricao      = g.descricao
   AND d.parcela_total  = g.parcela_total
   AND d.tipo_lancamento_id IS NOT DISTINCT FROM g.tipo_lancamento_id
   AND d.criado_por         IS NOT DISTINCT FROM g.criado_por;

ALTER TABLE despesas ENABLE TRIGGER trg_despesas_atualizado_em;

-- ── índice ────────────────────────────────────────────────────
-- Toda operação de grupo (reparcelar, excluir futuras) filtra por
-- esta coluna. Parcial porque a maioria das linhas é avulsa.
CREATE INDEX IF NOT EXISTS idx_despesas_grupo_parcelamento
  ON despesas (grupo_parcelamento)
  WHERE grupo_parcelamento IS NOT NULL;

COMMIT;
