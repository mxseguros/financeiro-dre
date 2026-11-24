"""
MX Seguros — DRE-IA | Autenticação via JWT do Supabase.

O perfil do usuário (role) NUNCA vem do body/query da requisição.
Vem exclusivamente do JWT validado aqui. Tentativas de forjar role
via input são rejeitadas automaticamente.
"""
from __future__ import annotations

import re
import time as _time
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import cfg

# Cache em memória: {user_id: (role, tenant_id|None, equipe_id|None, produtor_id|None, permissions, timestamp)}
# TTL de 60s — esses campos raramente mudam.
_role_cache: dict[str, tuple[str, str | None, str | None, str | None, dict, float]] = {}
_ROLE_TTL = 60.0

BEARER = HTTPBearer()

ROLES_VALIDOS = {"admin", "gestor", "comercial", "contador", "super_admin", "colaborador"}

# Perfil Colaborador (0047): funcionário que só lança Ordem de Compra pelo
# link /oc. Tudo fora desta lista é negado AQUI, antes de qualquer rota —
# negar por padrão evita depender de cada router lembrar de barrar o perfil.
_ROTAS_COLABORADOR = [
    ("GET",    re.compile(r"^/usuarios/me/?$")),
    ("GET",    re.compile(r"^/configuracoes/centros-custo/?$")),
    ("GET",    re.compile(r"^/configuracoes/funcionarios/?$")),
    ("GET",    re.compile(r"^/ordens-compra/?$")),
    ("POST",   re.compile(r"^/ordens-compra/?$")),
    ("POST",   re.compile(r"^/ordens-compra/checar-duplicata/?$")),
    ("PATCH",  re.compile(r"^/ordens-compra/[0-9a-fA-F-]{36}/?$")),
    ("DELETE", re.compile(r"^/ordens-compra/[0-9a-fA-F-]{36}/?$")),
    ("POST",   re.compile(r"^/ordens-compra/[0-9a-fA-F-]{36}/recibo/?$")),
    ("*",      re.compile(r"^/anexos(/.*)?$")),
]


def rota_liberada_colaborador(metodo: str, caminho: str) -> bool:
    return any(m in ("*", metodo.upper()) and r.match(caminho) for m, r in _ROTAS_COLABORADOR)


class UsuarioAtual(BaseModel):
    """Contexto do usuário extraído do JWT — fonte de verdade para permissões."""
    user_id:     str
    email:       str
    role:        str
    tenant_id:   str | None = None   # Sprint 4: multi-tenant
    equipe_id:   str | None = None
    produtor_id: str | None = None
    permissions: dict = {}


async def obter_usuario_atual(
    request: Request,
    credenciais: Annotated[HTTPAuthorizationCredentials, Depends(BEARER)],
) -> UsuarioAtual:
    """
    Dependency do FastAPI: valida o JWT via Supabase Auth.
    O perfil (role) e tenant_id NUNCA vêm do token — vêm da tabela usuarios.
    """
    token = credenciais.credentials

    # Caminho rápido: confere a assinatura com a chave pública do projeto, sem
    # sair da máquina. Substitui um get_user() que custava ~250ms em TODA rota
    # depois que o banco foi para São Paulo e o backend ficou nos EUA.
    # Ver app/jwt_local.py para o que isso muda em revogação de sessão.
    from jose.exceptions import JWTError

    from app import jwt_local

    user_id: str | None = None
    email: str = ""
    try:
        claims = jwt_local.validar(token)
        if claims:
            user_id = claims.get("sub")
            email = claims.get("email") or ""
    except JWTError as e:
        # Assinatura inválida ou expirado: resposta definitiva, sem fallback.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token inválido: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    if not user_id:
        # Só chega aqui se a validação local não foi possível (JWKS fora do ar,
        # ou projeto ainda em HS256). Cai para o Supabase, que é lento mas sabe.
        from supabase import create_client
        try:
            admin = create_client(cfg.supabase_url, cfg.supabase_service_role_key)
            user = admin.auth.get_user(token).user
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token inválido: {e}",
                headers={"WWW-Authenticate": "Bearer"},
            ) from e
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Usuário não autenticado.",
            )
        user_id, email = user.id, (user.email or "")

    role, tenant_id, equipe_id, produtor_id, permissions = await _buscar_perfil_no_banco(user_id)

    if role == "colaborador" and not rota_liberada_colaborador(request.method, request.url.path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seu perfil (Colaborador) só lança Ordens de Compra.",
        )

    return UsuarioAtual(
        user_id=user_id,
        email=email,
        role=role,
        tenant_id=tenant_id,
        equipe_id=equipe_id,
        produtor_id=produtor_id,
        permissions=permissions,
    )


async def _buscar_perfil_no_banco(user_id: str) -> tuple[str, str | None, str | None, str | None, dict]:
    """
    Busca role, tenant_id, equipe_id, produtor_id e permissions do usuário, com cache TTL=60s.
    Source of truth para permissões — nunca confia no JWT.
    Graceful: se coluna tenant_id não existir ainda (migration pendente), retorna None.
    """
    from app.permissions import resolver_permissions, get_default_permissions

    now = _time.monotonic()
    cached = _role_cache.get(user_id)
    if cached and now - cached[5] < _ROLE_TTL:
        return cached[0], cached[1], cached[2], cached[3], cached[4]

    from supabase import create_client
    admin = create_client(cfg.supabase_url, cfg.supabase_service_role_key)
    try:
        # Tenta buscar com tenant_id e permissions (migrations mais recentes)
        resp = admin.table("usuarios") \
            .select("role, tenant_id, equipe_id, produtor_id, permissions, ativo") \
            .eq("id", user_id) \
            .limit(1) \
            .execute()
        if resp.data:
            row = resp.data[0]
            # Usuário desativado em Configurações perde o acesso (antes só sumia
            # da lista e continuava entrando). Importa para funcionário desligado.
            if row.get("ativo") is False:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Usuário desativado. Fale com o administrador.",
                )
            role = row["role"]
            tenant_id = row.get("tenant_id")
            equipe_id = row.get("equipe_id")
            produtor_id = row.get("produtor_id")
            permissions = resolver_permissions(role, row.get("permissions"))
            _role_cache[user_id] = (role, tenant_id, equipe_id, produtor_id, permissions, now)
            return role, tenant_id, equipe_id, produtor_id, permissions
    except HTTPException:
        raise
    except Exception as e:
        err = str(e)
        # Fallback: coluna tenant_id ou permissions pode não existir ainda (migration pendente)
        if "schema cache" in err or "tenant_id" in err or "permissions" in err:
            try:
                resp = admin.table("usuarios") \
                    .select("role, equipe_id, produtor_id") \
                    .eq("id", user_id) \
                    .limit(1) \
                    .execute()
                if resp.data:
                    row = resp.data[0]
                    role = row["role"]
                    equipe_id = row.get("equipe_id")
                    produtor_id = row.get("produtor_id")
                    permissions = get_default_permissions(role)
                    _role_cache[user_id] = (role, None, equipe_id, produtor_id, permissions, now)
                    return role, None, equipe_id, produtor_id, permissions
            except Exception:
                pass

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Usuário não encontrado no sistema.",
    )


# Manter compatibilidade com código existente
async def _buscar_role_no_banco(user_id: str) -> str:
    role, _, _, _, _ = await _buscar_perfil_no_banco(user_id)
    return role


# ── Shortcuts para roles específicos ─────────────────────────

def _exigir_roles(*roles: str):
    async def _dep(usuario: Annotated[UsuarioAtual, Depends(obter_usuario_atual)]) -> UsuarioAtual:
        if usuario.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado. Perfil '{usuario.role}' não tem permissão.",
            )
        return usuario
    return _dep


ExigeAdmin         = Depends(_exigir_roles("admin"))
ExigeAdminContador = Depends(_exigir_roles("admin", "contador"))
ExigeTodos         = Depends(obter_usuario_atual)
