"""
MX Seguros — DRE-IA | Validação local do JWT do Supabase.

POR QUE ISTO EXISTE
-------------------
Até 19/08/2026 `obter_usuario_atual` chamava `admin.auth.get_user(token)` a
cada requisição — uma ida e volta HTTP ao Supabase **antes** de qualquer
trabalho útil. Depois da migração do banco para São Paulo, com o backend na
Railway nos EUA, essa ida e volta passou a custar ~250ms medidos. Como ela
roda em TODA rota, era um piso de latência que nenhuma otimização de query
conseguiria remover.

O token do Supabase é assinado em **ES256** (curva elíptica) e o projeto
publica a chave pública em `/auth/v1/.well-known/jwks.json`. Verificar a
assinatura localmente com essa chave é criptograficamente equivalente a
perguntar ao Supabase se o token vale — e custa microssegundos.

O QUE MUDA NA SEGURANÇA — leia antes de mexer
---------------------------------------------
`get_user()` consulta a sessão no servidor, então um token de sessão
encerrada era rejeitado na hora. A validação local não enxerga revogação:
um token continua válido até o `exp`, hoje 1 hora após a emissão.

Isso é o comportamento normal de JWT, mas é uma mudança real de postura.
O antídoto operacional é a tabela `usuarios`: `_buscar_perfil_no_banco`
tem cache de 60s, então desativar um usuário corta o acesso dele em até
um minuto, independente do token. Para uso disciplinar imediato, desative
o usuário — não confie em "deslogar".

Se um dia o requisito for revogação instantânea, o caminho é uma denylist
de `jti` em cache compartilhado, não voltar ao `get_user()`.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from jose import jwt
from jose.exceptions import JWTError

from app.config import cfg

logger = logging.getLogger(__name__)

# As chaves do Supabase giram raramente. Uma hora de cache troca uma
# requisição HTTP por hora pelo risco de aceitar por até 1h uma chave que
# acabou de ser rotacionada — e, na rotação, o `kid` muda e o cache é
# invalidado na hora (ver _chave_para_kid).
_jwks: dict[str, Any] | None = None
_jwks_em: float = 0.0
_JWKS_TTL = 3600.0

ALGORITMOS = ("ES256", "RS256")


def _url_jwks() -> str:
    return cfg.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"


def _carregar_jwks(forcar: bool = False) -> dict[str, Any] | None:
    global _jwks, _jwks_em
    if not forcar and _jwks is not None and (time.monotonic() - _jwks_em) < _JWKS_TTL:
        return _jwks
    try:
        resp = httpx.get(_url_jwks(), timeout=5.0, headers={"apikey": cfg.supabase_anon_key})
        resp.raise_for_status()
        _jwks = resp.json()
        _jwks_em = time.monotonic()
        return _jwks
    except Exception as e:  # noqa: BLE001
        logger.warning("JWKS indisponível (%s) — caindo para validação remota.", e)
        return _jwks  # devolve o cache velho se houver; None força o fallback


def _chave_para_kid(kid: str) -> dict[str, Any] | None:
    """Acha a chave pelo kid, recarregando UMA vez se não encontrar.

    O recarregamento cobre rotação de chave: o token novo traz um kid que o
    cache ainda não conhece. Sem isso, toda a aplicação recusaria logins por
    até uma hora depois de uma rotação.
    """
    for tentativa in (False, True):
        jwks = _carregar_jwks(forcar=tentativa)
        if not jwks:
            return None
        for chave in jwks.get("keys", []):
            if chave.get("kid") == kid:
                return chave
    return None


def validar(token: str) -> dict[str, Any] | None:
    """Devolve os claims se o token for válido; None se não der para validar aqui.

    None significa "não sei" — o chamador deve cair para a validação remota.
    Token com assinatura inválida ou expirado levanta JWTError, e NÃO deve
    virar fallback: é uma resposta definitiva de que o token não presta.
    """
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise

    alg = header.get("alg")
    kid = header.get("kid")
    if alg not in ALGORITMOS or not kid:
        # HS256 (projetos Supabase antigos) ou header inesperado: sem chave
        # pública para conferir, quem decide é o Supabase.
        return None

    chave = _chave_para_kid(kid)
    if not chave:
        return None

    # audience e issuer entram na verificação de propósito: sem elas, um token
    # legítimo de OUTRO projeto Supabase passaria na conferência de assinatura
    # se algum dia as chaves coincidissem.
    return jwt.decode(
        token,
        chave,
        algorithms=[alg],
        audience="authenticated",
        issuer=cfg.supabase_url.rstrip("/") + "/auth/v1",
        options={"verify_exp": True, "verify_aud": True, "verify_iss": True},
    )
