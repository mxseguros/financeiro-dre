"""
MX Seguros — DRE-IA | Serviço de Ordens de Compra.

Espelha o padrão de despesas (financeiro_service): soft-delete via
status='excluida', criado_por/tenant_id injetados pelo backend,
visibilidade por role, aprovar/rejeitar. data_solicitacao é sempre a
data do servidor (o cliente não envia esse campo).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.database import executar_sem_bloquear as _exec
from app.models.schemas import (
    OrdemCompraCreate, OrdemCompraItem, OrdemCompraUpdate, OrdensCompraResponse,
)

_COLS = (
    "id, solicitante, assunto, descricao, valor, data_solicitacao, status, "
    "criado_por, aprovado_por, aprovado_em, rejeitado_motivo, criado_em"
)


def _dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal(0)


def _row_para_item(row: dict) -> OrdemCompraItem:
    return OrdemCompraItem(
        id=row["id"],
        solicitante=row["solicitante"],
        assunto=row["assunto"],
        descricao=row["descricao"],
        valor=Decimal(str(row["valor"])) if row.get("valor") is not None else None,
        data_solicitacao=row["data_solicitacao"],
        status=row.get("status", "pendente"),
        criado_por=row.get("criado_por"),
        aprovado_por=row.get("aprovado_por"),
        aprovado_em=row.get("aprovado_em"),
        rejeitado_motivo=row.get("rejeitado_motivo"),
        criado_em=row.get("criado_em"),
    )


async def buscar_ordens_compra(
    inicio: date,
    fim: date,
    usuario: UsuarioAtual,
    db: Client,
    status_filter: str | None = None,
) -> OrdensCompraResponse:
    q = (
        db.table("ordens_compra")
        .select(_COLS)
        .neq("status", "excluida")
        .gte("data_solicitacao", inicio.isoformat())
        .lte("data_solicitacao", fim.isoformat())
    )
    # Comercial vê apenas as próprias; admin/gestor/contador veem tudo.
    if usuario.role == "comercial":
        q = q.eq("criado_por", usuario.user_id)
    if status_filter:
        q = q.eq("status", status_filter)
    resp = q.order("data_solicitacao", desc=True).execute()

    items = [_row_para_item(r) for r in (resp.data or [])]
    soma = sum((i.valor for i in items if i.valor is not None), Decimal(0))
    pendentes = sum(1 for i in items if i.status == "pendente")
    return OrdensCompraResponse(
        total=len(items), items=items, soma_total=soma, total_pendentes=pendentes,
    )


async def criar_ordem_compra(
    payload: OrdemCompraCreate,
    usuario: UsuarioAtual,
    db: Client,
) -> OrdemCompraItem:
    dados: dict = {
        "solicitante":      payload.solicitante,
        "assunto":          payload.assunto,
        "descricao":        payload.descricao,
        "data_solicitacao": date.today().isoformat(),   # server-controlled
        "status":           "pendente",
        "criado_por":       usuario.user_id,
    }
    if payload.valor is not None:
        dados["valor"] = str(payload.valor)
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id

    resp = db.table("ordens_compra").insert(dados).execute()
    return _row_para_item(resp.data[0])


async def atualizar_ordem_compra(
    ordem_id: UUID, payload: OrdemCompraUpdate, db: Client
) -> OrdemCompraItem:
    campos: dict = {}
    set_fields = payload.model_fields_set
    if "solicitante" in set_fields and payload.solicitante:
        campos["solicitante"] = payload.solicitante
    if "assunto" in set_fields and payload.assunto:
        campos["assunto"] = payload.assunto
    if "descricao" in set_fields and payload.descricao:
        campos["descricao"] = payload.descricao
    if "valor" in set_fields:
        campos["valor"] = str(payload.valor) if payload.valor is not None else None
    campos["atualizado_em"] = datetime.now(timezone.utc).isoformat()

    resp = (
        db.table("ordens_compra")
        .update(campos)
        .eq("id", str(ordem_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de compra não encontrada.")
    return _row_para_item(resp.data[0])


async def aprovar_ordem_compra(ordem_id: UUID, usuario: UsuarioAtual, db: Client) -> OrdemCompraItem:
    resp = (
        db.table("ordens_compra")
        .update({
            "status":        "aprovada",
            "aprovado_por":  usuario.user_id,
            "aprovado_em":   datetime.now(timezone.utc).isoformat(),
            "atualizado_em": datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", str(ordem_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de compra não encontrada.")
    return _row_para_item(resp.data[0])


async def rejeitar_ordem_compra(
    ordem_id: UUID, motivo: str, usuario: UsuarioAtual, db: Client
) -> OrdemCompraItem:
    resp = (
        db.table("ordens_compra")
        .update({
            "status":           "rejeitada",
            "aprovado_por":     usuario.user_id,
            "rejeitado_motivo": motivo,
            "atualizado_em":    datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", str(ordem_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de compra não encontrada.")
    return _row_para_item(resp.data[0])


async def deletar_ordem_compra(ordem_id: UUID, db: Client) -> None:
    db.table("ordens_compra").update({"status": "excluida"}).eq("id", str(ordem_id)).execute()


# ── Dashboard: listas dia/mês (mesmo shape de despesas-dia-mes) ─

async def buscar_ordens_dia_mes(inicio: date, fim: date, db: Client):
    from app.models.schemas import LancamentoResumoItem, LancamentosDiaMesResponse
    from app.services.dashboard_service import _janela_hoje_br

    hoje, cri_ini, cri_fim = _janela_hoje_br()
    cols = "id, solicitante, assunto, valor, data_solicitacao, status, criado_em"

    # 3 consultas independentes em paralelo, fora do event loop (ver
    # executar_sem_bloquear em app/database.py).
    resp_hoje, resp_criado_hoje, resp_mes = await asyncio.gather(
        _exec(
            db.table("ordens_compra").select(cols)
            .neq("status", "excluida").eq("data_solicitacao", hoje.isoformat())
        ),
        _exec(
            db.table("ordens_compra").select(cols)
            .neq("status", "excluida")
            .gte("criado_em", cri_ini).lt("criado_em", cri_fim)
            .order("criado_em", desc=True).limit(8)
        ),
        _exec(
            db.table("ordens_compra").select(cols)
            .neq("status", "excluida")
            .gte("data_solicitacao", inicio.isoformat())
            .lte("data_solicitacao", fim.isoformat())
            .order("data_solicitacao", desc=True)
            .limit(8)
        ),
    )

    def _mapear(rows: list[dict]) -> list:
        itens = []
        for row in rows:
            itens.append(LancamentoResumoItem(
                id=row["id"],
                descricao=row.get("assunto", ""),
                tipo_nome=row.get("solicitante"),
                valor=_dec(row.get("valor")),
                data=row.get("data_solicitacao"),
                status=row.get("status"),
            ))
        return itens

    dia = {r["id"]: r for r in (resp_hoje.data or [])}
    for r in (resp_criado_hoje.data or []):
        dia[r["id"]] = r
    return LancamentosDiaMesResponse(dia=_mapear(list(dia.values())), mes=_mapear(resp_mes.data or []))
