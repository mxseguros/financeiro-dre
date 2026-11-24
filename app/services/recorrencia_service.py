"""
MX Seguros — DRE-IA | Recorrência editável (24/11/2026).

Até aqui a recorrência só existia na CRIAÇÃO ("Repetir até": um registro por
mês). Agora a edição de uma despesa ou receita também liga, estende, encurta
ou desliga a série, a partir do lançamento editado:

- liga/estende: cria os meses que faltam até `repetir_ate`, copiando o
  lançamento JÁ editado (vencimento no mesmo dia, sem data de pagamento);
- encurta: remove as ocorrências futuras EM ABERTO depois de `repetir_ate`;
- desliga: remove as ocorrências futuras em aberto e desmarca o lançamento.

Ocorrência paga nunca é removida: o dinheiro já saiu/entrou e o lançamento é
o registro disso. A série é achada por `grupo_recorrencia` (migration 0048);
séries mais antigas, pela mesma heurística da exclusão "esta e as futuras"
(descrição + subitem + quem criou).
"""
from __future__ import annotations

from datetime import date
from uuid import uuid4

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual

MAX_MESES = 60

_CFG = {
    "despesas":        {"pago": "paga_em", "remover": "soft"},
    "receitas_outras": {"pago": "recebido_em", "remover": "hard"},
}


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _mes(v) -> date:
    d = date.fromisoformat(str(v)[:10])
    return date(d.year, d.month, 1)


def _carregar(tabela: str, item_id: str, db: Client, tenant_id: str | None = None) -> dict:
    linhas = (db.table(tabela).select("*").eq("id", str(item_id)).neq("status", "excluida")
              .execute().data or [])
    # Receitas são lidas com o client admin (ignora a RLS): confere o tenant aqui.
    if linhas and tenant_id and linhas[0].get("tenant_id") not in (None, tenant_id):
        linhas = []
    if not linhas:
        raise _erro(404, "Lançamento não encontrado.")
    return linhas[0]


def eh_serie(tabela: str, row: dict) -> bool:
    """A linha pode ter irmãs de recorrência? (para não confundir com avulsas
    de mesma descrição lançadas à mão mês a mês)."""
    if row.get("grupo_recorrencia"):
        return True
    if tabela == "despesas":
        return bool(row.get("recorrente")) and not row.get("parcela_total")
    # Receita não tinha marcador antes da 0048: a exclusão "esta e as
    # futuras" sempre usou a heurística — seguimos a mesma regra.
    return True


def serie_futura(tabela: str, row: dict, db: Client) -> list[dict]:
    """Ocorrências da série com competência posterior à da linha."""
    if not eh_serie(tabela, row):
        return []
    q = (db.table(tabela).select("*").neq("status", "excluida")
         .gt("competencia", str(row["competencia"])[:10]).neq("id", row["id"]))
    if row.get("grupo_recorrencia"):
        q = q.eq("grupo_recorrencia", row["grupo_recorrencia"])
    else:
        q = q.eq("descricao", row["descricao"])
        if tabela == "despesas":
            q = q.eq("recorrente", True).is_("parcela_total", "null")
        if row.get("tipo_lancamento_id"):
            q = q.eq("tipo_lancamento_id", str(row["tipo_lancamento_id"]))
        else:
            q = q.is_("tipo_lancamento_id", "null")
        if row.get("criado_por"):
            q = q.eq("criado_por", str(row["criado_por"]))
    return sorted(q.order("competencia").execute().data or [], key=lambda r: str(r["competencia"]))


def resumo(tabela: str, item_id: str, db: Client, tenant_id: str | None = None) -> dict:
    """{recorrente, ate, meses} — para o modal de edição preencher "Repetir até"."""
    row = _carregar(tabela, item_id, db, tenant_id)
    futuras = serie_futura(tabela, row, db)
    marcada = bool(row.get("recorrente")) or bool(futuras)
    ultimo = _mes(futuras[-1]["competencia"]) if futuras else _mes(row["competencia"])
    return {"recorrente": marcada, "ate": ultimo.isoformat() if marcada else None, "meses": len(futuras) + 1}


def _meses_entre(inicio: date, fim: date) -> int:
    return (fim.year - inicio.year) * 12 + (fim.month - inicio.month)


def _remover(tabela: str, linhas: list[dict], preservar_aprovadas: bool, db: Client) -> None:
    pago = _CFG[tabela]["pago"]
    alvo = [r for r in linhas if not r.get(pago)]
    if preservar_aprovadas and any(r.get("status") == "aprovada" for r in alvo):
        raise _erro(
            403,
            "Há ocorrências futuras já aprovadas nesta série. Só Admin ou Gestor podem removê-las.",
        )
    ids = [r["id"] for r in alvo]
    if not ids:
        return
    if _CFG[tabela]["remover"] == "soft":
        db.table(tabela).update({"status": "excluida"}).in_("id", ids).execute()
    else:
        db.table(tabela).delete().in_("id", ids).execute()


def _marcar(tabela: str, ids: list[str], campos: dict, db: Client) -> None:
    if not ids:
        return
    try:
        db.table(tabela).update(campos).in_("id", ids).execute()
    except Exception as e:  # noqa: BLE001 — sem a 0048: só a coluna que existir
        if "grupo_recorrencia" not in str(e) and "recorrente" not in str(e) and "column" not in str(e).lower():
            raise
        if tabela == "despesas" and "recorrente" in campos:
            db.table(tabela).update({"recorrente": campos["recorrente"]}).in_("id", ids).execute()


def _copia(tabela: str, row: dict, mes: date, i: int, grupo: str, usuario: UsuarioAtual) -> dict:
    from app.permissions import tem_permissao
    from app.services.financeiro_service import (
        _somar_meses_preservando_dia, campos_aprovacao,
    )
    comuns = ("descricao", "valor", "centro_custo", "tipo_lancamento_id", "custo_tipo", "banco_id",
              "criado_por", "tenant_id")
    extras = ("subcategoria", "categoria") if tabela == "despesas" else ("observacao",)
    nova = {k: row.get(k) for k in comuns + extras if row.get(k) is not None}
    nova["competencia"] = mes.isoformat()
    if row.get("data_vencimento"):
        venc = date.fromisoformat(str(row["data_vencimento"])[:10])
        nova["data_vencimento"] = _somar_meses_preservando_dia(venc, i).isoformat()
    nova["recorrente"] = True
    nova["grupo_recorrencia"] = grupo
    if tabela == "despesas":
        # Mesma regra de criar_despesa: só nasce aprovada para quem aprova.
        pode = usuario.role in ("admin", "gestor") and tem_permissao(usuario.permissions, "aprovacoes", "aprovar")
        nova.update(campos_aprovacao(usuario.user_id) if pode else {"status": "pendente"})
    else:
        # Receita não passa por aprovação (22/10/2026).
        nova.update(campos_aprovacao(usuario.user_id))
    return nova


def _inserir(tabela: str, novas: list[dict], db: Client) -> None:
    if not novas:
        return
    try:
        db.table(tabela).insert(novas).execute()
    except Exception as e:  # noqa: BLE001 — sem a 0048
        if "grupo_recorrencia" not in str(e) and "column" not in str(e).lower():
            raise
        for n in novas:
            n.pop("grupo_recorrencia", None)
            if tabela == "receitas_outras":
                n.pop("recorrente", None)
        db.table(tabela).insert(novas).execute()


def aplicar(
    tabela: str,
    item_id: str,
    recorrente: bool,
    repetir_ate: date | None,
    usuario: UsuarioAtual,
    db: Client,
    preservar_aprovadas: bool = False,
) -> None:
    """Aplica a recorrência pedida na edição (ver docstring do módulo)."""
    row = _carregar(tabela, item_id, db, getattr(usuario, "tenant_id", None))
    futuras = serie_futura(tabela, row, db)
    inicio = _mes(row["competencia"])

    if not recorrente:
        if futuras:
            _remover(tabela, futuras, preservar_aprovadas, db)
        if row.get("recorrente") or row.get("grupo_recorrencia"):
            _marcar(tabela, [row["id"]], {"recorrente": False, "grupo_recorrencia": None}, db)
        return

    if (row.get("parcela_total") or 1) > 1:
        raise _erro(422, "Despesa parcelada não pode ser recorrente. Deixe 1 parcela para repetir todo mês.")
    if not repetir_ate:
        raise _erro(422, "Informe até quando repetir.")
    fim = _mes(repetir_ate)
    if fim < inicio:
        raise _erro(422, "“Repetir até” não pode ser antes da competência do lançamento.")
    if _meses_entre(inicio, fim) + 1 > MAX_MESES:
        raise _erro(422, f"Recorrência limitada a {MAX_MESES} meses.")

    # Encurtou: sai o que passou do novo fim (só em aberto).
    depois = [r for r in futuras if _mes(r["competencia"]) > fim]
    if depois:
        _remover(tabela, depois, preservar_aprovadas, db)
    ficam = [r for r in futuras if _mes(r["competencia"]) <= fim]

    grupo = row.get("grupo_recorrencia") or str(uuid4())
    _marcar(tabela, [row["id"]] + [r["id"] for r in ficam], {"recorrente": True, "grupo_recorrencia": grupo}, db)

    # Liga/estende: cria os meses que faltam. Um mês que já tem lançamento
    # igual (mesma descrição/subitem/quem criou) não ganha outro — evita
    # duplicar séries antigas, sem marcador.
    from app.services.financeiro_service import _somar_meses
    existentes = {_mes(r["competencia"]) for r in ficam}
    if not ficam and _meses_entre(inicio, fim) > 0:
        q = (db.table(tabela).select("competencia").neq("status", "excluida")
             .gt("competencia", inicio.isoformat()).lte("competencia", fim.isoformat())
             .eq("descricao", row["descricao"]).neq("id", row["id"]))
        if row.get("tipo_lancamento_id"):
            q = q.eq("tipo_lancamento_id", str(row["tipo_lancamento_id"]))
        if row.get("criado_por"):
            q = q.eq("criado_por", str(row["criado_por"]))
        existentes |= {_mes(r["competencia"]) for r in (q.execute().data or [])}
    novas = []
    for i in range(1, _meses_entre(inicio, fim) + 1):
        mes = _somar_meses(inicio, i)
        if mes not in existentes:
            novas.append(_copia(tabela, row, mes, i, grupo, usuario))
    _inserir(tabela, novas, db)
