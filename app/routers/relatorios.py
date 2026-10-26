"""
MX Seguros — DRE-IA | Router: /relatorios
Relatórios dinâmicos: dados planos para a tabela dinâmica e exportação em Excel.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin, get_supabase_usuario
from app.middleware.periodo import validar_base, validar_periodo
from app.middleware.rate_limit import limiter
from app.services import relatorio_service
from app.services.dre_service import auditar_leitura, registrar_auditoria

router = APIRouter(prefix="/relatorios", tags=["Relatórios"])

_ROLES = ("admin", "gestor", "contador", "comercial")


def _exigir_acesso(usuario: UsuarioAtual) -> None:
    if usuario.role not in _ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acesso não autorizado.")


@router.get("/dados", summary="Lançamentos do período, planos, para a tabela dinâmica")
@limiter.limit("30/minute")
async def dados(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    fonte: str = Query("ambos", pattern="^(despesa|receita|ambos)$"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_acesso(usuario)
    inicio, fim = periodo
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    resultado = await relatorio_service.dados(inicio, fim, fonte, base, usuario, db)
    await auditar_leitura(
        usuario, "consulta_relatorio",
        {"inicio": str(inicio), "fim": str(fim), "fonte": fonte},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return resultado


class LinhaExportacao(BaseModel):
    rotulo:   str = Field(default="", max_length=500)
    nivel:    int = Field(default=0, ge=0, le=10)
    tipo:     str = Field(default="item", pattern="^(item|sub|tot)$")
    valores:  list[float | None] = Field(default_factory=list, max_length=500)
    formatos: list[str] = Field(default_factory=list, max_length=500)


class ExportacaoRequest(BaseModel):
    titulo:    str = Field(min_length=1, max_length=200)
    subtitulo: str = Field(default="", max_length=300)
    cabecalho: list[str] = Field(min_length=1, max_length=501)
    linhas:    list[LinhaExportacao] = Field(max_length=20_000)


@router.post("/exportar", summary="Baixa a tabela dinâmica da tela em Excel (.xlsx)")
@limiter.limit("10/minute")
async def exportar(
    request: Request,
    payload: ExportacaoRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_acesso(usuario)
    xlsx = relatorio_service.gerar_excel(
        payload.titulo, payload.subtitulo, payload.cabecalho,
        [ln.model_dump() for ln in payload.linhas],
    )
    nome = re.sub(r"[^A-Za-z0-9_-]+", "_", payload.titulo).strip("_")[:60] or "relatorio"
    await registrar_auditoria(
        usuario, "export_relatorio_xlsx",
        {"titulo": payload.titulo, "linhas": len(payload.linhas)},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return StreamingResponse(
        xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nome}.xlsx"'},
    )
