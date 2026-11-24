"""
MX Seguros — DRE-IA | Router: /anexos
Nota Fiscal, Boleto e comprovantes de despesas, receitas e ordens de compra.

Fluxo de envio (o arquivo não passa pela API — limite de 4,5 MB da Vercel):
  1. POST /anexos/upload-url  → URL assinada do Storage
  2. navegador envia o arquivo direto ao Storage
  3. POST /anexos             → registra o anexo no lançamento
"""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin
from app.middleware.rate_limit import limiter
from app.services import anexos_service as svc

router = APIRouter(prefix="/anexos", tags=["Anexos"])

Entidade = Literal["despesa", "receita", "ordem_compra"]
TipoDocumento = Literal["nota_fiscal", "boleto", "comprovante", "outro"]


class UploadUrlRequest(BaseModel):
    entidade:     Entidade
    entidade_id:  UUID
    nome_arquivo: str = Field(min_length=1, max_length=200)
    mime:         str | None = None
    tamanho:      int | None = None


class RegistrarAnexoRequest(UploadUrlRequest):
    path:           str = Field(min_length=1, max_length=500)
    tipo_documento: TipoDocumento = "outro"


class ContagemRequest(BaseModel):
    entidade: Entidade
    ids:      list[str] = Field(default_factory=list, max_length=5000)


def _rodar(fn, *args):
    """As chamadas do supabase-py são síncronas: fora do event loop."""
    import asyncio
    return asyncio.to_thread(fn, *args)


@router.post("/upload-url", summary="URL assinada para enviar um anexo ao Storage")
@limiter.limit("60/minute")
async def upload_url(
    request: Request,
    payload: UploadUrlRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return await _rodar(
        svc.gerar_upload, payload.entidade, payload.entidade_id, payload.nome_arquivo,
        payload.mime, payload.tamanho, usuario, get_supabase_admin(),
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Registra o anexo enviado")
@limiter.limit("60/minute")
async def registrar(
    request: Request,
    payload: RegistrarAnexoRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return await _rodar(
        svc.registrar, payload.entidade, payload.entidade_id, payload.path, payload.nome_arquivo,
        payload.mime, payload.tamanho, payload.tipo_documento, usuario, get_supabase_admin(),
    )


@router.get("", summary="Anexos de um lançamento")
@limiter.limit("120/minute")
async def listar(
    request: Request,
    entidade: Entidade = Query(...),
    entidade_id: UUID = Query(...),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return await _rodar(svc.listar, entidade, entidade_id, usuario, get_supabase_admin())


@router.post("/contagem", summary="Quantidade de anexos por lançamento (clipe nas listas)")
@limiter.limit("60/minute")
async def contagem(
    request: Request,
    payload: ContagemRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return await _rodar(svc.contagem, payload.entidade, payload.ids, usuario, get_supabase_admin())


@router.get("/{anexo_id}/url", summary="URL temporária (5 min) para abrir o anexo")
@limiter.limit("120/minute")
async def url(
    request: Request,
    anexo_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return {"url": await _rodar(svc.url_download, anexo_id, usuario, get_supabase_admin())}


@router.delete("/{anexo_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Exclui um anexo")
@limiter.limit("30/minute")
async def excluir(
    request: Request,
    anexo_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    await _rodar(svc.excluir, anexo_id, usuario, get_supabase_admin())
