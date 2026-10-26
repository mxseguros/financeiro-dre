"""
MX Seguros — DRE-IA | Classificações dos subitens (Configurações).

Lista editável (migration 0039, tabela `classificacoes`) usada no campo
Classificação de despesas e receitas (do lançamento desde a 0040). Todas podem
ser renomeadas, desativadas e excluídas; a exclusão é barrada quando algum
lançamento ou subitem usa a classificação. `usada_dre` (0041) desmarcada tira
da DRE os lançamentos com ela. Sem a tabela (migration não rodada), a lista
padrão é devolvida e o cadastro fica indisponível.
"""
from __future__ import annotations

import logging
import re
import unicodedata

from fastapi import HTTPException, status
from supabase import Client

from app.auth import UsuarioAtual

logger = logging.getLogger(__name__)

PADRAO = [
    {"codigo": "fixo", "nome": "Fixo", "natureza": "ambas", "ordem": 1, "ativo": True, "sistema": True, "usada_dre": True},
    {"codigo": "variavel", "nome": "Variável", "natureza": "ambas", "ordem": 2, "ativo": True, "sistema": True, "usada_dre": True},
    {"codigo": "imposto", "nome": "Imposto", "natureza": "ambas", "ordem": 3, "ativo": True, "sistema": True, "usada_dre": True},
    {"codigo": "nao_operacional", "nome": "Não Operacional", "natureza": "ambas", "ordem": 4, "ativo": True, "sistema": True, "usada_dre": True},
]
_COLS = "codigo, nome, natureza, ordem, ativo, sistema, usada_dre"


def _slug(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:40] or "classificacao"


def listar(db: Client, natureza: str | None = None) -> list[dict]:
    try:
        rows = db.table("classificacoes").select(_COLS).order("ordem").order("nome").execute().data or []
    except Exception as e:  # noqa: BLE001 — tabela da 0039 ainda não criada
        logger.warning("classificacoes_indisponivel: %s", e)
        rows = list(PADRAO)
    if natureza:
        rows = [r for r in rows if r["natureza"] in (natureza, "ambas")]
    return rows


def codigos_fora_dre(db: Client) -> set[str]:
    """Classificações com "Usada na DRE" desmarcada (migration 0041)."""
    return {c["codigo"] for c in listar(db) if c.get("usada_dre") is False}


def validar(db: Client, codigo: str) -> None:
    """422 claro para código fora da lista (a FK da 0040 daria 500 sem CORS)."""
    if codigo not in {c["codigo"] for c in listar(db)}:
        raise HTTPException(status_code=422, detail=f"Classificação inválida: '{codigo}'.")


def _indisponivel(e: Exception) -> HTTPException:
    logger.warning("classificacoes_escrita_falhou: %s", e)
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                         detail="Cadastro de classificações indisponível: rode a migration 0039 no Supabase.")


def criar(nome: str, natureza: str, ordem: int, usuario: UsuarioAtual, db: Client, usada_dre: bool = True) -> dict:
    nome = nome.strip()
    if not nome:
        raise HTTPException(status_code=422, detail="Informe o nome da classificação.")
    try:
        existentes = {r["codigo"] for r in db.table("classificacoes").select("codigo").execute().data or []}
    except Exception as e:  # noqa: BLE001
        raise _indisponivel(e)
    base = codigo = _slug(nome)
    n = 2
    while codigo in existentes:
        codigo = f"{base}_{n}"; n += 1
    dados = {"codigo": codigo, "nome": nome, "natureza": natureza, "ordem": ordem, "usada_dre": usada_dre}
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id
    return db.table("classificacoes").insert(dados).execute().data[0]


def atualizar(codigo: str, campos: dict, db: Client) -> dict:
    try:
        atual = db.table("classificacoes").select(_COLS).eq("codigo", codigo).execute().data
    except Exception as e:  # noqa: BLE001
        raise _indisponivel(e)
    if not atual:
        raise HTTPException(status_code=404, detail="Classificação não encontrada.")
    if "nome" in campos and not (campos["nome"] or "").strip():
        raise HTTPException(status_code=422, detail="Informe o nome da classificação.")
    if not campos:
        return atual[0]
    return db.table("classificacoes").update(campos).eq("codigo", codigo).execute().data[0]


def excluir(codigo: str, db: Client) -> None:
    try:
        atual = db.table("classificacoes").select(_COLS).eq("codigo", codigo).execute().data
    except Exception as e:  # noqa: BLE001
        raise _indisponivel(e)
    if not atual:
        raise HTTPException(status_code=404, detail="Classificação não encontrada.")
    # Inclui lançamentos excluídos (soft delete): a FK também os vê.
    for tabela in ("despesas", "receitas_outras", "subitens_lancamento"):
        if db.table(tabela).select("id").eq("custo_tipo", codigo).limit(1).execute().data:
            raise HTTPException(status_code=409, detail="Há lançamentos ou subitens com esta classificação — desative-a em vez de excluir.")
    db.table("classificacoes").delete().eq("codigo", codigo).execute()
