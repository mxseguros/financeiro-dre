"""Chave da API de IA (Anthropic) guardada em Configurações — só o Admin gerencia.

- A chave é gravada CIFRADA (Fernet: AES-128-CBC + HMAC-SHA256) na tabela
  `integracoes_ia` (0051). A chave de cifra é derivada (HKDF-SHA256) de um segredo
  do servidor: `CRIPTO_CHAVE` se existir, senão a service_role do Supabase. Quem lê
  o banco sem esse segredo não consegue usar a chave.
- A API nunca devolve a chave: só a máscara (`sk-ant-…QAA`). Logs e auditoria
  também só levam a máscara.
- Sem chave cadastrada, vale `ANTHROPIC_API_KEY` do ambiente (como antes).
- Cache de 60 s por instância: o agente não consulta o banco a cada pergunta.
"""
from __future__ import annotations

import base64
import os
import time
from datetime import datetime, timezone

import anthropic
import structlog
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import HTTPException, status
from supabase import Client

from app.config import cfg
from app.database import get_supabase_admin
from app.auth import UsuarioAtual

logger = structlog.get_logger(__name__)

TABELA = "integracoes_ia"
PROVEDOR = "anthropic"
_TTL = 60.0
_cache: dict[str, tuple[float, str]] = {}


class ChaveIndisponivel(Exception):
    """Não há chave cadastrada nem no ambiente."""


# ── Cifra ─────────────────────────────────────────────────────
def _fernet() -> Fernet:
    segredo = os.environ.get("CRIPTO_CHAVE") or cfg.supabase_service_role_key
    if not segredo:
        raise RuntimeError("Sem segredo do servidor para cifrar a chave (CRIPTO_CHAVE).")
    chave = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"mx-dre", info=b"integracoes_ia/v1") \
        .derive(segredo.encode())
    return Fernet(base64.urlsafe_b64encode(chave))


def cifrar(texto: str) -> str:
    return _fernet().encrypt(texto.encode()).decode()


def decifrar(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def mascarar(chave: str) -> str:
    chave = chave.strip()
    if len(chave) <= 12:
        return "•" * 8
    prefixo = chave[:7] if chave.startswith("sk-ant-") else chave[:3]
    return f"{prefixo}…{chave[-4:]}"


# ── Acesso ────────────────────────────────────────────────────
def exigir_admin(usuario: UsuarioAtual) -> None:
    if usuario.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Apenas o Admin gerencia a chave da IA.")


def _tenant(tenant_id: str | None) -> str:
    return str(tenant_id) if tenant_id else ""


def _linha(db: Client, tenant_id: str | None) -> dict | None:
    q = db.table(TABELA).select("id, tenant_id, chave_cifrada, mascara, atualizada_por, atualizada_em") \
        .eq("provedor", PROVEDOR)
    q = q.eq("tenant_id", tenant_id) if tenant_id else q.is_("tenant_id", "null")
    linhas = q.limit(1).execute().data or []
    return linhas[0] if linhas else None


def obter_chave(tenant_id: str | None = None, db: Client | None = None) -> str:
    """Chave em uso: a cadastrada em Configurações, senão ANTHROPIC_API_KEY."""
    agora = time.monotonic()
    k = _tenant(tenant_id)
    if k in _cache and agora - _cache[k][0] < _TTL:
        return _cache[k][1]
    chave = ""
    try:
        linha = _linha(db or get_supabase_admin(), tenant_id)
        if linha:
            chave = decifrar(linha["chave_cifrada"])
    except InvalidToken:
        logger.error("ia_chave_nao_decifra", motivo="segredo do servidor mudou; cadastre a chave de novo")
    except Exception as e:  # noqa: BLE001 — sem a tabela (antes da 0051) ou banco fora: usa o ambiente
        logger.warning("ia_chave_leitura_falhou", erro=type(e).__name__)
    chave = chave or cfg.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not chave:
        raise ChaveIndisponivel("IA não configurada: o Admin deve cadastrar a chave em Configurações → Assistente de IA.")
    _cache[k] = (agora, chave)
    return chave


def tem_chave(tenant_id: str | None = None) -> bool:
    try:
        return bool(obter_chave(tenant_id))
    except ChaveIndisponivel:
        return False


def limpar_cache() -> None:
    _cache.clear()


# ── Configurações (Admin) ─────────────────────────────────────
def situacao(usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    linha = None
    try:
        linha = _linha(db, usuario.tenant_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("ia_chave_situacao_falhou", erro=type(e).__name__)
    if linha:
        legivel = True
        try:
            decifrar(linha["chave_cifrada"])
        except InvalidToken:
            legivel = False
        return {"configurada": True, "origem": "configuracoes", "mascara": linha["mascara"],
                "atualizada_em": linha.get("atualizada_em"), "legivel": legivel}
    env = cfg.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if env:
        return {"configurada": True, "origem": "ambiente", "mascara": mascarar(env), "atualizada_em": None, "legivel": True}
    return {"configurada": False, "origem": None, "mascara": None, "atualizada_em": None, "legivel": True}


def validar_formato(chave: str) -> str:
    chave = (chave or "").strip()
    if not chave.startswith("sk-ant-") or len(chave) < 40 or any(c.isspace() for c in chave):
        raise HTTPException(422,
                            "Chave inválida: a chave da Anthropic começa com \"sk-ant-\".")
    return chave


def testar(chave: str) -> tuple[bool, str]:
    """Chamada barata (lista de modelos) para conferir se a chave é aceita."""
    try:
        anthropic.Anthropic(api_key=chave, max_retries=0, timeout=15).models.list(limit=1)
        return True, "Chave aceita pela Anthropic."
    except anthropic.AuthenticationError:
        return False, "A Anthropic recusou a chave (inválida ou revogada)."
    except anthropic.PermissionDeniedError:
        return False, "A chave não tem permissão para usar a API."
    except Exception as e:  # noqa: BLE001
        return False, f"Não foi possível falar com a Anthropic ({type(e).__name__})."


def salvar(chave: str, usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    chave = validar_formato(chave)
    ok, msg = testar(chave)
    if not ok:
        raise HTTPException(422, msg)
    dados = {"chave_cifrada": cifrar(chave), "mascara": mascarar(chave), "atualizada_por": usuario.user_id,
             "atualizada_em": datetime.now(timezone.utc).isoformat()}
    atual = _linha(db, usuario.tenant_id)
    if atual:
        db.table(TABELA).update(dados).eq("id", atual["id"]).execute()
    else:
        db.table(TABELA).insert({**dados, "tenant_id": usuario.tenant_id, "provedor": PROVEDOR}).execute()
    limpar_cache()
    logger.info("ia_chave_salva", mascara=dados["mascara"], usuario_id=usuario.user_id)
    return situacao(usuario, db)


def testar_atual(usuario: UsuarioAtual) -> dict:
    exigir_admin(usuario)
    try:
        chave = obter_chave(usuario.tenant_id)
    except ChaveIndisponivel as e:
        return {"ok": False, "mensagem": str(e)}
    ok, msg = testar(chave)
    return {"ok": ok, "mensagem": msg}


def remover(usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    atual = _linha(db, usuario.tenant_id)
    if atual:
        db.table(TABELA).delete().eq("id", atual["id"]).execute()
    limpar_cache()
    logger.info("ia_chave_removida", usuario_id=usuario.user_id)
    return situacao(usuario, db)
