"""Rate limiting via slowapi — protege contra DDoS e abuso de custo da Claude API."""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def _chave_cliente(request: Request) -> str:
    """
    Identifica o cliente real atrás do proxy (Railway/Vercel).

    Sem isso, get_remote_address vê o IP do proxy para TODOS os usuários,
    e o limite de 60/min passa a ser compartilhado pela empresa inteira.
    Usa o primeiro IP do X-Forwarded-For (setado pelo proxy da Railway);
    fallback para o IP direto quando rodando sem proxy (dev local).
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=_chave_cliente, default_limits=["60/minute"])
