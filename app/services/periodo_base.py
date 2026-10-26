"""
MX Seguros — DRE-IA | Base de data dos filtros de período.

Pedido de 22/10/2026: os filtros oferecem Dia, Mês e Ano.
  • Mês e Ano  → base "competencia" (como sempre; bate com a DRE).
  • Dia        → base "data": despesa pelo VENCIMENTO, receita/comissão pelo
                 RECEBIMENTO — a competência é sempre o dia 1 do mês e não
                 serve para escolher um dia.
  • Pagamento  → base "pagamento" (22/10/2026, padrão de TODAS as telas
                 operacionais): pela Data de Pagamento/Recebimento; o que
                 ainda está em aberto entra pelo vencimento e, sem ele, pela
                 competência. Coluna `data_ref`, calculada pelo banco (0042).
                 A DRE e as Metas seguem por competência.
Ordens de compra já filtram por data_solicitacao e não dependem da base.
"""
from __future__ import annotations

_COLUNAS = {
    "despesas":        {"competencia": "competencia", "data": "data_vencimento", "pagamento": "data_ref"},
    "receitas_outras": {"competencia": "competencia", "data": "recebido_em", "pagamento": "data_ref"},
    "comissoes":       {"competencia": "competencia", "data": "recebida_em", "pagamento": "data_ref"},
}


def coluna_data(tabela: str, base: str) -> str:
    """Coluna usada para recortar o período em `tabela` conforme a base."""
    return _COLUNAS[tabela].get(base, "competencia")


def ids_do_tipo(db, categoria_id: str | None, tipo_lancamento_id: str | None) -> list[str] | None:
    """Filtro "Tipo" de Lançamentos: subitem exato, ou todos os subitens da
    categoria. None = sem filtro. Categoria sem subitem devolve um id que não
    existe, para a lista voltar vazia em vez de ignorar o filtro."""
    if tipo_lancamento_id:
        return [tipo_lancamento_id]
    if categoria_id:
        rows = (db.table("subitens_lancamento").select("id")
                .eq("categoria_id", categoria_id).execute().data or [])
        return [r["id"] for r in rows] or ["00000000-0000-0000-0000-000000000000"]
    return None
