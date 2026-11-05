"""MX Seguros — DRE-IA | Router: GET /dashboard (resposta agregada)"""
from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_usuario
from app.middleware.periodo import validar_base, validar_periodo
from app.middleware.rate_limit import limiter
from app.models.schemas import (
    DashboardAplicacoesResponse, DashboardEmprestimosResponse, DashboardPorBancoResponse, DashboardResponse,
    DespesasPorClassificacaoResponse,
    LancamentosDiaMesResponse,
)
from app.permissions import tem_permissao
from app.services import dashboard_detalhe_service, dashboard_service, dre_service, relatorio_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def exigir_lancamentos(usuario: UsuarioAtual) -> None:
    """A modal mostra lançamentos um a um, que os totais da tela não expõem: só
    para quem tem acesso à tela de Lançamentos."""
    if not tem_permissao(usuario.permissions or {}, "lancamentos", "visualizar"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seu usuário não tem acesso a Lançamentos.")


# ── Lançamentos por trás de cada valor da tela (05/11/2026) ───

@router.get("/detalhe", summary="Lançamentos que formam um valor da Visão Geral")
@limiter.limit("60/minute")
async def get_detalhe(
    request: Request,
    bloco: Annotated[str, Query(pattern=(
        "^(classificacao|saldo_inicial|box_emprestimo|box_aplicacao|box_banco|resultado"
        "|por_banco|emprestimos|aplicacoes|centro)$"
    ))],
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    banco: Annotated[str | None, Query(max_length=100)] = None,
    lado: Annotated[str | None, Query(pattern="^(receitas|despesas)$")] = None,
    subitem: Annotated[str | None, Query(max_length=200)] = None,
    classificacao: Annotated[str | None, Query(max_length=100)] = None,
    centro: Annotated[str | None, Query(max_length=100)] = None,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    exigir_lancamentos(usuario)
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    return await dashboard_detalhe_service.detalhe(
        bloco, inicio, fim, base, usuario, get_supabase_usuario(token),
        banco=banco, lado=lado, subitem=subitem, classificacao=classificacao, centro=centro,
    )


@router.get("/lancamento/{tipo}/{lancamento_id}", summary="Lançamento completo, para editar a partir da modal")
@limiter.limit("60/minute")
async def get_lancamento(
    request: Request,
    tipo: Annotated[str, Path(pattern="^(despesa|receita)$")],
    lancamento_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    # A rota equivalente de Relatórios exige a permissão de Relatórios.
    exigir_lancamentos(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    return await relatorio_service.obter_lancamento(tipo, lancamento_id, usuario, get_supabase_usuario(token))


@router.get("", response_model=DashboardResponse, summary="Dashboard agregado")
@limiter.limit("30/minute")
async def get_dashboard(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """
    Retorna DRE agregado com alertas.
    Campos visíveis variam conforme o perfil (§4.5 do SDD).
    """
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)

    resultado = await dashboard_service.buscar_dashboard(inicio, fim, usuario, db, base=base)

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
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_por_banco(inicio, fim, db, base=base)


# ── Box Empréstimos (23/10/2026) ──────────────────────────────

@router.get(
    "/emprestimos",
    response_model=DashboardEmprestimosResponse,
    summary="Receitas e despesas das categorias Empréstimo, por subitem",
)
@limiter.limit("30/minute")
async def get_emprestimos(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_emprestimos(inicio, fim, db, base=base)


@router.get(
    "/aplicacoes",
    response_model=DashboardAplicacoesResponse,
    summary="Receitas e despesas da categoria Aplicações, por banco",
)
@limiter.limit("30/minute")
async def get_aplicacoes(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_aplicacoes(inicio, fim, db, base=base)


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
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_despesas_por_classificacao(inicio, fim, db, base=base)


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
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_despesas_dia_mes(inicio, fim, db, base=base)


@router.get(
    "/receitas-dia-mes",
    response_model=LancamentosDiaMesResponse,
    summary="Receitas manuais do dia e do mês/período selecionado",
)
@limiter.limit("30/minute")
async def get_receitas_dia_mes(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dashboard_service.buscar_receitas_dia_mes(inicio, fim, db, base=base)


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
