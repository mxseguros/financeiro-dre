"""
MX Seguros — DRE-IA | Monitor de apontamentos (vigilância determinística).

Gera "insights" a partir dos dados que já existem — sem LLM, sem cron, sem
gravar nada. Roda sob demanda quando o usuário abre a tela Monitor.

Checagens (Fase 1):
  • Duplicatas — mesma descrição + valor na mesma competência (mês).
  • Pendentes envelhecendo — despesas/ordens pendentes há mais de N dias.
  • Outliers de valor — despesa do mês muito acima da média histórica do subitem.

Respeita a visibilidade por perfil (Comercial/Contador só veem o que lançaram).
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import anthropic
from supabase import Client

from app.auth import UsuarioAtual
from app.config import cfg
from app.services import conciliacao_service

logger = logging.getLogger(__name__)

DIAS_PENDENTE = 3      # pendente há mais de N dias vira alerta
FATOR_OUTLIER = 3.0    # valor > FATOR × média do subitem = atípico
MESES_JANELA = 6       # meses ANTES do período usados só como base dos outliers
MIN_HIST_OUTLIER = 3   # nº mínimo de amostras p/ calcular média confiável
MAX_INSIGHTS = 60
MODELO_RESUMO = "claude-opus-4-8"   # trocável por "claude-haiku-4-5" p/ reduzir custo


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _brl(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _primeiro_dia_meses_antes(d: date, meses: int) -> date:
    y, m = d.year, d.month - meses
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _todas_as_linhas(q, pagina: int = 1000) -> list[dict]:
    """Pagina a consulta: o PostgREST corta em max_rows sem avisar."""
    linhas: list[dict] = []
    while True:
        lote = q.range(len(linhas), len(linhas) + pagina - 1).execute().data or []
        linhas += lote
        if len(lote) < pagina:
            return linhas


async def gerar_insights(usuario: UsuarioAtual, db: Client, inicio: date, fim: date, base: str = "competencia") -> dict:
    """Pontos de atenção do PERÍODO escolhido (o mesmo das demais telas).

    Antes a janela era "6 meses atrás em diante", sem limite à frente: as
    parcelas e recorrências futuras (até 2030+) entravam nas contas, e o
    Monitor mostrava pendências e totais que nenhuma outra tela batia.
    O histórico anterior ao período serve só de base para outliers e
    para o gap de recorrência — não entra em nenhum total.
    """
    so_proprios = usuario.role in ("comercial", "contador")
    hist_inicio = _primeiro_dia_meses_antes(inicio, MESES_JANELA)

    q = (
        db.table("despesas")
        .select("id, descricao, valor, competencia, data_vencimento, status, criado_em, recorrente, banco_id, "
                + ("data_ref, " if base == "pagamento" else "") + "tipo_lancamento_id, subitens_lancamento(nome)")
        .neq("status", "excluida")
    )
    if base == "pagamento":
        # Histórico por competência + o que tem pagamento (ou vencimento) no período,
        # mesmo com competência fora da janela (ex.: pago adiantado).
        q = q.or_(f"and(competencia.gte.{hist_inicio.isoformat()},competencia.lte.{fim.isoformat()}),"
                  f"and(data_ref.gte.{inicio.isoformat()},data_ref.lte.{fim.isoformat()})")
    else:
        q = q.gte("competencia", hist_inicio.isoformat()).lte("competencia", fim.isoformat())
    q = (
        q.order("competencia")
        .order("id")
    )
    if so_proprios:
        q = q.eq("criado_por", usuario.user_id)
    todas = _todas_as_linhas(q)

    ini_s, fim_s = inicio.isoformat(), fim.isoformat()
    # Dia (base "data"): o período é pelo vencimento; o histórico continua
    # sendo os meses de competência ANTERIORES ao mês do início.
    corte_hist = date(inicio.year, inicio.month, 1).isoformat()
    if base == "pagamento":
        do_periodo = [d for d in todas if ini_s <= (d.get("data_ref") or "")[:10] <= fim_s]
    elif base == "data":
        do_periodo = [d for d in todas if ini_s <= (d.get("data_vencimento") or "")[:10] <= fim_s]
    else:
        do_periodo = [d for d in todas if (d.get("competencia") or "") >= ini_s]
    ids_periodo = {d["id"] for d in do_periodo}
    historico = [d for d in todas if (d.get("competencia") or "") < corte_hist and d["id"] not in ids_periodo]
    # Rejeitada não é gasto: fora de duplicata, sem banco e outlier.
    validas = [d for d in do_periodo if d.get("status") != "rejeitada"]
    mes_ref = fim.strftime("%Y-%m")

    insights: list[dict] = []
    insights += _duplicatas(validas)
    insights += _pendentes_despesas(do_periodo)
    insights += _sem_banco(validas)
    insights += _outliers(validas, [d for d in historico if d.get("status") != "rejeitada"])
    insights += _gap_recorrencia(todas, mes_ref)
    insights += _ordens_pendentes(db, usuario, so_proprios, inicio, fim)
    # Por que a receita da Visão Geral difere da linha Receita da DRE.
    conciliacao = await conciliacao_service.conciliar(usuario, db, inicio, fim, base)
    insights += conciliacao_service.insights_da_conciliacao(conciliacao)

    ordem = {"critico": 0, "aviso": 1, "info": 2}
    insights.sort(key=lambda i: (ordem.get(i["severidade"], 3), -(i.get("valor") or 0)))

    resumo = {sev: sum(1 for i in insights if i["severidade"] == sev) for sev in ("critico", "aviso", "info")}
    return {
        "gerado_em": datetime.now(timezone.utc).isoformat(),
        "periodo": {"inicio": ini_s, "fim": fim.isoformat()},
        "conciliacao": conciliacao,
        "resumo": resumo,
        "total": len(insights),
        "insights": insights[:MAX_INSIGHTS],
    }


def _duplicatas(despesas: list[dict]) -> list[dict]:
    grupos: dict[tuple, list[dict]] = defaultdict(list)
    for d in despesas:
        desc = (d.get("descricao") or "").strip().lower()
        if not desc:
            continue
        chave = (desc, round(_num(d.get("valor")), 2), (d.get("competencia") or "")[:7])
        grupos[chave].append(d)
    out = []
    for (_desc, valor, mes), itens in grupos.items():
        if len(itens) >= 2:
            out.append({
                "tipo": "duplicata",
                "severidade": "aviso",
                "titulo": f"{len(itens)} lançamentos idênticos",
                "detalhe": f'"{itens[0].get("descricao")}" — {_brl(valor)} em {mes}',
                "valor": valor * len(itens),
            })
    return out


def _pendentes_despesas(despesas: list[dict]) -> list[dict]:
    limite = datetime.now(timezone.utc) - timedelta(days=DIAS_PENDENTE)
    velhas = [
        d for d in despesas
        if d.get("status") == "pendente" and (_parse_dt(d.get("criado_em")) or datetime.now(timezone.utc)) < limite
    ]
    if not velhas:
        return []
    total = sum(_num(d.get("valor")) for d in velhas)
    return [{
        "tipo": "pendente_despesa",
        "severidade": "aviso",
        "titulo": f"{len(velhas)} despesa(s) pendentes há +{DIAS_PENDENTE} dias",
        "detalhe": f"Aguardando aprovação — total {_brl(total)}",
        "valor": total,
    }]


def _sem_banco(despesas: list[dict]) -> list[dict]:
    """Despesas sem banco vinculado — quebram a visão Por Banco e a conciliação."""
    sem = [d for d in despesas if not d.get("banco_id")]
    if not sem:
        return []
    total = sum(_num(d.get("valor")) for d in sem)
    ex = (sem[0].get("descricao") or "").strip()
    return [{
        "tipo": "sem_banco",
        "severidade": "aviso",
        "titulo": f"{len(sem)} despesa(s) sem banco vinculado",
        "detalhe": f'Ex.: "{ex}" — vincule o banco para a visão Por Banco. Total sem banco: {_brl(total)}.',
        "valor": total,
    }]


def _outliers(do_periodo: list[dict], historico: list[dict]) -> list[dict]:
    """Despesa do período muito acima da média do subitem nos meses anteriores."""
    hist: dict[str, list[float]] = defaultdict(list)
    for d in historico:
        tid = d.get("tipo_lancamento_id")
        if tid:
            hist[tid].append(_num(d.get("valor")))
    out = []
    for d in do_periodo:
        vals = hist.get(d.get("tipo_lancamento_id") or "") or []
        if len(vals) < MIN_HIST_OUTLIER:
            continue
        media = sum(vals) / len(vals)
        v = _num(d.get("valor"))
        if media > 0 and v > FATOR_OUTLIER * media:
            nome = (d.get("subitens_lancamento") or {}).get("nome") or "subitem"
            out.append({
                "tipo": "outlier",
                "severidade": "aviso",
                "titulo": "Valor atípico",
                "detalhe": f'"{d.get("descricao")}" {_brl(v)} — média de "{nome}" é {_brl(media)}',
                "valor": v,
            })
    return out


def _gap_recorrencia(despesas: list[dict], mes_atual: str) -> list[dict]:
    """Despesa recorrente que vinha lançando mas NÃO tem registro no mês de referência."""
    mes_ant = _primeiro_dia_meses_antes(date.fromisoformat(f"{mes_atual}-01"), 1).strftime("%Y-%m")
    grupos: dict[tuple, set[str]] = defaultdict(set)
    rotulo: dict[tuple, str] = {}
    for d in despesas:
        if not d.get("recorrente"):
            continue
        chave = (d.get("tipo_lancamento_id"), (d.get("descricao") or "").strip().lower())
        if not chave[1]:
            continue
        grupos[chave].add((d.get("competencia") or "")[:7])
        rotulo[chave] = d.get("descricao") or ""
    out = []
    for chave, meses in grupos.items():
        # Vinha lançando (>=2 meses, incl. o mês passado) e sumiu no mês atual
        if len(meses) >= 2 and mes_ant in meses and mes_atual not in meses:
            out.append({
                "tipo": "gap_recorrencia",
                "severidade": "info",
                "titulo": "Recorrência sem lançamento no mês",
                "detalhe": f'"{rotulo[chave]}" vinha sendo lançada, mas não há registro em {mes_atual}.',
                "valor": 0,
            })
    return out


def _ordens_pendentes(db: Client, usuario: UsuarioAtual, so_proprios: bool, inicio: date, fim: date) -> list[dict]:
    try:
        # Mesmo recorte da tela de Ordens de Compra (data_solicitacao no período).
        q = (
            db.table("ordens_compra").select("id, valor, status, criado_em").eq("status", "pendente")
            .gte("data_solicitacao", inicio.isoformat())
            .lte("data_solicitacao", fim.isoformat())
        )
        if so_proprios:
            q = q.eq("criado_por", usuario.user_id)
        rows = q.limit(1000).execute().data or []
    except Exception as e:  # noqa: BLE001
        logger.warning("monitor_ordens_erro: %s", e)
        return []
    limite = datetime.now(timezone.utc) - timedelta(days=DIAS_PENDENTE)
    velhas = [r for r in rows if (_parse_dt(r.get("criado_em")) or datetime.now(timezone.utc)) < limite]
    if not velhas:
        return []
    total = sum(_num(r.get("valor")) for r in velhas)
    return [{
        "tipo": "ordem_pendente",
        "severidade": "aviso",
        "titulo": f"{len(velhas)} ordem(ns) de compra pendentes há +{DIAS_PENDENTE} dias",
        "detalhe": f"Aguardando aprovação — total {_brl(total)}" if total else f"{len(velhas)} aguardando aprovação",
        "valor": total,
    }]


# ── Camada LLM: resumo executivo priorizado (sob demanda) ──────

_PROMPT_RESUMO = (
    "Você é analista financeiro da MX Seguros. Abaixo estão os pontos de atenção "
    "detectados automaticamente nos lançamentos. Escreva um RESUMO EXECUTIVO curto "
    "(no máximo 5 itens em bullets), em português, tom direto, priorizando o que "
    "exige ação imediata primeiro. Agrupe itens semelhantes. NÃO invente dados além "
    "dos listados. Se não houver nada crítico, diga isso em uma frase.\n\n"
    "PONTOS DETECTADOS:\n"
)


def gerar_resumo_ia(payload_insights: dict) -> dict:
    """Recebe o resultado de gerar_insights e devolve um resumo priorizado por IA."""
    insights = payload_insights.get("insights", [])
    if not insights:
        return {"resumo": "Nenhum ponto de atenção — os apontamentos do período estão saudáveis.", "gerado_por_ia": False}
    if not cfg.anthropic_api_key:
        return {"resumo": None, "gerado_por_ia": False, "erro": "IA não configurada (defina ANTHROPIC_API_KEY)."}

    linhas = "\n".join(
        f'- [{i.get("severidade")}] {i.get("titulo")}: {i.get("detalhe")}' for i in insights
    )
    try:
        cliente = anthropic.Anthropic(api_key=cfg.anthropic_api_key)
        msg = cliente.messages.create(
            model=MODELO_RESUMO,
            max_tokens=700,
            messages=[{"role": "user", "content": _PROMPT_RESUMO + linhas}],
        )
        texto = "".join(b.text for b in msg.content if b.type == "text").strip()
        return {"resumo": texto or None, "gerado_por_ia": True}
    except anthropic.AuthenticationError:
        return {"resumo": None, "gerado_por_ia": False, "erro": "Chave de IA inválida."}
    except Exception as e:  # noqa: BLE001
        logger.error("monitor_resumo_erro: %s", e)
        return {"resumo": None, "gerado_por_ia": False, "erro": "Falha ao gerar o resumo com IA."}
