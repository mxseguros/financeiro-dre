"""
MX Seguros — DRE-IA | Conciliação Visão Geral × DRE (usada pelo Monitor).

As duas telas mostram "receita" com regras diferentes:
  • Visão Geral (box "Previsto do período", receitas) —
    dashboard_service.resumo_visao_geral: comissões + receitas_outras da
    competência (pendente/aprovada), de QUALQUER classificação.
  • DRE (linha "Receita") — dre_gerencial_service: só o grupo 1.1
    (Receitas de vendas), só pendente/aprovada, comissões líquidas de
    estorno quando a conta de comissões está no grupo 1.1.

Os totais vêm dos MESMOS cálculos que alimentam cada tela (nada recalculado
por fora), e a diferença é decomposta em motivos que somam centavo a
centavo. O que não fechar aparece como "diferença não explicada" — sinal de
regra nova em alguma das telas que esta conciliação ainda não conhece.

Somente leitura. Só para um único mês: a DRE trabalha por mês de referência.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date

from supabase import Client

from app.auth import UsuarioAtual
from app.services import dre_calculo
from app.services.classificacao_service import codigos_fora_dre
from app.services.dashboard_service import resumo_visao_geral
from app.services.somente_dre import ids_somente_dre
from app.services.dre_gerencial_service import _STATUS_REALIZADO, _contas, _todos, buscar_previsto_realizado

logger = logging.getLogger(__name__)

GRUPO_RECEITA = "1.1"


def _nome_grupo(cod: str | None) -> str:
    if not cod or cod not in dre_calculo.GRUPOS:
        return "sem grupo na DRE"
    return f"{cod} {dre_calculo.GRUPOS[cod][0]}"


def _subitens(itens: list[tuple[str, float]], limite: int = 5) -> list[dict]:
    soma: dict[str, list] = defaultdict(lambda: [0, 0.0])
    for nome, v in itens:
        soma[nome][0] += 1
        soma[nome][1] += v
    ordenado = sorted(soma.items(), key=lambda i: -abs(i[1][1]))
    return [{"nome": n, "qtd": q, "valor": round(v, 2)} for n, (q, v) in ordenado[:limite]]


async def conciliar(usuario: UsuarioAtual, db: Client, inicio: date, fim: date, base: str = "competencia") -> dict:
    if base != "competencia":
        return {"disponivel": False, "motivo": "A conciliação com a DRE é por competência, e os filtros das telas "
                                               "usam a Data de Pagamento — compare pela própria tela da DRE."}
    if (inicio.year, inicio.month) != (fim.year, fim.month):
        return {"disponivel": False, "motivo": "A conciliação com a DRE é feita mês a mês — escolha um único mês."}

    ini = date(inicio.year, inicio.month, 1).isoformat()
    ult = fim.isoformat()
    try:
        resumo_vg = await resumo_visao_geral(inicio, fim, db)
        so_dre = await ids_somente_dre(db)
        fora = codigos_fora_dre(db)
        dre_tela = await buscar_previsto_realizado(inicio.year, inicio.month, "mes", db)
        contas = {c["id"]: c for c in await _contas(db)}
        receitas = await _todos(lambda: db.table("receitas_outras")
                                .select("tipo_lancamento_id, valor, status, custo_tipo")
                                .gte("competencia", ini).lte("competencia", ult))
        despesas = await _todos(lambda: db.table("despesas")
                                .select("tipo_lancamento_id, valor, custo_tipo")
                                .gte("competencia", ini).lte("competencia", ult)
                                .in_("status", _STATUS_REALIZADO))
        comissoes = await _todos(lambda: db.table("comissoes").select("valor")
                                 .gte("competencia", ini).lte("competencia", ult), opcional="comissoes")
        estornos = await _todos(lambda: db.table("estornos").select("valor")
                                .gte("competencia_estorno", ini).lte("competencia_estorno", ult), opcional="estornos")
    except Exception as e:  # noqa: BLE001
        logger.warning("conciliacao_erro: %s", e)
        return {"disponivel": False, "motivo": "Não foi possível carregar os dados da DRE para conciliar."}

    vg = float(resumo_vg.previsto.receitas or 0)
    dre_rec = float((dre_tela.get("kpis") or {}).get("receita", {}).get("realizado") or 0)

    def grupo_de(conta_id: str | None) -> str | None:
        g = (contas.get(conta_id or "") or {}).get("grupo")
        return g if g in dre_calculo.GRUPOS else None

    def nome_subitem(conta_id: str | None) -> str:
        return (contas.get(conta_id or "") or {}).get("nome") or "Sem subitem"

    motivos: list[dict] = []

    # Excluídas/rejeitadas ficam fora nas DUAS telas (a Visão Geral passou a
    # filtrar status em 19/10/2026), então não geram diferença.
    # 1) Receitas válidas fora do grupo 1.1 — por grupo de destino na DRE.
    validas_todas = [r for r in receitas if r.get("status") in (*_STATUS_REALIZADO, None)]
    # Classificação fora da DRE (0041): fora da DRE inteira, mas na Visão Geral
    # (salvo "Constar apenas na DRE", que tira das duas — sem diferença).
    fora_dre = [r for r in validas_todas if r.get("custo_tipo") in fora and r.get("tipo_lancamento_id") not in so_dre]
    validas_todas = [r for r in validas_todas if r.get("custo_tipo") not in fora]
    # "Constar apenas na DRE": fora da Visão Geral, dentro da DRE (motivo abaixo).
    apenas_dre = [r for r in validas_todas if r.get("tipo_lancamento_id") in so_dre]
    validas = [r for r in validas_todas if r.get("tipo_lancamento_id") not in so_dre]
    por_grupo: dict[str | None, list[dict]] = defaultdict(list)
    for r in validas:
        g = grupo_de(r.get("tipo_lancamento_id"))
        if g != GRUPO_RECEITA:
            por_grupo[g].append(r)
    for g, itens in sorted(por_grupo.items(), key=lambda i: -sum(float(r["valor"] or 0) for r in i[1])):
        if g is None:
            explicacao = ("O subitem não está ligado a nenhum grupo da DRE: a receita entra na Visão Geral, "
                          "mas fica FORA de todos os totais da DRE (aviso \"sem grupo na DRE\").")
            acao = "classificar"
        elif dre_calculo.GRUPOS[g][1] == "despesa":
            explicacao = (f"O subitem está ligado a um grupo de DESPESA ({_nome_grupo(g)}): na DRE este valor "
                          "soma como despesa. Provável erro de cadastro do subitem.")
            acao = "classificar"
        else:
            explicacao = (f"Na DRE aparecem em {_nome_grupo(g)}, abaixo do Resultado operacional. Somam no "
                          "Resultado líquido, mas não na linha Receita.")
            acao = "revisar_classificacao"
        motivos.append({
            "chave": f"grupo_{g or 'sem'}",
            "rotulo": f"Receitas em {_nome_grupo(g)}" if g else "Receitas sem grupo na DRE",
            "qtd": len(itens),
            "valor": round(sum(float(r["valor"] or 0) for r in itens), 2),
            "explicacao": explicacao,
            "subitens": _subitens([(nome_subitem(r.get("tipo_lancamento_id")), float(r["valor"] or 0)) for r in itens]),
            "acao": acao,
        })

    def motivo_1_1(chave, rotulo, itens, sinal, explicacao):
        if itens:
            motivos.append({
                "chave": chave, "rotulo": rotulo, "qtd": len(itens),
                "valor": sinal * round(sum(float(r["valor"] or 0) for r in itens), 2),
                "explicacao": explicacao,
                "subitens": _subitens([(nome_subitem(r.get("tipo_lancamento_id")), float(r["valor"] or 0)) for r in itens]),
                "acao": None,
            })

    no_1_1 = lambda r: grupo_de(r.get("tipo_lancamento_id")) == GRUPO_RECEITA  # noqa: E731
    # Só DRE: conta na linha Receita da DRE, fora da Visão Geral.
    motivo_1_1("somente_dre", "Receitas \"Constar apenas na DRE\"",
               [r for r in apenas_dre if no_1_1(r)], -1,
               "O subitem está marcado para constar só na DRE: a receita entra na linha Receita da DRE, "
               "mas fica fora da Visão Geral. Diferença esperada.")

    motivo_1_1("classificacao_fora_dre", "Receitas com classificação fora da DRE", fora_dre, 1,
               "A classificação do lançamento está com \"Usada na DRE\" desmarcada em Configurações: "
               "a receita conta na Visão Geral, mas fica fora da DRE. Diferença esperada.")

    # 2) Comissões: na DRE vão para a conta de papel "comissoes", líquidas de estorno.
    tot_com = sum(float(c["valor"] or 0) for c in comissoes)
    tot_est = sum(float(e["valor"] or 0) for e in estornos)
    conta_com = next((cid for cid, c in contas.items() if c.get("papel") == "comissoes"), None)
    g_com = grupo_de(conta_com)
    if g_com == GRUPO_RECEITA:
        if tot_est:
            motivos.append({
                "chave": "estornos", "rotulo": "Estornos de comissão", "qtd": len(estornos), "valor": round(tot_est, 2),
                "explicacao": "A DRE desconta os estornos da receita de comissões. A Receita Bruta da Visão Geral "
                              "é antes dos estornos.",
                "subitens": [], "acao": None,
            })
    elif tot_com or tot_est:
        motivos.append({
            "chave": "comissoes", "rotulo": "Comissões fora de Receitas de vendas",
            "qtd": len(comissoes), "valor": round(tot_com, 2),
            "explicacao": (f"A conta de comissões está em {_nome_grupo(g_com)}, não em 1.1 Receitas de vendas"
                           if g_com else "Não há conta de comissões ligada à DRE")
                          + ": a Visão Geral soma as comissões na receita, a linha Receita da DRE não.",
            "subitens": [], "acao": "classificar",
        })

    explicado = round(sum(m["valor"] for m in motivos), 2)
    diferenca = round(vg - dre_rec, 2)
    residual = round(diferenca - explicado, 2)

    # Despesas fora da DRE: não mexem na receita, mas a DRE as deixa fora dos totais.
    desp_sem = [d for d in despesas
                if grupo_de(d.get("tipo_lancamento_id")) is None and d.get("custo_tipo") not in fora]

    return {
        "disponivel": True,
        "mes": ini[:7],
        "receita_visao_geral": round(vg, 2),
        "receita_dre": round(dre_rec, 2),
        "diferenca": diferenca,
        "motivos": motivos,
        "nao_explicado": residual if abs(residual) >= 0.01 else 0.0,
        "despesas_sem_grupo": {
            "qtd": len(desp_sem),
            "valor": round(sum(float(d["valor"] or 0) for d in desp_sem), 2),
            "subitens": _subitens([(nome_subitem(d.get("tipo_lancamento_id")), float(d["valor"] or 0)) for d in desp_sem]),
        },
    }


def insights_da_conciliacao(c: dict) -> list[dict]:
    """Cartões do Monitor (entram na contagem por severidade e no resumo da IA)."""
    if not c.get("disponivel"):
        return []
    out: list[dict] = []
    if c["diferenca"]:
        out.append({
            "tipo": "conciliacao_receita",
            "severidade": "aviso" if c["nao_explicado"] or any(m["acao"] in ("classificar", "corrigir_visao_geral") for m in c["motivos"]) else "info",
            "titulo": "Receita da Visão Geral ≠ Receita da DRE",
            "detalhe": (f"Visão Geral {_brl(c['receita_visao_geral'])} × DRE {_brl(c['receita_dre'])} — diferença de "
                        f"{_brl(c['diferenca'])}. " + "; ".join(f"{m['rotulo']}: {_brl(m['valor'])}" for m in c["motivos"])
                        + (f"; não explicado: {_brl(c['nao_explicado'])}" if c["nao_explicado"] else "") + "."),
            "valor": abs(c["diferenca"]),
        })
    ds = c["despesas_sem_grupo"]
    if ds["qtd"]:
        out.append({
            "tipo": "sem_grupo_dre",
            "severidade": "aviso",
            "titulo": f"{ds['qtd']} despesa(s) sem grupo na DRE",
            "detalhe": (f"{_brl(ds['valor'])} ficam fora de todos os totais da DRE. Ex.: "
                        + ", ".join(f"\"{s['nome']}\"" for s in ds["subitens"][:3])
                        + ". Defina o subitem em Lançamentos ou ligue o subitem a um grupo da DRE em Configurações."),
            "valor": ds["valor"],
        })
    return out


def _brl(v: float) -> str:
    s = f"{abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"-R$ {s}" if v < 0 else f"R$ {s}"
