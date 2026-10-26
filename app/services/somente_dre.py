"""
MX Seguros — DRE-IA | Subitens de receita que constam apenas na DRE.

Regra de 22/10/2026 (Gabriel): o subitem marcado "Constar apenas na DRE"
(subitens_lancamento.somente_dre, migration 0037) faz as receitas dele
aparecerem SÓ na DRE — fora da Visão Geral (boxes, Por Banco, listas Hoje/mês)
e fora dos totais de Lançamentos, onde continuam listadas com a etiqueta
"Só DRE". A DRE (tela e função SQL) não muda: segue somando tudo.
"""
from __future__ import annotations

import logging

from supabase import Client

from app.database import executar_sem_bloquear as _exec

logger = logging.getLogger(__name__)


async def ids_somente_dre(db: Client) -> set[str]:
    """IDs dos subitens marcados. Sem a coluna (migration 0037 não rodada),
    devolve vazio: o sistema segue como antes em vez de quebrar."""
    try:
        resp = await _exec(db.table("subitens_lancamento").select("id").eq("somente_dre", True))
        return {r["id"] for r in (resp.data or [])}
    except Exception as e:  # noqa: BLE001
        logger.warning("somente_dre_indisponivel: %s", e)
        return set()


def sem_somente_dre(q, ids: set[str]):
    """Filtro PostgREST que tira as receitas desses subitens.

    `not.in` sozinho também descartaria as receitas SEM subitem (NULL NOT IN
    ... é NULL em SQL), por isso o `is.null` explícito."""
    if not ids:
        return q
    return q.or_(f"tipo_lancamento_id.is.null,tipo_lancamento_id.not.in.({','.join(sorted(ids))})")
