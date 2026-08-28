"""MX Seguros — DRE-IA | Router: /importacao (ETL via API — Task 3.5)"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin, get_supabase_usuario
from app.middleware.rate_limit import limiter
from app.services import dre_service, extrato_service
from app.services.etl_service import (
    LancamentoPreview, PreviewImportacao, ResultadoImportacao,
    efetivar_importacao, processar_preview,
)
from app.services.extrato_service import ConfirmarExtratoRequest
from app.services.sugestao_extrato_service import SugestaoLoteRequest, sugerir_lote

router = APIRouter(prefix="/importacao", tags=["ETL / Importação"])

_ROLES_IMPORTACAO = ("admin", "contador")
_ROLES_EXTRATO = ("admin", "gestor", "contador")
_MAX_ARQUIVO_MB = 10


def _exigir_importacao(usuario: UsuarioAtual) -> None:
    if usuario.role not in _ROLES_IMPORTACAO:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Importação restrita a Admin e Contador.",
        )


def _exigir_extrato(usuario: UsuarioAtual) -> None:
    if usuario.role not in _ROLES_EXTRATO:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Importação de extrato restrita a Admin, Gestor e Contador.",
        )


@router.post(
    "/balancete",
    response_model=PreviewImportacao,
    summary="Preview da importação de balancete Excel",
)
@limiter.limit("5/minute")
async def preview_balancete(
    request: Request,
    arquivo: UploadFile = File(..., description="Arquivo .xlsx do balancete"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """
    Recebe um arquivo Excel do balancete, classifica os lançamentos
    e retorna um preview sem gravar nada no banco.

    Fluxo:
    1. Upload aqui → visualizar preview
    2. Confirmar em POST /importacao/balancete/confirmar
    """
    _exigir_importacao(usuario)

    if not arquivo.filename or not arquivo.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Arquivo deve ser .xlsx ou .xls",
        )

    conteudo = await arquivo.read()
    if len(conteudo) > _MAX_ARQUIVO_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo muito grande. Máximo: {_MAX_ARQUIVO_MB}MB.",
        )

    try:
        preview = processar_preview(conteudo)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Falha ao ler arquivo Excel: {exc}",
        )

    await dre_service.registrar_auditoria(
        usuario, "preview_importacao",
        {"arquivo": arquivo.filename, "total_linhas": preview.total, "revisar": preview.revisar},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )

    return preview


@router.post(
    "/balancete/confirmar",
    response_model=ResultadoImportacao,
    summary="Efetivar importação do balancete",
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("3/minute")
async def confirmar_balancete(
    request: Request,
    payload: list[LancamentoPreview],
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """
    Recebe a lista de lançamentos do preview (com possíveis ajustes manuais)
    e os insere em batch no banco.

    Apenas lançamentos com `mapeado=True` e `tipo != 'revisar'` são gravados.
    """
    _exigir_importacao(usuario)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lista de lançamentos vazia.",
        )

    if len(payload) > 5000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Máximo de 5.000 lançamentos por importação.",
        )

    db_admin = get_supabase_admin()
    resultado = await efetivar_importacao(
        payload, usuario.user_id, db_admin, getattr(usuario, "tenant_id", None)
    )

    await dre_service.registrar_auditoria(
        usuario, "importacao_confirmada",
        {
            "total_importado": resultado.total_importado,
            "despesas": resultado.despesas,
            "receitas": resultado.receitas,
            "ignorados": resultado.ignorados,
            "erros": len(resultado.erros),
        },
        request.client.host if request.client else None,
        db_admin,
    )

    return resultado


# ── Extrato bancário (OFX / CSV Santander / TXT Itaú) ──────────

@router.post("/extrato", summary="Preview de extrato bancário (detecta banco + duplicatas)")
@limiter.limit("10/minute")
async def preview_extrato(
    request: Request,
    arquivo: UploadFile = File(..., description="Extrato .ofx, .csv ou .txt"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_extrato(usuario)
    if not arquivo.filename or not arquivo.filename.lower().endswith((".ofx", ".csv", ".txt")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Arquivo deve ser .ofx, .csv ou .txt",
        )
    conteudo = await arquivo.read()
    if len(conteudo) > _MAX_ARQUIVO_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo muito grande. Máximo: {_MAX_ARQUIVO_MB}MB.",
        )
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    try:
        preview = extrato_service.gerar_preview(conteudo, arquivo.filename, usuario, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Falha ao ler o extrato: {exc}")

    await dre_service.registrar_auditoria(
        usuario, "preview_extrato",
        {"arquivo": arquivo.filename, "banco": preview["banco"], "total": preview["resumo"]["total"]},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return preview


@router.post("/extrato/sugerir", summary="Sugerir subitem para cada linha do extrato (histórico + IA em lote)")
@limiter.limit("5/minute")
async def sugerir_extrato(
    request: Request,
    payload: SugestaoLoteRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    """Uma chamada para o extrato inteiro — o /lancamentos/sugestao unitário
    tem limite de 20/min, inviável linha a linha. Sugestão é acessória: se a
    IA falhar, devolve só o que o histórico resolveu e a importação segue."""
    _exigir_extrato(usuario)
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    return await sugerir_lote(payload, usuario, get_supabase_usuario(token))


@router.post("/extrato/confirmar", status_code=status.HTTP_201_CREATED, summary="Efetivar importação do extrato")
@limiter.limit("5/minute")
async def confirmar_extrato(
    request: Request,
    payload: ConfirmarExtratoRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_extrato(usuario)
    if not payload.itens:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nenhum item para importar.")
    if len(payload.itens) > 5000:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Máximo de 5.000 itens por importação.")

    db_admin = get_supabase_admin()
    resultado = await extrato_service.confirmar(payload, usuario, db_admin)
    await dre_service.registrar_auditoria(
        usuario, "extrato_confirmado",
        {"total": resultado["total_importado"], "despesas": resultado["despesas"], "receitas": resultado["receitas"]},
        request.client.host if request.client else None, db_admin,
    )
    return resultado
