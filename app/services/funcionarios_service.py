"""
MX Seguros — DRE-IA | Funcionários (migration 0048, 24/11/2026).

Cadastro simples em Configurações → Funcionários: nome completo e centro de
custo. É a lista do "Quem é você?" no link /oc — a Ordem de Compra passa a
ser do funcionário (solicitante e centro vêm daqui).

A tabela tem RLS sem policies: todo acesso passa por aqui, com o client
admin e o tenant do usuário sempre no filtro.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.models.schemas import FuncionarioCreate, FuncionarioItem, FuncionarioUpdate

_COLS = "id, nome, centro_custo, ativo"


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _sem_tabela(e: Exception) -> bool:
    s = str(e).lower()
    return "funcionarios" in s and ("does not exist" in s or "schema cache" in s or "42p01" in s)


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _q(db: Client, usuario: UsuarioAtual, q):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def listar(usuario: UsuarioAtual, db: Client, so_ativos: bool = False) -> list[FuncionarioItem]:
    try:
        q = _q(db, usuario, db.table("funcionarios").select(_COLS))
        if so_ativos:
            q = q.eq("ativo", True)
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001 — sem a 0048: lista vazia
        if _sem_tabela(e):
            return []
        raise
    linhas.sort(key=lambda r: (not r.get("ativo", True), (r.get("nome") or "").lower()))
    return [FuncionarioItem(**r) for r in linhas]


def obter(funcionario_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    try:
        linhas = _q(db, usuario, db.table("funcionarios").select(_COLS + ", tenant_id")
                    .eq("id", str(funcionario_id))).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _erro(503, "Cadastro de funcionários indisponível: rode a migration 0048.") from e
        raise
    if not linhas:
        raise _erro(404, "Funcionário não encontrado.")
    return linhas[0]


def _validar_centro(centro: str | None, usuario: UsuarioAtual, db: Client) -> str | None:
    centro = (centro or "").strip() or None
    if centro:
        from app.services.financeiro_service import _ler_centros, validar_centro_lancamento
        if not any(c.get("codigo") == centro for c in _ler_centros(db, _tenant(usuario))):
            raise _erro(422, "Centro de custo não encontrado.")
        validar_centro_lancamento(db, centro, tenant_id=_tenant(usuario))
    return centro


def _nome(nome: str) -> str:
    nome = " ".join((nome or "").split())
    if len(nome) < 3:
        raise _erro(422, "Informe o nome completo.")
    return nome[:200]


def criar(payload: FuncionarioCreate, usuario: UsuarioAtual, db: Client) -> FuncionarioItem:
    dados = {
        "nome": _nome(payload.nome),
        "centro_custo": _validar_centro(payload.centro_custo, usuario, db),
        "ativo": True,
    }
    if _tenant(usuario):
        dados["tenant_id"] = _tenant(usuario)
    existentes = {f.nome.lower() for f in listar(usuario, db)}
    if dados["nome"].lower() in existentes:
        raise _erro(409, f"Já existe um funcionário chamado {dados['nome']}.")
    try:
        row = db.table("funcionarios").insert(dados).execute().data[0]
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _erro(503, "Cadastro de funcionários indisponível: rode a migration 0048.") from e
        raise
    return FuncionarioItem(**{k: row.get(k) for k in _COLS.split(", ")})


def atualizar(funcionario_id: UUID, payload: FuncionarioUpdate, usuario: UsuarioAtual, db: Client) -> FuncionarioItem:
    obter(funcionario_id, usuario, db)
    campos: dict = {}
    sets = payload.model_fields_set
    if "nome" in sets and payload.nome is not None:
        campos["nome"] = _nome(payload.nome)
        outros = {f.nome.lower() for f in listar(usuario, db) if str(f.id) != str(funcionario_id)}
        if campos["nome"].lower() in outros:
            raise _erro(409, f"Já existe um funcionário chamado {campos['nome']}.")
    if "centro_custo" in sets:
        campos["centro_custo"] = _validar_centro(payload.centro_custo, usuario, db)
    if "ativo" in sets and payload.ativo is not None:
        campos["ativo"] = payload.ativo
    if campos:
        _q(db, usuario, db.table("funcionarios").update(campos).eq("id", str(funcionario_id))).execute()
    return FuncionarioItem(**{k: v for k, v in obter(funcionario_id, usuario, db).items() if k != "tenant_id"})


def excluir(funcionario_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    obter(funcionario_id, usuario, db)
    try:
        usado = (db.table("ordens_compra").select("id").eq("funcionario_id", str(funcionario_id))
                 .neq("status", "excluida").limit(1).execute().data)
    except Exception:  # noqa: BLE001 — sem a coluna, ninguém usa ainda
        usado = []
    if usado:
        raise _erro(409, "Este funcionário tem Ordens de Compra — desative-o em vez de excluir.")
    _q(db, usuario, db.table("funcionarios").delete().eq("id", str(funcionario_id))).execute()
