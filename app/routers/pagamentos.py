"""
MX Seguros — DRE-IA | Pagamentos por CNAB 240 (migration 0050).

Fase 1: favorecidos (fornecedores e funcionários), contas pagadoras e o
bloco "Pagamento" da despesa.
Remessa e retorno entram nas fases seguintes.
"""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin
from app.models.pagamentos import (
    ContaPagadoraPayload, FavorecidoFuncionarioPayload, FornecedorPayload, PagamentoDespesaPayload,
)
from app.services import contas_pagadoras_service, folha_service, fornecedores_service, pagamento_despesa_service
from app.services.dre_service import registrar_auditoria

router = APIRouter(prefix="/pagamentos", tags=["Pagamentos"])
Usuario = Annotated[UsuarioAtual, Depends(obter_usuario_atual)]


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ── Favorecidos ───────────────────────────────────────────────
@router.get("/fornecedores", summary="Favorecidos (dados bancários mascarados conforme a permissão)")
async def listar_fornecedores(usuario: Usuario, inativos: bool = False, funcionarios: bool = True):
    # A busca de favorecido no lançamento usa esta lista (dados mascarados).
    return fornecedores_service.listar(usuario, get_supabase_admin(), incluir_inativos=inativos,
                                       incluir_funcionarios=funcionarios)


@router.get("/fornecedores/{fornecedor_id}", summary="Favorecido")
async def obter_fornecedor(fornecedor_id: UUID, usuario: Usuario):
    return fornecedores_service.obter(fornecedor_id, usuario, get_supabase_admin())


@router.post("/fornecedores", status_code=status.HTTP_201_CREATED, summary="Cadastrar favorecido")
async def criar_fornecedor(request: Request, payload: FornecedorPayload, usuario: Usuario):
    item = fornecedores_service.criar(payload, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "criar_fornecedor", {"fornecedor_id": str(item["id"]), "nome": item["nome"]},
                              _ip(request), get_supabase_admin())
    return item


@router.put("/fornecedores/{fornecedor_id}", summary="Atualizar favorecido")
async def atualizar_fornecedor(request: Request, fornecedor_id: UUID, payload: FornecedorPayload, usuario: Usuario):
    item = fornecedores_service.atualizar(fornecedor_id, payload, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "atualizar_fornecedor", {"fornecedor_id": str(fornecedor_id), "nome": item["nome"]},
                              _ip(request), get_supabase_admin())
    return item


@router.delete("/fornecedores/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir favorecido")
async def excluir_fornecedor(request: Request, fornecedor_id: UUID, usuario: Usuario):
    fornecedores_service.excluir(fornecedor_id, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "excluir_fornecedor", {"fornecedor_id": str(fornecedor_id)},
                              _ip(request), get_supabase_admin())


@router.get("/funcionarios/{funcionario_id}/favorecido", summary="Dados de pagamento do funcionário (Admin)")
async def obter_favorecido_funcionario(funcionario_id: UUID, usuario: Usuario):
    folha_service.exigir_admin(usuario)
    return fornecedores_service.do_funcionario(funcionario_id, usuario, get_supabase_admin())


@router.put("/funcionarios/{funcionario_id}/favorecido", summary="Salvar dados de pagamento do funcionário (Admin)")
async def salvar_favorecido_funcionario(request: Request, funcionario_id: UUID,
                                        payload: FavorecidoFuncionarioPayload, usuario: Usuario):
    folha_service.exigir_admin(usuario)
    item = fornecedores_service.salvar_do_funcionario(funcionario_id, payload, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "salvar_favorecido_funcionario", {"funcionario_id": str(funcionario_id)},
                              _ip(request), get_supabase_admin())
    return item


# ── Contas pagadoras ──────────────────────────────────────────
@router.get("/contas", summary="Contas pagadoras")
async def listar_contas(usuario: Usuario):
    return contas_pagadoras_service.listar(usuario, get_supabase_admin())


@router.post("/contas", status_code=status.HTTP_201_CREATED, summary="Cadastrar conta pagadora (Admin)")
async def criar_conta(request: Request, payload: ContaPagadoraPayload, usuario: Usuario):
    item = contas_pagadoras_service.criar(payload, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "criar_conta_pagadora",
                              {"conta_id": str(item["id"]), "banco": item["codigo_banco"], "ambiente": item["ambiente"]},
                              _ip(request), get_supabase_admin())
    return item


@router.put("/contas/{conta_id}", summary="Atualizar conta pagadora (Admin)")
async def atualizar_conta(request: Request, conta_id: UUID, payload: ContaPagadoraPayload, usuario: Usuario):
    item, mudancas = contas_pagadoras_service.atualizar(conta_id, payload, usuario, get_supabase_admin())
    if mudancas:
        await registrar_auditoria(usuario, "atualizar_conta_pagadora", {"conta_id": str(conta_id), "mudancas": mudancas},
                                  _ip(request), get_supabase_admin())
    return item


@router.delete("/contas/{conta_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Excluir conta pagadora (Admin)")
async def excluir_conta(request: Request, conta_id: UUID, usuario: Usuario):
    contas_pagadoras_service.excluir(conta_id, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "excluir_conta_pagadora", {"conta_id": str(conta_id)},
                              _ip(request), get_supabase_admin())


# ── Bloco "Pagamento" da despesa ──────────────────────────────
@router.get("/despesas/{despesa_id}", summary="Dados de pagamento da despesa")
async def obter_pagamento_despesa(despesa_id: UUID, usuario: Usuario):
    return pagamento_despesa_service.obter(despesa_id, usuario, get_supabase_admin())


@router.put("/despesas/{despesa_id}", summary="Salvar dados de pagamento da despesa")
async def salvar_pagamento_despesa(despesa_id: UUID, payload: PagamentoDespesaPayload, usuario: Usuario):
    return pagamento_despesa_service.salvar(despesa_id, payload, usuario, get_supabase_admin())


@router.post("/documento", summary="Lê linha digitável, código de barras ou Pix copia-e-cola")
async def interpretar_documento(payload: dict, usuario: Usuario):
    return pagamento_despesa_service.interpretar_documento(str(payload.get("texto") or ""))
