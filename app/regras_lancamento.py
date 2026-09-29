"""
MX Seguros — DRE-IA | Regras de ciclo de vida de lançamento compartilhadas.

Vale para despesas e ordens de compra: quem aprova (admin/gestor) exclui
qualquer lançamento; os demais só o que criaram, e só antes da aprovação —
depois de aprovado, o lançamento já compõe o DRE e removê-lo é decisão de
quem aprova.

A checagem é explícita em código porque as exclusões rodam com a
service_role, que ignora a RLS: sem ela, afrouxar o papel no router
deixaria qualquer um apagar o lançamento de qualquer pessoa.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from supabase import Client

from app.auth import UsuarioAtual

ROLES_APROVACAO = ("admin", "gestor")


def pode_excluir_qualquer(usuario: UsuarioAtual) -> bool:
    return usuario.role in ROLES_APROVACAO


def garantir_exclusao_propria(tabela: str, item_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    """Levanta 404/403 se `usuario` não puder excluir o item de `tabela`."""
    resp = (
        db.table(tabela).select("criado_por, status")
        .eq("id", str(item_id)).neq("status", "excluida")
        .maybe_single().execute()
    )
    linha = getattr(resp, "data", None) if resp is not None else None
    if not linha:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")
    if linha.get("criado_por") != usuario.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Você só pode excluir lançamentos que você criou.",
        )
    if linha.get("status") == "aprovada":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Lançamento já aprovado — só Admin ou Gestor podem excluí-lo.",
        )
