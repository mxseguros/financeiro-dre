"""
MX Seguros — DRE-IA | Router: /monitor
Insights determinísticos sobre os apontamentos (Monitor). Somente leitura.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_usuario
from app.middleware.rate_limit import limiter
from app.services import monitor_service

router = APIRouter(prefix="/monitor", tags=["Monitor"])

_ROLES_MONITOR = ("admin", "gestor", "contador")


@router.get("/insights", summary="Insights determinísticos sobre os apontamentos")
@limiter.limit("30/minute")
async def insights(
    request: Request,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    if usuario.role not in _ROLES_MONITOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Monitor disponível para Admin, Gestor e Contador.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await monitor_service.gerar_insights(usuario, db)


@router.get("/resumo", summary="Resumo executivo dos insights, priorizado por IA")
@limiter.limit("10/minute")
async def resumo(
    request: Request,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    if usuario.role not in _ROLES_MONITOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Monitor disponível para Admin, Gestor e Contador.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    payload = await monitor_service.gerar_insights(usuario, db)
    return monitor_service.gerar_resumo_ia(payload)
