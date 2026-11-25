"""
MX Seguros — DRE-IA | Contas pagadoras (migration 0050, 25/11/2026).

Conta da MX de onde sai o pagamento por CNAB (Santander 033 / Itaú 341),
com convênio, NSA e as opções contratadas no convênio. Cadastro só do Admin
(pagamentos.config); quem gera remessa vê a lista com a conta mascarada.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.cnab.normalize import so_alfanum, so_digitos
from app.cnab.validators import cnpj_valido
from app.models.pagamentos import ContaPagadoraPayload
from app.permissions import permissao_pagamentos

_COLS = ("id, banco_id, codigo_banco, apelido, agencia, agencia_dv, conta, conta_dv, cnpj_empresa, "
         "razao_social, codigo_convenio, endereco, proximo_nsa, ambiente, opcoes, ativa")
_NOMES_BANCO = {"033": "santander", "341": "ita"}


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _sem_tabela(e: Exception) -> bool:
    s = str(e).lower()
    return "contas_pagadoras" in s and ("does not exist" in s or "schema cache" in s or "42p01" in s)


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _q(usuario: UsuarioAtual, q):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def _saida(r: dict, completo: bool) -> dict:
    out = {k: r.get(k) for k in _COLS.split(", ")}
    out["opcoes"] = {"enviar_bloqueado": True, **(r.get("opcoes") or {})}
    nome = "Santander" if r.get("codigo_banco") == "033" else "Itaú"
    out["descricao"] = (f"{r.get('apelido') or nome} · Ag {r.get('agencia')} · "
                        f"CC ****{str(r.get('conta') or '')[-3:]}{'-' + r['conta_dv'] if r.get('conta_dv') else ''}")
    if not completo:
        for k in ("conta", "conta_dv", "codigo_convenio", "endereco"):
            out[k] = None
    return out


def listar(usuario: UsuarioAtual, db: Client) -> list[dict]:
    if not permissao_pagamentos(usuario.role, usuario.permissions, "visualizar"):
        raise _erro(403, "Sem permissão para Pagamentos.")
    try:
        linhas = _q(usuario, db.table("contas_pagadoras").select(_COLS)).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return []
        raise
    completo = permissao_pagamentos(usuario.role, usuario.permissions, "config")
    linhas.sort(key=lambda r: (not r.get("ativa", True), r.get("codigo_banco"), r.get("apelido") or ""))
    return [_saida(r, completo) for r in linhas]


def ler(conta_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    """Linha completa (uso interno: geração de remessa)."""
    try:
        linhas = _q(usuario, db.table("contas_pagadoras").select(_COLS + ", tenant_id")
                    .eq("id", str(conta_id))).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.") from e
        raise
    if not linhas:
        raise _erro(404, "Conta pagadora não encontrada.")
    return linhas[0]


def _banco_id(codigo: str, db: Client) -> str | None:
    try:
        bancos = db.table("bancos").select("id, nome").execute().data or []
    except Exception:  # noqa: BLE001
        return None
    alvo = _NOMES_BANCO[codigo]
    for b in bancos:
        if alvo in (b.get("nome") or "").lower():
            return b["id"]
    return None


def _dados(p: ContaPagadoraPayload, db: Client) -> dict:
    agencia, conta = so_digitos(p.agencia), so_digitos(p.conta)
    if not agencia or len(agencia) > 5:
        raise _erro(422, "Agência inválida (até 5 números, sem o dígito).")
    if p.codigo_banco == "033" and len(agencia) > 4:
        raise _erro(422, "No Santander a agência tem 4 números.")
    if not conta or len(conta) > 12:
        raise _erro(422, "Conta inválida (até 12 números, sem o dígito).")
    cnpj = so_alfanum(p.cnpj_empresa)
    if not cnpj_valido(cnpj):
        raise _erro(422, "CNPJ da empresa inválido.")
    convenio = so_digitos(p.codigo_convenio) or None
    if p.codigo_banco == "033":
        if not convenio:
            raise _erro(422, "Informe o código do convênio do Santander.")
        if len(convenio) > 12:
            raise _erro(422, "O convênio do Santander tem até 12 números.")
    return {
        "codigo_banco": p.codigo_banco, "banco_id": _banco_id(p.codigo_banco, db),
        "apelido": (p.apelido or "").strip() or None,
        "agencia": agencia, "agencia_dv": so_alfanum(p.agencia_dv)[:1] or None,
        "conta": conta, "conta_dv": so_alfanum(p.conta_dv)[:1] or None,
        "cnpj_empresa": cnpj, "razao_social": " ".join(p.razao_social.split()),
        "codigo_convenio": convenio, "endereco": p.endereco or {},
        "proximo_nsa": p.proximo_nsa, "ambiente": p.ambiente,
        "opcoes": p.opcoes.model_dump(), "ativa": p.ativa,
    }


def _exigir_config(usuario: UsuarioAtual) -> None:
    if not permissao_pagamentos(usuario.role, usuario.permissions, "config"):
        raise _erro(403, "Só o Admin cadastra contas pagadoras.")


def criar(payload: ContaPagadoraPayload, usuario: UsuarioAtual, db: Client) -> dict:
    _exigir_config(usuario)
    dados = _dados(payload, db)
    if payload.opcoes.sequencial_teste and dados["proximo_nsa"] <= 10 and payload.ambiente == "producao":
        dados["proximo_nsa"] = 11   # 1..10 seriam tratados como teste pelo banco
    if _tenant(usuario):
        dados["tenant_id"] = _tenant(usuario)
    try:
        row = db.table("contas_pagadoras").insert(dados).execute().data[0]
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.") from e
        raise
    return _saida(row, True)


def atualizar(conta_id: UUID, payload: ContaPagadoraPayload, usuario: UsuarioAtual, db: Client) -> tuple[dict, dict]:
    """Devolve (conta, mudanças relevantes para auditoria)."""
    _exigir_config(usuario)
    atual = ler(conta_id, usuario, db)
    dados = _dados(payload, db)
    if (payload.opcoes.sequencial_teste and payload.ambiente == "producao"
            and dados["proximo_nsa"] <= 10):
        raise _erro(422, "Com o sequencial de teste contratado, arquivos 1 a 10 são só teste: use NSA 11 ou maior em produção.")
    mudancas = {}
    for campo in ("proximo_nsa", "ambiente", "opcoes", "codigo_convenio", "agencia", "conta"):
        if atual.get(campo) != dados.get(campo):
            mudancas[campo] = {"de": atual.get(campo), "para": dados.get(campo)} if campo in (
                "proximo_nsa", "ambiente", "opcoes") else "alterado"
    _q(usuario, db.table("contas_pagadoras").update(dados).eq("id", str(conta_id))).execute()
    return _saida(ler(conta_id, usuario, db), True), mudancas


def excluir(conta_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    _exigir_config(usuario)
    ler(conta_id, usuario, db)
    try:
        usada = db.table("remessas").select("id").eq("conta_id", str(conta_id)).limit(1).execute().data
    except Exception:  # noqa: BLE001
        usada = []
    if usada:
        raise _erro(409, "Esta conta já tem remessas — desative-a em vez de excluir.")
    _q(usuario, db.table("contas_pagadoras").delete().eq("id", str(conta_id))).execute()
