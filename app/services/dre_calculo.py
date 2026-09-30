"""
MX Seguros — DRE-IA | Motor de cálculo da DRE Previsto x Realizado.

Módulo PURO (sem banco, sem FastAPI): recebe contas e valores mensais e
devolve a DRE montada. É o "lugar único" das regras da §4 do
PLANEJAMENTO_DRE.md — a API só busca os dados e chama `montar`. Por ser puro,
os testes (tests/test_dre_calculo.py) exercitam as regras sem Supabase.

Estrutura: a da planilha "DRE - MX SEGUROS" (aba Previsto x Realizado).
Diferenças deliberadas em relação à planilha (ver §2.3 do plano):
- P1: 1.1 soma TODAS as contas do grupo (a planilha somava só uma).
- P2: % Meta compara sempre com o previsto (a planilha usava a média nas contas).
- P3/P4: divisões impossíveis viram None ("—"), nunca #REF!/#DIV/0!.
- P5: soma por grupo, nunca por intervalo de linhas.
- % Meta usa (realizado − previsto) / |previsto|, não realizado/previsto − 1:
  as duas coincidem com previsto positivo, mas com previsto NEGATIVO (ex.:
  resultado líquido previsto de −100 e realizado de −50, que é melhor) a
  fórmula da planilha inverteria o sinal e pintaria de vermelho uma melhora.
"""
from __future__ import annotations

from typing import Iterable

# código -> (nome, natureza)
GRUPOS: dict[str, tuple[str, str]] = {
    "1.1": ("Receitas de vendas", "receita"),
    "2.1": ("Despesas variáveis", "despesa"),
    "4.1": ("Despesas com pessoal", "despesa"),
    "4.2": ("Despesa comercial", "despesa"),
    "4.3": ("Despesa administrativa e operacional", "despesa"),
    "4.4": ("Despesa com veículos", "despesa"),
    "4.5": ("Serviços prestados por terceiros", "despesa"),
    "4.6": ("Despesa financeira", "despesa"),
    "7.1": ("Despesas não operacionais", "despesa"),
    "7.2": ("Despesas com investimentos e ativo imobilizado", "despesa"),
    "8.1": ("Receitas não operacionais", "receita"),
}
FIXAS = ("4.1", "4.2", "4.3", "4.4", "4.5", "4.6")

# Ordem das linhas da planilha. ("secao", cod, nome) | ("grupo", cod) |
# ("resultado", cod, nome, chave, sentido)
ESTRUTURA: list[tuple] = [
    ("secao", "1", "Receitas de vendas"),
    ("grupo", "1.1"),
    ("secao", "2", "Despesas variáveis"),
    ("grupo", "2.1"),
    ("resultado", "3", "Lucro bruto / Margem de contribuição", "mc", "maior_melhor"),
    ("secao", "4", "Despesas fixas"),
    *[("grupo", g) for g in FIXAS],
    ("resultado", "5", "Total despesas fixas", "fixas", "menor_melhor"),
    ("resultado", "6", "Resultado operacional", "ro", "maior_melhor"),
    ("secao", "7", "Despesas não operacionais"),
    ("grupo", "7.1"),
    ("grupo", "7.2"),
    ("secao", "8", "Receitas não operacionais"),
    ("grupo", "8.1"),
    ("resultado", "9", "Resultado líquido", "rl", "maior_melhor"),
]

VISOES = ("mes", "acumulado", "anual")


def _r2(v: float | None) -> float | None:
    return None if v is None else round(v, 2)


def pct_meta(realizado: float | None, previsto: float | None) -> float | None:
    if realizado is None or not previsto:
        return None
    return (realizado - previsto) / abs(previsto)


def av(valor: float | None, receita: float | None) -> float | None:
    if valor is None or not receita:
        return None
    return valor / receita


def derivar(g: dict[str, float]) -> dict[str, float | None]:
    """Linhas de resultado a partir dos totais de grupo (§4)."""
    rec = g["1.1"]
    mc = rec - g["2.1"]
    fixas = sum(g[c] for c in FIXAS)
    ro = mc - fixas
    rl = ro - g["7.1"] - g["7.2"] + g["8.1"]
    pe_op = (fixas / mc) * rec if mc > 0 else None
    pe_fin = ((fixas + g["7.1"] + g["7.2"]) / mc) * rec if mc > 0 else None
    return {"rec": rec, "mc": mc, "fixas": fixas, "ro": ro, "rl": rl, "pe_op": pe_op, "pe_fin": pe_fin}


def _sentido(natureza: str) -> str:
    return "maior_melhor" if natureza == "receita" else "menor_melhor"


class _Base:
    """Somas por conta/grupo para um conjunto de meses."""

    def __init__(self, contas: list[dict], valores: dict[str, dict[int, float]]):
        self.contas = contas
        self.valores = valores

    def conta(self, cid: str, meses: Iterable[int]) -> float:
        v = self.valores.get(cid, {})
        return sum(v.get(m, 0.0) for m in meses)

    def grupos(self, meses: Iterable[int]) -> dict[str, float]:
        meses = list(meses)
        out = {g: 0.0 for g in GRUPOS}
        for c in self.contas:
            if c["grupo"] in out:
                out[c["grupo"]] += self.conta(c["id"], meses)
        return out


def montar(
    contas: list[dict],
    real: dict[str, dict[int, float]],
    prev: dict[str, dict[int, float]],
    meses_com_real: set[int],
    mes_ref: int,
    visao: str,
) -> dict:
    """Monta a DRE.

    contas: [{"id", "nome", "grupo", "ativo"}] — grupo None fica fora (o
        serviço reporta como "não classificado").
    real/prev: {conta_id: {mes: valor}} — valores positivos (despesa é
        positiva no seu grupo; a conta de sinal fica na estrutura).
    meses_com_real: meses do ano com ALGUM lançamento. Mês sem lançamento é
        "sem realizado" (None, exibe "—"), diferente de zero.
    """
    if visao not in VISOES:
        raise ValueError(f"visao inválida: {visao}")
    contas = [c for c in contas if c.get("grupo") in GRUPOS]
    R, P = _Base(contas, real), _Base(contas, prev)

    if visao == "mes":
        meses = [mes_ref]
    elif visao == "acumulado":
        meses = list(range(1, mes_ref + 1))
    else:
        meses = list(range(1, 13))

    meses_r = [m for m in meses if m in meses_com_real]
    tem_real = bool(meses_r)
    # No anual o previsto de comparação é o dos meses com realizado —
    # comparar 10 meses realizados com 12 de meta pintaria tudo de vermelho.
    meses_p = meses_r if visao == "anual" else meses

    gr = R.grupos(meses_r) if tem_real else None
    gp = P.grupos(meses_p)
    dr = derivar(gr) if gr is not None else None
    dp = derivar(gp)
    rec_r = dr["rec"] if dr else None

    por_mes_r = {m: derivar(R.grupos([m])) for m in range(1, 13) if m in meses_com_real}
    por_mes_p = {m: derivar(P.grupos([m])) for m in range(1, 13)}

    def linha(tipo, codigo, nome, natureza, sentido, r, p, extra=None):
        d = {
            "tipo": tipo, "codigo": codigo, "nome": nome, "natureza": natureza, "sentido": sentido,
            "previsto": _r2(p), "realizado": _r2(r),
            "desvio": None if r is None else _r2(r - p),
            "pct_meta": pct_meta(r, p), "av": av(r, rec_r),
        }
        if extra:
            d.update(extra)
        return d

    def anual_extra(fn_r, fn_p):
        """Série mensal + média/acumulado para a visão 12 meses."""
        if visao != "anual":
            return None
        serie = [{"mes": m, "previsto": _r2(fn_p(m)), "realizado": _r2(fn_r(m)) if m in meses_com_real else None}
                 for m in range(1, 13)]
        acumulado = sum(fn_r(m) for m in meses_r) if tem_real else None
        return {
            "por_mes": serie,
            "acumulado": _r2(acumulado),
            # Média sobre os meses COM realizado, não sobre 12 (plano §4).
            "media_mensal": _r2(acumulado / len(meses_r)) if tem_real else None,
        }

    linhas: list[dict] = []
    for item in ESTRUTURA:
        if item[0] == "secao":
            linhas.append({"tipo": "secao", "codigo": item[1], "nome": item[2]})
        elif item[0] == "grupo":
            g = item[1]
            nome, natureza = GRUPOS[g]
            filhas = []
            for c in sorted((c for c in contas if c["grupo"] == g), key=lambda c: c["nome"].lower()):
                cid = c["id"]
                filhas.append(linha(
                    "conta", cid, c["nome"].strip(), natureza, _sentido(natureza),
                    R.conta(cid, meses_r) if tem_real else None, P.conta(cid, meses_p),
                    {"ativo": c.get("ativo", True),
                     **(anual_extra(lambda m, cid=cid: R.conta(cid, [m]), lambda m, cid=cid: P.conta(cid, [m])) or {})},
                ))
            linhas.append(linha(
                "grupo", g, nome, natureza, _sentido(natureza),
                gr[g] if gr else None, gp[g],
                {"contas": filhas,
                 **(anual_extra(lambda m, g=g: R.grupos([m])[g], lambda m, g=g: P.grupos([m])[g]) or {})},
            ))
        else:
            _, cod, nome, chave, sentido = item
            linhas.append(linha(
                "resultado", cod, nome, "resultado", sentido,
                dr[chave] if dr else None, dp[chave],
                anual_extra(lambda m, k=chave: por_mes_r[m][k], lambda m, k=chave: por_mes_p[m][k]),
            ))

    def kpi(chave, sentido):
        r = dr[chave] if dr else None
        p = dp[chave]
        return {"realizado": _r2(r), "previsto": _r2(p), "pct_meta": pct_meta(r, p),
                "av": av(r, rec_r), "sentido": sentido}

    def folga(pe):
        return None if (pe is None or not rec_r) else (rec_r - pe) / rec_r

    return {
        "visao": visao,
        "meses": meses,
        "meses_com_realizado": sorted(meses_com_real),
        "ultimo_mes_realizado": max(meses_com_real) if meses_com_real else None,
        "kpis": {
            "receita": kpi("rec", "maior_melhor"),
            "margem": kpi("mc", "maior_melhor"),
            "resultado_operacional": kpi("ro", "maior_melhor"),
            "resultado_liquido": kpi("rl", "maior_melhor"),
        },
        "linhas": linhas,
        "mensal": [
            {"mes": m,
             "receita": _r2(por_mes_r[m]["rec"]) if m in por_mes_r else None,
             "resultado_liquido": _r2(por_mes_r[m]["rl"]) if m in por_mes_r else None,
             "rl_previsto": _r2(por_mes_p[m]["rl"])}
            for m in range(1, 13)
        ],
        "ponto_equilibrio": {
            "receita": _r2(rec_r),
            "operacional": _r2(dr["pe_op"]) if dr else None,
            "financeiro": _r2(dr["pe_fin"]) if dr else None,
            "folga_op": folga(dr["pe_op"]) if dr else None,
            "folga_fin": folga(dr["pe_fin"]) if dr else None,
        },
    }
