"""Filtro "Situação" de Lançamentos (28/11/2026).

Uma situação por lançamento, sem sobreposição, na mesma precedência do selo que
a lista mostra (frontend/.../lancamentos/_components/situacao.tsx):

Despesa: paga → rejeitada → aguardando (pendente) → vencida | vence_hoje | a_pagar
Receita: recebida → rejeitada → atrasada | a_receber

Datas comparadas como 'YYYY-MM-DD' no fuso de Brasília (hoje_brasil).
"""
from __future__ import annotations

SITUACOES_DESPESA = ("a_pagar", "vence_hoje", "vencida", "aguardando", "paga", "rejeitada")
SITUACOES_RECEITA = ("a_receber", "atrasada", "recebida", "rejeitada")

PADRAO_DESPESA = "^(" + "|".join(SITUACOES_DESPESA) + ")$"
PADRAO_RECEITA = "^(" + "|".join(SITUACOES_RECEITA) + ")$"


def _dia(valor) -> str:
    return str(valor)[:10] if valor else ""


def situacao_despesa(paga_em, status, vencimento, hoje: str) -> str:
    if paga_em:
        return "paga"
    if status == "rejeitada":
        return "rejeitada"
    if status == "pendente":
        return "aguardando"
    venc = _dia(vencimento)
    if venc and venc < hoje:
        return "vencida"
    if venc == hoje:
        return "vence_hoje"
    return "a_pagar"


def situacao_receita(recebido_em, status, vencimento, hoje: str) -> str:
    if recebido_em:
        return "recebida"
    if status == "rejeitada":
        return "rejeitada"
    venc = _dia(vencimento)
    if venc and venc < hoje:
        return "atrasada"
    return "a_receber"


def filtrar_despesas(q, situacao: str | None, hoje: str):
    """Aplica a situação numa query PostgREST de `despesas` (paginação no banco)."""
    if not situacao:
        return q
    if situacao == "paga":
        return q.not_.is_("paga_em", "null")
    q = q.is_("paga_em", "null")
    if situacao == "rejeitada":
        return q.eq("status", "rejeitada")
    if situacao == "aguardando":
        return q.eq("status", "pendente")
    q = q.eq("status", "aprovada")
    if situacao == "vencida":
        return q.lt("data_vencimento", hoje)
    if situacao == "vence_hoje":
        return q.eq("data_vencimento", hoje)
    return q.or_(f"data_vencimento.gt.{hoje},data_vencimento.is.null")   # a_pagar


def contar(chaves: list[str], todas: tuple[str, ...]) -> dict[str, int]:
    saida = {s: 0 for s in todas}
    for c in chaves:
        saida[c] = saida.get(c, 0) + 1
    return saida
