"""
MX Seguros — DRE-IA | Salários confidenciais (24/11/2026, migration 0046).

Despesas de subitem marcado "confidencial" (folha de pagamento) não aparecem
com o nome e o valor de cada funcionário para quem não é Admin: viram uma
linha só, "Total Salários Funcionários", por mês de competência e situação
(paga / em aberto / pendente), para que totais e saldos continuem fechando.

Onde vale: lista de Lançamentos, Aprovações, listas da Visão Geral, detalhe
dos números da Visão Geral, Relatórios (e o Excel, que sai das linhas da
tela), um lançamento por id, anexos. A DRE não muda: já soma por subitem.

O mascaramento é na API. A RLS de despesas não foi apertada porque a DRE
(funções SECURITY INVOKER) e a Visão Geral leem com o token do usuário —
esconder as linhas lá tiraria os salários dos totais do Gestor.
"""
from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException, status
from supabase import Client

from app.auth import UsuarioAtual

logger = logging.getLogger(__name__)

ROTULO = "Total Salários Funcionários"
_NS = uuid.UUID("6f1c2a8e-58a4-4d7e-9a51-0c0de5a1a7e5")


def ve_detalhe(usuario: UsuarioAtual) -> bool:
    return usuario.role in ("admin", "super_admin")


def ids_confidenciais(db: Client) -> set[str]:
    """Subitens marcados. Sem a coluna (0046 não rodada), vazio: nada muda."""
    try:
        resp = db.table("subitens_lancamento").select("id").eq("confidencial", True).execute()
        return {r["id"] for r in (resp.data or [])}
    except Exception as e:  # noqa: BLE001
        logger.warning("confidencial_indisponivel: %s", e)
        return set()


def ids_ocultos(usuario: UsuarioAtual, db: Client) -> set[str]:
    """Subitens cujo detalhe este usuário não pode ver (vazio para o Admin)."""
    return set() if ve_detalhe(usuario) else ids_confidenciais(db)


def sem_confidenciais(q, ids: set[str]):
    """Tira as linhas desses subitens. `not.in` sozinho também descartaria as
    sem subitem (NULL NOT IN ... é NULL), por isso o `is.null`."""
    if not ids:
        return q
    return q.or_(f"tipo_lancamento_id.is.null,tipo_lancamento_id.not.in.({','.join(sorted(ids))})")


def eh_oculta(row: dict, ids: set[str]) -> bool:
    return bool(ids) and str(row.get("tipo_lancamento_id")) in ids


def garantir_detalhe(entidade: str, row: dict, usuario: UsuarioAtual, db: Client) -> None:
    """Lançamento confidencial, por id, para quem não é Admin: 404 (não revela)."""
    if entidade != "despesa" or ve_detalhe(usuario) or not row.get("tipo_lancamento_id"):
        return
    if str(row["tipo_lancamento_id"]) in ids_confidenciais(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")


def _situacao(row: dict) -> str:
    if row.get("status") == "pendente":
        return "pendente"
    return "paga" if row.get("paga_em") else "aberto"


def _mais_comum(valores: list):
    contagem: dict = defaultdict(int)
    for v in valores:
        contagem[v] += 1
    return max(contagem, key=contagem.get) if contagem else None


def agregar(rows: list[dict], tenant_id: str | None = None) -> list[dict]:
    """Linhas confidenciais → uma linha por (mês de competência, situação).

    Devolve dicts com as colunas de `despesas` (mais `agregado=True` e
    `quantidade`), prontos para os construtores de item de cada tela. O id é
    determinístico (uuid5) para a tela ter chave estável, mas não existe no banco.
    """
    grupos: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        grupos[((r.get("competencia") or "")[:7], _situacao(r))].append(r)
    saida = []
    for (mes, situacao), linhas in sorted(grupos.items(), reverse=True):
        def ultimo(campo: str):
            vals = [r.get(campo) for r in linhas if r.get(campo)]
            return max(vals) if vals else None

        pagas = [r for r in linhas if r.get("paga_em")]
        sub = _mais_comum([r.get("tipo_lancamento_id") for r in linhas])
        saida.append({
            "id": str(uuid.uuid5(_NS, f"{tenant_id}|{mes}|{situacao}")),
            "agregado": True,
            "quantidade": len(linhas),
            "descricao": ROTULO,
            "subcategoria": ROTULO,
            "valor": str(sum((Decimal(str(r.get("valor") or 0)) for r in linhas), Decimal(0))),
            "competencia": f"{mes}-01" if mes else None,
            "data_vencimento": ultimo("data_vencimento"),
            "data_ref": ultimo("data_ref"),
            "paga_em": ultimo("paga_em") if len(pagas) == len(linhas) else None,
            "status": "pendente" if situacao == "pendente" else "aprovada",
            "categoria": linhas[0].get("categoria"),
            "tipo_lancamento_id": sub,
            "subitens_lancamento": next((r.get("subitens_lancamento") for r in linhas
                                         if r.get("tipo_lancamento_id") == sub), None),
            "custo_tipo": _mais_comum([r.get("custo_tipo") for r in linhas]),
            "centro_custo": _mais_comum([r.get("centro_custo") for r in linhas]) or "matriz",
            "banco_id": _mais_comum([r.get("banco_id") for r in linhas]) if len({r.get("banco_id") for r in linhas}) == 1 else None,
            "bancos": linhas[0].get("bancos") if len({r.get("banco_id") for r in linhas}) == 1 else None,
            "recorrente": False,
            "parcela_atual": None,
            "parcela_total": None,
            "criado_por": None,
        })
    return saida


def ler_ocultas(montar_consulta, ids: set[str], usuario: UsuarioAtual, db_admin: Client) -> list[dict]:
    """Lê as linhas confidenciais com o client admin (o do usuário pode não
    vê-las), limitadas ao tenant. `montar_consulta(q)` aplica os mesmos
    filtros de período/centro/banco/status da tela."""
    if not ids:
        return []

    def consulta():  # builder novo a cada página: .range() acumula parâmetros
        q = montar_consulta(db_admin.table("despesas").select(
            "id, descricao, subcategoria, valor, competencia, data_vencimento, paga_em, data_ref, status, "
            "categoria, tipo_lancamento_id, custo_tipo, centro_custo, banco_id, criado_por, "
            "subitens_lancamento(nome), bancos(nome)"
        )).in_("tipo_lancamento_id", sorted(ids))
        if getattr(usuario, "tenant_id", None):
            q = q.eq("tenant_id", usuario.tenant_id)
        return q.order("id")

    linhas: list[dict] = []
    inicio = 0
    while True:  # PostgREST devolve no máximo 1000 por vez
        lote = consulta().range(inicio, inicio + 999).execute().data or []
        linhas += lote
        if len(lote) < 1000:
            return linhas
        inicio += 1000
