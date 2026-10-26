"""
MX Seguros — DRE-IA | Router: /relatorios
Relatórios dinâmicos: dados planos para a tabela dinâmica, relatórios salvos
e exportação em Excel.
"""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin, get_supabase_usuario
from app.middleware.periodo import validar_base, validar_periodo
from app.middleware.rate_limit import limiter
from app.permissions import permissao_relatorios
from app.services import relatorio_service
from app.services.dre_service import auditar_leitura, registrar_auditoria

router = APIRouter(prefix="/relatorios", tags=["Relatórios"])

_ROLES = ("admin", "gestor", "contador", "comercial")
_MAX_CONFIG = 50_000   # bytes do JSON da configuração salva


def _exigir(usuario: UsuarioAtual, acao: str = "visualizar") -> None:
    if usuario.role not in _ROLES or not permissao_relatorios(usuario.role, usuario.permissions or {}, acao):
        detalhe = {
            "visualizar":   "Seu usuário não tem acesso a Relatórios.",
            "criar":        "Seu usuário não tem a permissão 'Salvar' em Relatórios.",
            "compartilhar": "Seu usuário não tem a permissão 'Compartilhar' em Relatórios.",
        }[acao]
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detalhe)


def _db(request: Request):
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    return get_supabase_usuario(token)


@router.get("/dados", summary="Lançamentos do período, planos, para a tabela dinâmica")
@limiter.limit("30/minute")
async def dados(
    request: Request,
    periodo: tuple[date, date] = Depends(validar_periodo),
    base: str = Depends(validar_base),
    fonte: str = Query("ambos", pattern="^(despesa|receita|ambos)$"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir(usuario)
    inicio, fim = periodo
    resultado = await relatorio_service.dados(inicio, fim, fonte, base, usuario, _db(request))
    await auditar_leitura(
        usuario, "consulta_relatorio",
        {"inicio": str(inicio), "fim": str(fim), "fonte": fonte},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return resultado


@router.get("/lancamento/{tipo}/{lancamento_id}", summary="Lançamento completo, para editar a partir do relatório")
@limiter.limit("60/minute")
async def lancamento(
    request: Request,
    tipo: Annotated[str, Path(pattern="^(despesa|receita)$")],
    lancamento_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir(usuario)
    return await relatorio_service.obter_lancamento(tipo, lancamento_id, usuario, _db(request))


# ── Relatórios salvos ─────────────────────────────────────────

def _validar_config(v: dict[str, Any]) -> dict[str, Any]:
    if len(json.dumps(v, ensure_ascii=False)) > _MAX_CONFIG:
        raise ValueError("Configuração grande demais.")
    for chave in ("linhas", "colunas", "valores", "filtros", "fonte"):
        if chave not in v:
            raise ValueError(f"Configuração sem '{chave}'.")
    return v


class RelatorioCreate(BaseModel):
    nome:          str = Field(min_length=1, max_length=120)
    config:        dict[str, Any]
    compartilhado: bool = False

    @field_validator("config")
    @classmethod
    def config_valida(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _validar_config(v)


class RelatorioUpdate(BaseModel):
    nome:          str | None = Field(default=None, min_length=1, max_length=120)
    config:        dict[str, Any] | None = None
    compartilhado: bool | None = None

    @field_validator("config")
    @classmethod
    def config_valida(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return v if v is None else _validar_config(v)


@router.get("", summary="Relatórios salvos: os meus e os compartilhados com a equipe")
@limiter.limit("60/minute")
async def listar(request: Request, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    _exigir(usuario)
    resultado = await relatorio_service.listar_salvos(usuario, _db(request))
    resultado["pode_criar"] = permissao_relatorios(usuario.role, usuario.permissions or {}, "criar")
    resultado["pode_compartilhar"] = permissao_relatorios(usuario.role, usuario.permissions or {}, "compartilhar")
    return resultado


@router.post("", status_code=status.HTTP_201_CREATED, summary="Salvar relatório")
@limiter.limit("30/minute")
async def criar(
    request: Request, payload: RelatorioCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir(usuario, "criar")
    if payload.compartilhado:
        _exigir(usuario, "compartilhar")
    return await relatorio_service.criar_salvo(payload.nome, payload.config, payload.compartilhado, usuario, _db(request))


@router.patch("/{relatorio_id}", summary="Renomear, atualizar ou compartilhar um relatório salvo")
@limiter.limit("30/minute")
async def atualizar(
    request: Request, relatorio_id: UUID, payload: RelatorioUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir(usuario, "criar")
    campos = payload.model_dump(exclude_none=True)
    if campos.get("compartilhado"):
        _exigir(usuario, "compartilhar")
    if not campos:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nada para atualizar.")
    return await relatorio_service.atualizar_salvo(relatorio_id, campos, usuario, _db(request))


@router.delete("/{relatorio_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir relatório salvo")
@limiter.limit("30/minute")
async def excluir(
    request: Request, relatorio_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir(usuario, "criar")
    await relatorio_service.excluir_salvo(relatorio_id, usuario, _db(request))


# ── Exportação ────────────────────────────────────────────────

class LinhaExportacao(BaseModel):
    rotulo:   str = Field(default="", max_length=500)
    nivel:    int = Field(default=0, ge=0, le=10)
    tipo:     str = Field(default="item", pattern="^(item|sub|tot)$")
    valores:  list[float | None] = Field(default_factory=list, max_length=1000)
    formatos: list[str] = Field(default_factory=list, max_length=1000)


class LancamentoExportacao(BaseModel):
    data:          str | None = Field(default=None, max_length=10)
    tipo:          str | None = Field(default=None, max_length=10)
    descricao:     str | None = Field(default=None, max_length=500)
    categoria:     str | None = Field(default=None, max_length=200)
    subitem:       str | None = Field(default=None, max_length=200)
    classificacao: str | None = Field(default=None, max_length=200)
    banco:         str | None = Field(default=None, max_length=200)
    centro:        str | None = Field(default=None, max_length=200)
    status:        str | None = Field(default=None, max_length=20)
    valor:         float | None = None


class ExportacaoRequest(BaseModel):
    titulo:      str = Field(min_length=1, max_length=200)
    subtitulo:   str = Field(default="", max_length=300)
    cabecalho:   list[str] = Field(min_length=1, max_length=1001)
    linhas:      list[LinhaExportacao] = Field(max_length=20_000)
    lancamentos: list[LancamentoExportacao] = Field(default_factory=list, max_length=20_000)


@router.post("/exportar", summary="Baixa a tabela dinâmica da tela em Excel (.xlsx)")
@limiter.limit("10/minute")
async def exportar(
    request: Request,
    payload: ExportacaoRequest,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir(usuario)
    xlsx = relatorio_service.gerar_excel(
        payload.titulo, payload.subtitulo, payload.cabecalho,
        [ln.model_dump() for ln in payload.linhas],
        [lc.model_dump() for lc in payload.lancamentos],
    )
    nome = re.sub(r"[^A-Za-z0-9_-]+", "_", payload.titulo).strip("_")[:60] or "relatorio"
    await registrar_auditoria(
        usuario, "export_relatorio_xlsx",
        {"titulo": payload.titulo, "linhas": len(payload.linhas), "lancamentos": len(payload.lancamentos)},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return StreamingResponse(
        xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nome}.xlsx"'},
    )
