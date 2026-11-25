"""
MX Seguros — DRE-IA | Permissões granulares por tela e ação.

Estrutura: {"tela": {"acao": bool}}
Telas: visao_geral, dre, lancamentos, aprovacoes, relatorios, configuracoes,
pagamentos (CNAB, 0050), ordem_compra (perfil Colaborador)
("assistente" é a chave do antigo Monitoramento IA; fica só para compatibilidade
com permissões personalizadas gravadas antes da tela Relatórios.)
"""
from __future__ import annotations

DEFAULT_PERMISSIONS: dict[str, dict] = {
    "admin": {
        "visao_geral":   {"visualizar": True},
        "dre":           {"visualizar": True},
        "lancamentos":   {"visualizar": True, "criar": True, "editar": True, "deletar": True},
        "aprovacoes":    {"visualizar": True, "aprovar": True},
        "assistente":    {"visualizar": True},
        "relatorios":    {"visualizar": True, "criar": True, "compartilhar": True},
        "configuracoes": {"visualizar": True, "criar": True, "editar": True, "deletar": True},
        "pagamentos":    {"visualizar": True, "remessa": True, "retorno": True, "config": True},
    },
    "gestor": {
        "visao_geral":   {"visualizar": True},
        "dre":           {"visualizar": True},
        "lancamentos":   {"visualizar": True, "criar": True, "editar": True, "deletar": False},
        "aprovacoes":    {"visualizar": True, "aprovar": True},
        "assistente":    {"visualizar": True},
        "relatorios":    {"visualizar": True, "criar": True, "compartilhar": True},
        "configuracoes": {"visualizar": True, "criar": True, "editar": True, "deletar": True},
        "pagamentos":    {"visualizar": True, "remessa": True, "retorno": True, "config": False},
    },
    "comercial": {
        "visao_geral":   {"visualizar": True},
        "dre":           {"visualizar": True},
        "lancamentos":   {"visualizar": True, "criar": True, "editar": False, "deletar": False},
        "aprovacoes":    {"visualizar": False, "aprovar": False},
        "assistente":    {"visualizar": True},
        "relatorios":    {"visualizar": True, "criar": True, "compartilhar": False},
        "configuracoes": {"visualizar": True, "criar": False, "editar": False, "deletar": False},
    },
    "contador": {
        "visao_geral":   {"visualizar": True},
        "dre":           {"visualizar": True},
        "lancamentos":   {"visualizar": True, "criar": True, "editar": False, "deletar": False},
        "aprovacoes":    {"visualizar": False, "aprovar": False},
        "assistente":    {"visualizar": True},
        "relatorios":    {"visualizar": True, "criar": True, "compartilhar": False},
        "configuracoes": {"visualizar": True, "criar": False, "editar": False, "deletar": False},
    },
    # Funcionário que só lança Ordem de Compra pelo link /oc (0047). A API nega
    # o resto pelo perfil (app/auth.py), não por estas chaves.
    "colaborador": {
        "visao_geral":   {"visualizar": False},
        "dre":           {"visualizar": False},
        "lancamentos":   {"visualizar": False, "criar": False, "editar": False, "deletar": False},
        "aprovacoes":    {"visualizar": False, "aprovar": False},
        "assistente":    {"visualizar": False},
        "relatorios":    {"visualizar": False, "criar": False, "compartilhar": False},
        "configuracoes": {"visualizar": False, "criar": False, "editar": False, "deletar": False},
        "ordem_compra":  {"visualizar": True, "criar": True},
    },
}


def get_default_permissions(role: str) -> dict:
    return DEFAULT_PERMISSIONS.get(role, DEFAULT_PERMISSIONS["comercial"])


def resolver_permissions(role: str, permissions_db: dict | None) -> dict:
    """Retorna permissions_db se definido, senão as permissões padrão da role."""
    if permissions_db is None:
        return get_default_permissions(role)
    return permissions_db


def tem_permissao(permissions: dict, tela: str, acao: str) -> bool:
    return bool(permissions.get(tela, {}).get(acao, False))


def permissao_relatorios(role: str, permissions: dict, acao: str) -> bool:
    """Permissão da tela Relatórios, com herança para permissões personalizadas
    gravadas antes dela existir (sem a chave "relatorios"): ver e criar seguem o
    "Ver" do antigo Monitoramento IA; compartilhar fica com Admin e Gestor."""
    if "relatorios" in permissions:
        return tem_permissao(permissions, "relatorios", acao)
    if acao == "compartilhar":
        return role in ("admin", "gestor")
    return tem_permissao(permissions, "assistente", "visualizar")


# Pagamentos por CNAB (0050). Permissões personalizadas gravadas antes da tela
# existir não têm a chave "pagamentos": aí vale o padrão do perfil.
_PAGAMENTOS_PADRAO = {
    "admin": {"visualizar", "remessa", "retorno", "config"},
    "super_admin": {"visualizar", "remessa", "retorno", "config"},
    "gestor": {"visualizar", "remessa", "retorno"},
}


def permissao_pagamentos(role: str, permissions: dict | None, acao: str) -> bool:
    if role in ("admin", "super_admin"):
        return True
    if permissions and "pagamentos" in permissions:
        return tem_permissao(permissions, "pagamentos", acao)
    return acao in _PAGAMENTOS_PADRAO.get(role, set())
