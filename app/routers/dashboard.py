"""MX Seguros — DRE-IA | Router: GET /dashboard (resposta agregada)"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_usuario
from app.middleware.periodo import validar_periodo
from app.middleware.rate_limit import limiter
from app.models.schemas import (
    DashboardPorBancoResponse, DashboardResponse, DespesasPorClassificacaoResponse,
    LancamentosDiaMesResponse,
)
from app.services import dashboard_service, dre_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardResponse, summary="Dashboard agregado")
@limiter.limit("30/minute")
async def get_dashboard(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """
    Retorna DRE agregado com alertas.
    Campos visíveis variam conforme o perfil (§4.5 do SDD).
    """
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)

    resultado = await dashboard_service.buscar_dashboard(inicio, fim, usuario, db)

    await dre_service.auditar_leitura(
        usuario, "consulta_dashboard",
        {"inicio": str(inicio), "fim": str(fim), "latencia_ms": resultado.latencia_ms},
        request.client.host if request.client else None,
        __import__("app.database", fromlist=["get_supabase_admin"]).get_supabase_admin(),
    )

    return resultado


# ── Épico 4 — Receita/despesa por banco ───────────────────────

@router.get(
    "/por-banco",
    response_model=DashboardPorBancoResponse,
    summary="Receitas e despesas do período agregadas por banco",
)
@limiter.limit("30/minute")
async def get_por_banco(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_por_banco(inicio, fim, db)


# ── Épico 4 — Despesas por classificação (fixa/variável) ──────

@router.get(
    "/despesas-por-classificacao",
    response_model=DespesasPorClassificacaoResponse,
    summary="Despesas do período agrupadas por classificação fixa/variável",
)
@limiter.limit("30/minute")
async def get_despesas_por_classificacao(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_despesas_por_classificacao(inicio, fim, db)


# ── Épico 4 — Listas diária/mensal ─────────────────────────────

@router.get(
    "/despesas-dia-mes",
    response_model=LancamentosDiaMesResponse,
    summary="Despesas do dia e do mês/período selecionado",
)
@limiter.limit("30/minute")
async def get_despesas_dia_mes(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_despesas_dia_mes(inicio, fim, db)


@router.get(
    "/receitas-dia-mes",
    response_model=LancamentosDiaMesResponse,
    summary="Receitas manuais do dia e do mês/período selecionado",
)
@limiter.limit("30/minute")
async def get_receitas_dia_mes(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_receitas_dia_mes(inicio, fim, db)


@router.get(
    "/ordens-compra-dia-mes",
    response_model=LancamentosDiaMesResponse,
    summary="Ordens de compra do dia e do mês/período selecionado",
)
@limiter.limit("30/minute")
async def get_ordens_compra_dia_mes(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    from app.services import ordens_compra_service
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await ordens_compra_service.buscar_ordens_dia_mes(inicio, fim, db)
