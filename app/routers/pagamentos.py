"""
MX Seguros — DRE-IA | Pagamentos por CNAB 240 (migration 0050).

Fase 1: favorecidos (fornecedores e funcionários), contas pagadoras e o
bloco "Pagamento" da despesa.
Fase 2: contas a pagar e remessa (Santander V11.7). Retorno na fase 3.
"""
from __future__ import annotations

from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from app.auth import UsuarioAtual, obter_usuario_atual
from app.database import get_supabase_admin
from app.middleware.rate_limit import limiter
from app.models.pagamentos import (
    ContaPagadoraPayload, FavorecidoFuncionarioPayload, FornecedorPayload, PagamentoDespesaPayload,
)
from app.services import (
    contas_pagadoras_service, folha_service, fornecedores_service, pagamento_despesa_service, remessa_service,
)
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


# ── Contas a pagar e remessas (fase 2) ────────────────────────
class _RemessaPayload(BaseModel):
    conta_id: UUID
    data_pagamento: date
    despesa_ids: list[UUID] = Field(min_length=1, max_length=500)


@router.get("/a-pagar", summary="Despesas aprovadas a pagar e pagamentos em andamento")
async def listar_a_pagar(usuario: Usuario, situacao: str = "a_pagar", inicio: date | None = None, fim: date | None = None):
    return remessa_service.a_pagar(usuario, get_supabase_admin(), situacao, inicio, fim)


@router.get("/dia-util", summary="Confere se a data é dia útil bancário")
async def dia_util(data: date, usuario: Usuario):
    return remessa_service.dia_util(data)


@router.post("/remessas/validar", summary="Valida os pagamentos antes de gerar a remessa")
async def validar_remessa(payload: _RemessaPayload, usuario: Usuario):
    return remessa_service.validar(str(payload.conta_id), payload.data_pagamento,
                                   [str(i) for i in payload.despesa_ids], usuario, get_supabase_admin())


@router.post("/remessas", status_code=status.HTTP_201_CREATED, summary="Gera a remessa CNAB")
@limiter.limit("10/minute")
async def gerar_remessa(request: Request, payload: _RemessaPayload, usuario: Usuario):
    r = remessa_service.gerar(str(payload.conta_id), payload.data_pagamento,
                              [str(i) for i in payload.despesa_ids], usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "gerar_remessa_cnab",
                              {"remessa_id": str(r["id"]), "qtd": r["qtd_itens"], "valor_total": str(r["valor_total"]),
                               "nsa": [a["nsa"] for a in r["arquivos"]]}, _ip(request), get_supabase_admin())
    return r


@router.get("/remessas", summary="Remessas geradas")
async def listar_remessas(usuario: Usuario):
    return remessa_service.listar(usuario, get_supabase_admin())


@router.get("/remessas/{remessa_id}", summary="Detalhe da remessa")
async def detalhe_remessa(remessa_id: UUID, usuario: Usuario):
    return remessa_service.detalhe(remessa_id, usuario, get_supabase_admin())


@router.get("/remessas/{remessa_id}/arquivos/{arquivo_id}/download", summary="URL de download (5 min)")
async def baixar_arquivo(request: Request, remessa_id: UUID, arquivo_id: UUID, usuario: Usuario):
    r = remessa_service.url_arquivo(remessa_id, arquivo_id, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "baixar_remessa_cnab", {"remessa_id": str(remessa_id), "arquivo": r["nome"]},
                              _ip(request), get_supabase_admin())
    return r


@router.post("/remessas/{remessa_id}/enviada", summary="Marca a remessa como enviada ao banco")
async def marcar_enviada(request: Request, remessa_id: UUID, usuario: Usuario):
    r = remessa_service.marcar_enviada(remessa_id, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "remessa_enviada", {"remessa_id": str(remessa_id)}, _ip(request), get_supabase_admin())
    return r


@router.post("/remessas/{remessa_id}/cancelar", summary="Cancela a remessa e devolve as despesas para a pagar")
async def cancelar_remessa(request: Request, remessa_id: UUID, usuario: Usuario):
    r = remessa_service.cancelar(remessa_id, usuario, get_supabase_admin())
    await registrar_auditoria(usuario, "remessa_cancelada", {"remessa_id": str(remessa_id)}, _ip(request), get_supabase_admin())
    return r
