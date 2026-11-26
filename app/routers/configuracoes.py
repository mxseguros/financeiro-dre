"""
MX Seguros — DRE-IA | Router: /configuracoes
Gerenciamento de parâmetros do sistema.
Leitura: todos autenticados.
Escrita/edição: exclusivo Admin.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin, get_supabase_usuario
from app.middleware.rate_limit import limiter
from app.models.schemas import (
    BancoCreate, BancoItem, BancoUpdate,
    CategoriaLancamentoCreate, CategoriaLancamentoItem, CategoriaLancamentoUpdate,
    CentroCustoCreate, CentroCustoItem, CentroCustoUpdate, CentroCustoMover,
    FuncionarioCreate, FuncionarioItem, FuncionarioUpdate,
    FolhaParametrosPayload, FolhaRubricasPayload, FolhaSimulacao, FuncionarioContrato,
    ClassificacaoCreate, ClassificacaoItem, ClassificacaoUpdate,
    TipoLancamentoCreate, TipoLancamentoItem, TipoLancamentoUpdate,
)
from app.services import classificacao_service, financeiro_service, folha_service, funcionarios_service, ia_chave_service
from app.services.dre_service import registrar_auditoria

router = APIRouter(prefix="/configuracoes", tags=["Configurações"])


def _exigir_admin(usuario: UsuarioAtual) -> None:
    if usuario.role not in ("admin", "gestor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas Admin ou Gestor pode alterar configurações.",
        )


def _exigir_admin_ou_gestor(usuario: UsuarioAtual) -> None:
    if usuario.role not in ("admin", "gestor"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas Admin ou Gestor pode gerenciar usuários.",
        )


# ── BANCOS ────────────────────────────────────────────────────

@router.get("/bancos", response_model=list[BancoItem], summary="Listar bancos")
async def listar_bancos(
    request: Request,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await financeiro_service.listar_bancos(db)


@router.post(
    "/bancos",
    response_model=BancoItem,
    status_code=status.HTTP_201_CREATED,
    summary="Criar banco (admin)",
)
async def criar_banco(
    request: Request,
    payload: BancoCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    db = get_supabase_admin()
    item = await financeiro_service.criar_banco(payload, db)
    await registrar_auditoria(
        usuario, "criar_banco", {"nome": payload.nome},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return item


@router.put(
    "/bancos/{banco_id}",
    response_model=BancoItem,
    summary="Atualizar banco (admin)",
)
async def atualizar_banco(
    request: Request,
    banco_id: UUID,
    payload: BancoUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    return await financeiro_service.atualizar_banco(banco_id, payload, get_supabase_admin())


@router.delete(
    "/bancos/{banco_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir banco (admin)",
)
async def excluir_banco(
    request: Request,
    banco_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    await financeiro_service.excluir_banco(banco_id, get_supabase_admin())


# ── CENTROS DE CUSTO ──────────────────────────────────────────

@router.get(
    "/centros-custo",
    response_model=list[CentroCustoItem],
    summary="Listar centros de custo",
)
async def listar_centros(
    request: Request,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await financeiro_service.listar_centros_custo(db)


@router.post(
    "/centros-custo",
    response_model=CentroCustoItem,
    status_code=status.HTTP_201_CREATED,
    summary="Criar centro de custo (admin)",
)
async def criar_centro(
    request: Request,
    payload: CentroCustoCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    db = get_supabase_admin()
    item = await financeiro_service.criar_centro_custo(payload, usuario, db)
    await registrar_auditoria(
        usuario, "criar_centro_custo", {"nome": payload.nome, "codigo": item.codigo},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return item


@router.put(
    "/centros-custo/{centro_id}",
    response_model=CentroCustoItem,
    summary="Atualizar centro de custo (admin)",
)
async def atualizar_centro(
    request: Request,
    centro_id: UUID,
    payload: CentroCustoUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    return await financeiro_service.atualizar_centro_custo(
        centro_id, payload, usuario, get_supabase_admin(),
    )


@router.post(
    "/centros-custo/{centro_id}/mover",
    response_model=CentroCustoItem,
    summary="Subir/descer o subgrupo uma posição (admin)",
)
async def mover_centro(
    centro_id: UUID,
    payload: CentroCustoMover,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    return await financeiro_service.mover_centro(centro_id, payload.direcao, usuario, get_supabase_admin())


@router.delete(
    "/centros-custo/{centro_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir centro de custo (admin)",
)
async def excluir_centro(
    request: Request,
    centro_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    await financeiro_service.excluir_centro_custo(centro_id, usuario, get_supabase_admin())


# ── FUNCIONÁRIOS (0048) ───────────────────────────────────────
# Lista do "Quem é você?" no link /oc. Colaborador lê só os ativos.

@router.get(
    "/funcionarios",
    response_model=list[FuncionarioItem],
    summary="Listar funcionários",
)
async def listar_funcionarios(
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return funcionarios_service.listar(
        usuario, get_supabase_admin(), so_ativos=usuario.role not in ("admin", "gestor", "super_admin"),
    )


@router.post(
    "/funcionarios",
    response_model=FuncionarioItem,
    status_code=status.HTTP_201_CREATED,
    summary="Cadastrar funcionário (admin/gestor)",
)
async def criar_funcionario(
    request: Request,
    payload: FuncionarioCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    item = funcionarios_service.criar(payload, usuario, get_supabase_admin())
    await registrar_auditoria(
        usuario, "criar_funcionario", {"funcionario_id": str(item.id), "nome": item.nome},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return item


@router.put(
    "/funcionarios/{funcionario_id}",
    response_model=FuncionarioItem,
    summary="Atualizar funcionário (admin/gestor)",
)
async def atualizar_funcionario(
    funcionario_id: UUID,
    payload: FuncionarioUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    return funcionarios_service.atualizar(funcionario_id, payload, usuario, get_supabase_admin())


@router.delete(
    "/funcionarios/{funcionario_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir funcionário (admin/gestor)",
)
async def excluir_funcionario(
    request: Request,
    funcionario_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    funcionarios_service.excluir(funcionario_id, usuario, get_supabase_admin())
    await registrar_auditoria(
        usuario, "excluir_funcionario", {"funcionario_id": str(funcionario_id)},
        request.client.host if request.client else None, get_supabase_admin(),
    )


# ── FOLHA CLT (0049) — só Admin ───────────────────────────────
# Contrato e salário do funcionário, simulação do mês, tabelas e mapeamento.

@router.get("/funcionarios/custos", summary="Custo do mês por funcionário e centro (Admin)")
async def custos_funcionarios(usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    return folha_service.custos(usuario, get_supabase_admin())


@router.get("/funcionarios/{funcionario_id}/contrato", summary="Contrato e salário (Admin)")
async def obter_contrato(
    funcionario_id: UUID, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return folha_service.obter_contrato(funcionario_id, usuario, get_supabase_admin())


@router.put("/funcionarios/{funcionario_id}/contrato", summary="Salvar contrato e salário (Admin)")
async def salvar_contrato(
    request: Request,
    funcionario_id: UUID,
    payload: FuncionarioContrato,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    item = folha_service.salvar_contrato(funcionario_id, payload.model_dump(), usuario, get_supabase_admin())
    # Auditoria sem valores: salário é confidencial.
    await registrar_auditoria(
        usuario, "salvar_contrato_funcionario", {"funcionario_id": str(funcionario_id)},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return item


@router.post("/folha/simular", summary="Calcula o mês de um contrato (Admin)")
async def simular_folha(payload: FolhaSimulacao, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    return folha_service.simular(payload.contrato.model_dump(), usuario, get_supabase_admin(),
                                 ano=payload.ano, variaveis=payload.variaveis)


@router.get("/folha/parametros", summary="Tabelas da folha do ano (Admin)")
async def obter_parametros_folha(
    ano: int = Query(default=None), usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    from datetime import date as _date
    folha_service.exigir_admin(usuario)
    return folha_service.parametros(ano or _date.today().year, usuario, get_supabase_admin())


@router.put("/folha/parametros", summary="Salvar tabelas da folha (Admin)")
async def salvar_parametros_folha(
    request: Request, payload: FolhaParametrosPayload,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    item = folha_service.salvar_parametros(payload.ano, payload.dados, payload.conferido, usuario, get_supabase_admin())
    await registrar_auditoria(
        usuario, "salvar_parametros_folha", {"ano": payload.ano, "conferido": payload.conferido},
        request.client.host if request.client else None, get_supabase_admin(),
    )
    return item


@router.get("/folha/rubricas", summary="Rubrica da folha → subitem (Admin)")
async def obter_rubricas_folha(usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    folha_service.exigir_admin(usuario)
    return folha_service.rubricas(usuario, get_supabase_admin())


@router.put("/folha/rubricas", summary="Salvar rubrica → subitem (Admin)")
async def salvar_rubricas_folha(
    payload: FolhaRubricasPayload, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    return folha_service.salvar_rubricas(payload.mapa, usuario, get_supabase_admin())


# ── CATEGORIAS DE LANÇAMENTO ──────────────────────────────────

@router.get(
    "/categorias",
    response_model=list[CategoriaLancamentoItem],
    summary="Listar categorias de lançamento",
)
async def listar_categorias(
    request: Request,
    natureza: str | None = Query(None, description="'despesa' ou 'receita'"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await financeiro_service.listar_categorias_lancamento(db, natureza)


@router.post(
    "/categorias",
    response_model=CategoriaLancamentoItem,
    status_code=status.HTTP_201_CREATED,
    summary="Criar categoria de lançamento (admin)",
)
async def criar_categoria(
    request: Request,
    payload: CategoriaLancamentoCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    db = get_supabase_admin()
    item = await financeiro_service.criar_categoria_lancamento(payload, usuario, db)
    await registrar_auditoria(
        usuario, "criar_categoria_lancamento", {"nome": payload.nome},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return item


@router.put(
    "/categorias/{categoria_id}",
    response_model=CategoriaLancamentoItem,
    summary="Atualizar categoria de lançamento (admin)",
)
async def atualizar_categoria(
    request: Request,
    categoria_id: UUID,
    payload: CategoriaLancamentoUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    return await financeiro_service.atualizar_categoria_lancamento(
        categoria_id, payload, get_supabase_admin()
    )


@router.delete(
    "/categorias/{categoria_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir categoria de lançamento (admin)",
)
async def excluir_categoria(
    request: Request,
    categoria_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    await financeiro_service.excluir_categoria_lancamento(categoria_id, get_supabase_admin())


# ── CLASSIFICAÇÕES (campo Classificação dos subitens) ─────────

@router.get("/classificacoes", response_model=list[ClassificacaoItem], summary="Listar classificações")
async def listar_classificacoes(
    request: Request,
    natureza: str | None = Query(None, description="'despesa' ou 'receita' (inclui as de 'ambas')"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    return classificacao_service.listar(get_supabase_usuario(token), natureza)


@router.post("/classificacoes", response_model=ClassificacaoItem, status_code=status.HTTP_201_CREATED,
             summary="Criar classificação (admin)")
async def criar_classificacao(
    request: Request,
    payload: ClassificacaoCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    item = classificacao_service.criar(payload.nome, payload.natureza, payload.ordem, usuario, get_supabase_admin(),
                                        payload.usada_dre)
    await registrar_auditoria(usuario, "criar_classificacao", {"nome": payload.nome},
                              request.client.host if request.client else None, get_supabase_admin())
    return item


@router.put("/classificacoes/{codigo}", response_model=ClassificacaoItem, summary="Atualizar classificação (admin)")
async def atualizar_classificacao(
    request: Request,
    codigo: str,
    payload: ClassificacaoUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    return classificacao_service.atualizar(codigo, payload.model_dump(exclude_none=True), get_supabase_admin())


@router.delete("/classificacoes/{codigo}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir classificação (admin)")
async def excluir_classificacao(
    request: Request,
    codigo: str,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    classificacao_service.excluir(codigo, get_supabase_admin())


# ── TIPOS DE LANÇAMENTO ───────────────────────────────────────

@router.get(
    "/tipos",
    response_model=list[TipoLancamentoItem],
    summary="Listar tipos de lançamento",
)
async def listar_tipos(
    request: Request,
    natureza: str | None = Query(None, description="'despesa' ou 'receita'"),
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    db = get_supabase_usuario(token)
    return await financeiro_service.listar_tipos_lancamento(db, natureza)


@router.post(
    "/tipos",
    response_model=TipoLancamentoItem,
    status_code=status.HTTP_201_CREATED,
    summary="Criar tipo de lançamento (admin)",
)
async def criar_tipo(
    request: Request,
    payload: TipoLancamentoCreate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    if payload.natureza not in ("despesa", "receita"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'natureza' deve ser 'despesa' ou 'receita'.",
        )
    db = get_supabase_admin()
    item = await financeiro_service.criar_tipo_lancamento(payload, usuario, db)
    await registrar_auditoria(
        usuario, "criar_tipo_lancamento", {"nome": payload.nome},
        request.client.host if request.client else None,
        get_supabase_admin(),
    )
    return item


@router.put(
    "/tipos/{tipo_id}",
    response_model=TipoLancamentoItem,
    summary="Atualizar tipo de lançamento (admin)",
)
async def atualizar_tipo(
    request: Request,
    tipo_id: UUID,
    payload: TipoLancamentoUpdate,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    if payload.confidencial is not None and usuario.role not in ("admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Só o Admin define quais subitens são confidenciais.",
        )
    item = await financeiro_service.atualizar_tipo_lancamento(tipo_id, payload, get_supabase_admin())
    if payload.confidencial is not None:
        await registrar_auditoria(
            usuario, "subitem_confidencial", {"subitem_id": str(tipo_id), "confidencial": payload.confidencial},
            request.client.host if request.client else None, get_supabase_admin(),
        )
    return item


@router.delete(
    "/tipos/{tipo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Excluir tipo de lançamento (admin)",
)
async def excluir_tipo(
    request: Request,
    tipo_id: UUID,
    usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    _exigir_admin(usuario)
    await financeiro_service.excluir_tipo_lancamento(tipo_id, get_supabase_admin())


# ── ASSISTENTE DE IA — chave da Anthropic (só Admin) ─────────
# A chave nunca volta na resposta: só a máscara. Auditoria leva só a máscara.
class ChaveIAPayload(BaseModel):
    chave: str = Field(min_length=20, max_length=400)


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/ia", summary="Situação da chave da IA (Admin)")
async def obter_chave_ia(usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    return ia_chave_service.situacao(usuario, get_supabase_admin())


@router.put("/ia", summary="Cadastrar/trocar a chave da IA (Admin)")
@limiter.limit("10/minute")
async def salvar_chave_ia(
    request: Request, payload: ChaveIAPayload, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None,
):
    item = ia_chave_service.salvar(payload.chave, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "salvar_chave_ia", {"mascara": item.get("mascara")}, _ip(request),
                              get_supabase_admin())
    return item


@router.post("/ia/testar", summary="Testar a chave da IA em uso (Admin)")
@limiter.limit("10/minute")
async def testar_chave_ia(request: Request, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    return ia_chave_service.testar_atual(usuario)


@router.delete("/ia", summary="Remover a chave da IA (Admin)")
async def remover_chave_ia(request: Request, usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)] = None):
    item = ia_chave_service.remover(usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "remover_chave_ia", {}, _ip(request), get_supabase_admin())
    return item
