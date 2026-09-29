"""
MX Seguros — DRE-IA | Router: /ordens-compra
CRUD de Ordens de Compra + fluxo de aprovação (espelha /lancamentos).
"""
from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from app.regras_lancamento import garantir_exclusao_propria, pode_excluir_qualquer
from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin, get_supabase_usuario
from app.middleware.periodo import validar_periodo
from app.middleware.rate_limit import limiter
from app.models.schemas import (
    DespesaAprovacaoRejeicao, OrdemCompraCreate, OrdemCompraItem,
    OrdemCompraUpdate, OrdensCompraResponse,
)
from app.services import ordens_compra_service
from app.services.dre_service import auditar_leitura, registrar_auditoria

router = APIRouter(prefix="/ordens-compra", tags=["Ordens de Compra"])

_ROLES_LEITURA   = ("admin", "contador", "gestor", "comercial")
_ROLES_ESCRITA   = ("admin", "contador", "gestor", "comercial")
_ROLES_APROVACAO = ("admin", "gestor")


def _exigir_leitura(usuario: UsuarioAtual) -> None:
    if usuario.role not in _ROLES_LEITURA:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso não autorizado.")


def _exigir_aprovacao(usuario: UsuarioAtual) -> None:
    from app.permissions import tem_permissao
    if usuario.role not in _ROLES_APROVACAO:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas Admin e Gestor podem aprovar ou rejeitar ordens de compra.",
        )
    if not tem_permissao(usuario.permissions, "aprovacoes", "aprovar"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seu usuário não tem a permissão 'Aprovar' em Aprovações.",
        )


class DuplicataOrdemRequest(BaseModel):
    assunto: str
    valor: float | None = None


@router.post("/checar-duplicata", summary="Verifica ordem de compra duplicada (mesmo assunto + valor recente)")
@limiter.limit("30/minute")
async def checar_duplicata(
    request: Request,
    payload: DuplicataOrdemRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    if usuario.role not in _ROLES_ESCRITA:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão.")
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    from app.services import copiloto_service
    return {"duplicata": copiloto_service.checar_duplicata_ordem(payload.assunto, payload.valor, usuario, db)}


@router.get("", response_model=OrdensCompraResponse, summary="Lista ordens de compra do período")
@limiter.limit("30/minute")
async def listar_ordens(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    status_filter: str | None = Query(None, alias="status", description="pendente | aprovada | rejeitada"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    inicio, fim = periodo
    _exigir_leitura(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    resultado = await ordens_compra_service.buscar_ordens_compra(inicio, fim, usuario, db, status_filter)
    await auditar_leitura(
        usuario, "consulta_ordens_compra",
        {"inicio": str(inicio), "fim": str(fim)},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return resultado


@router.post("", response_model=OrdemCompraItem, status_code=status.HTTP_201_CREATED, summary="Criar ordem de compra")
async def criar_ordem(
    request: Request,
    payload: OrdemCompraCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    if usuario.role not in _ROLES_ESCRITA:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão para criar ordens de compra.")
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    item = await ordens_compra_service.criar_ordem_compra(payload, usuario, db)
    await registrar_auditoria(
        usuario, "criar_ordem_compra",
        {"assunto": payload.assunto, "solicitante": payload.solicitante},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return item


@router.patch("/{ordem_id}", response_model=OrdemCompraItem, summary="Editar ordem de compra")
async def editar_ordem(
    request: Request,
    ordem_id: UUID,
    payload: OrdemCompraUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_leitura(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    item = await ordens_compra_service.atualizar_ordem_compra(ordem_id, payload, db)
    await registrar_auditoria(
        usuario, "editar_ordem_compra", {"ordem_id": str(ordem_id)},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return item


@router.patch("/{ordem_id}/aprovar", response_model=OrdemCompraItem, summary="Aprovar ordem de compra")
async def aprovar_ordem(
    request: Request,
    ordem_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_aprovacao(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    item = await ordens_compra_service.aprovar_ordem_compra(ordem_id, usuario, db)
    await registrar_auditoria(
        usuario, "aprovar_ordem_compra", {"ordem_id": str(ordem_id)},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return item


@router.patch("/{ordem_id}/rejeitar", response_model=OrdemCompraItem, summary="Rejeitar ordem de compra")
async def rejeitar_ordem(
    request: Request,
    ordem_id: UUID,
    payload: DespesaAprovacaoRejeicao,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_aprovacao(usuario)
    if not payload.motivo:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Justificativa é obrigatória para rejeição.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    item = await ordens_compra_service.rejeitar_ordem_compra(ordem_id, payload.motivo, usuario, db)
    await registrar_auditoria(
        usuario, "rejeitar_ordem_compra", {"ordem_id": str(ordem_id), "motivo": payload.motivo},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return item


@router.delete("/{ordem_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir ordem de compra (soft-delete)")
async def deletar_ordem(
    request: Request,
    ordem_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_leitura(usuario)
    db_admin = get_supabase_admin()
    # Admin/gestor excluem qualquer ordem; os demais, a própria antes da
    # aprovação (ver app/regras_lancamento.py).
    if not pode_excluir_qualquer(usuario):
        garantir_exclusao_propria("ordens_compra", ordem_id, usuario, db_admin)
    await ordens_compra_service.deletar_ordem_compra(ordem_id, db_admin)
    await registrar_auditoria(
        usuario, "deletar_ordem_compra", {"ordem_id": str(ordem_id)},
        request.client.host if request.client else None, db_admin,
    )
