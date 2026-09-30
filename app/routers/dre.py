"""MX Seguros — DRE-IA | Router: /dre"""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_usuario
from app.middleware.rate_limit import limiter
from app.models.schemas import DREResponse, ReceitaRamoResponse, ReceitaTipoResponse
from app.services import dre_gerencial_service, dre_service
from app.services.dre_gerencial_service import SalvarOrcamentoRequest

router = APIRouter(prefix="/dre", tags=["DRE"])

_MAX_PERIODO_DIAS = 365


@router.get("", response_model=DREResponse, summary="DRE do período")
@limiter.limit("30/minute")
async def get_dre(
    request: Request,
    inicio: date = Query(..., description="Data início (YYYY-MM-DD)"),
    fim:    date = Query(..., description="Data fim (YYYY-MM-DD)"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """
    Retorna o DRE para o período informado.
    Os campos visíveis variam conforme o perfil do usuário (§4.5 do escopo).
    RLS no banco garante que os valores calculados já reflitam apenas
    os dados que o usuário tem permissão de ver.
    """
    if fim < inicio:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'fim' deve ser igual ou posterior a 'inicio'",
        )
    if (fim - inicio).days > _MAX_PERIODO_DIAS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Período máximo permitido: 12 meses (365 dias).",
        )

    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)

    resultado = await dre_service.buscar_dre(inicio, fim, usuario, db)

    # Auditoria (em background — leitura não espera o INSERT no audit_log)
    from app.database import get_supabase_admin
    await dre_service.auditar_leitura(
        usuario, "consulta_dre",
        {"inicio": str(inicio), "fim": str(fim)},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )

    return resultado


@router.get("/impostos", summary="Soma de despesas de impostos no período")
async def get_impostos_manuais(
    request: Request,
    inicio: date = Query(...),
    fim:    date = Query(...),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """Retorna a soma das despesas cujo tipo de lançamento contém 'imposto'."""
    if usuario.role not in ("admin", "gestor", "contador"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Impostos disponíveis apenas para Admin, Gestor e Contador.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)

    resp = (
        db.table("despesas")
        .select("valor, categoria, subitens_lancamento(nome)")
        .gte("competencia", inicio.isoformat())
        .lte("competencia", fim.isoformat())
        .neq("status", "excluida")
        .neq("status", "rejeitada")
        .execute()
    )
    from decimal import Decimal
    total = Decimal(0)
    for row in (resp.data or []):
        nome_tipo = ((row.get("subitens_lancamento") or {}).get("nome") or "").lower()
        if "imposto" in nome_tipo or "imposto" in (row.get("categoria") or "").lower():
            total += Decimal(str(row.get("valor", 0)))

    return {"total": float(total)}


@router.get("/ramos", response_model=ReceitaRamoResponse, summary="Receita por ramo")
async def get_receita_por_ramo(
    request: Request,
    inicio: date = Query(...),
    fim:    date = Query(...),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """
    Receita bruta detalhada por ramo de seguro no período.
    Disponível para Admin e Gestor (§4.5).
    """
    if usuario.role not in ("admin", "gestor", "contador"):
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Receita por ramo disponível apenas para Admin, Gestor e Contador.",
        )

    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dre_service.buscar_receita_por_ramo(inicio, fim, db, usuario.user_id)


@router.get("/tipos", response_model=ReceitaTipoResponse, summary="Receita por tipo de lançamento")
async def get_receita_por_tipo(
    request: Request,
    inicio: date = Query(...),
    fim:    date = Query(...),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """Receita manual agrupada por tipo de lançamento no período."""
    if usuario.role not in ("admin", "gestor", "contador"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Receita por tipo disponível apenas para Admin, Gestor e Contador.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dre_service.buscar_receita_por_tipo(inicio, fim, db)


@router.get("/evolucao", summary="Evolução mensal (receita, despesa, resultado)")
async def get_evolucao_mensal(
    request: Request,
    inicio: date = Query(...),
    fim:    date = Query(...),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """Receita, despesa e resultado agregados por mês do período."""
    if usuario.role not in ("admin", "gestor", "contador"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Evolução mensal disponível apenas para Admin, Gestor e Contador.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await dre_service.buscar_evolucao_mensal(inicio, fim, db)


# ── DRE Previsto x Realizado (PLANEJAMENTO_DRE.md) ─────────────
# As rotas acima (/dre, /dre/tipos, /dre/evolucao) seguem servindo o que já
# existia; a página nova usa só estas.

_ROLES_DRE = ("admin", "gestor", "contador")
_ROLES_METAS = ("admin", "gestor")


def _exigir_dre(usuario: UsuarioAtual) -> None:
    if usuario.role not in _ROLES_DRE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="DRE disponível apenas para Admin, Gestor e Contador.",
        )


@router.get("/previsto-realizado", summary="DRE Previsto x Realizado (mês, acumulado ou 12 meses)")
@limiter.limit("60/minute")
async def get_previsto_realizado(
    request: Request,
    ano: int = Query(..., ge=2000, le=2100),
    mes: int = Query(..., ge=1, le=12, description="Mês de referência"),
    visao: str = Query("mes", pattern="^(mes|acumulado|anual)$"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_dre(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    resultado = await dre_gerencial_service.buscar_previsto_realizado(ano, mes, visao, get_supabase_usuario(token))
    from app.database import get_supabase_admin
    await dre_service.auditar_leitura(
        usuario, "consulta_dre_previsto_realizado", {"ano": ano, "mes": mes, "visao": visao},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return resultado


@router.get("/orcamento", summary="Previsto (metas) do ano: contas por grupo × 12 meses")
async def get_orcamento(
    request: Request,
    ano: int = Query(..., ge=2000, le=2100),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_dre(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    return await dre_gerencial_service.buscar_orcamento(ano, get_supabase_usuario(token))


@router.put("/orcamento", summary="Grava metas em lote (upsert por conta e mês)")
@limiter.limit("30/minute")
async def put_orcamento(
    request: Request,
    payload: SalvarOrcamentoRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    if usuario.role not in _ROLES_METAS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Somente Admin e Gestor podem alterar as metas.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    resultado = await dre_gerencial_service.salvar_orcamento(payload, usuario, get_supabase_usuario(token))
    from app.database import get_supabase_admin
    from app.services.dre_service import registrar_auditoria
    await registrar_auditoria(
        usuario, "salvar_metas_dre", {"ano": payload.ano, "celulas": len(payload.itens)},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return resultado

