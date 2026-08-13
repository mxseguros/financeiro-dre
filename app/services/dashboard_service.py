"""
MX Seguros — DRE-IA | Serviço de dashboard — agrega DRE + metas em uma única chamada.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from supabase import Client

from app.auth import UsuarioAtual
from app.logging_config import get_logger
from app.models.schemas import (
    AlertaDashboard, BancoResumoItem, DashboardPorBancoResponse, DashboardResponse,
    DespesasPorClassificacaoResponse, DREResponse, LancamentoResumoItem,
    LancamentosDiaMesResponse, MetasResponse,
)
from app.services import dre_service

logger = get_logger(__name__)

_TZ_BR = timezone(timedelta(hours=-3))


def _janela_hoje_br() -> tuple[date, str, str]:
    """'Hoje' em horário de Brasília: (data, criado_em >= inicio, criado_em < fim)."""
    hoje = datetime.now(_TZ_BR).date()
    amanha = hoje + timedelta(days=1)
    return hoje, f"{hoje}T00:00:00-03:00", f"{amanha}T00:00:00-03:00"


def _gerar_alertas(dre_data: DREResponse, metas_data: MetasResponse | None) -> list[AlertaDashboard]:
    """Gera alertas baseados em limites de estorno e atingimento de metas."""
    alertas: list[AlertaDashboard] = []

    # Alerta de taxa de estorno alta (> 5% da receita bruta)
    receita = dre_data.dre.receita_bruta or 0
    estornos = dre_data.dre.estornos or 0
    if receita > 0:
        taxa_estorno = float(estornos / receita * 100)
        if taxa_estorno > 5:
            alertas.append(AlertaDashboard(
                tipo="estorno",
                mensagem=f"Taxa de estorno em {taxa_estorno:.1f}% — acima do limite de 5%",
                severidade="critico",
            ))

    # Alertas de metas abaixo do esperado (< 80% atingido)
    if metas_data and metas_data.items:
        for meta in metas_data.items:
            pct = meta.percentual_atingido
            if pct is not None and pct < 80:
                alertas.append(AlertaDashboard(
                    tipo="meta",
                    mensagem=f"Meta ({meta.escopo}) atingida em {pct:.0f}%",
                    severidade="aviso",
                ))

    return alertas


async def buscar_dashboard(
    inicio: date,
    fim: date,
    usuario: UsuarioAtual,
    db: Client,
) -> DashboardResponse:
    t0 = time.monotonic()

    competencia = date(inicio.year, inicio.month, 1)

    dre_data, metas_data = await asyncio.gather(
        dre_service.buscar_dre(inicio, fim, usuario, db),
        dre_service.buscar_metas(competencia, usuario, db),
    )

    alertas = _gerar_alertas(dre_data, metas_data)

    latencia_ms = int((time.monotonic() - t0) * 1000)
    logger.info(
        "dashboard_carregado",
        usuario_id=usuario.user_id,
        role=usuario.role,
        latencia_ms=latencia_ms,
    )

    return DashboardResponse(
        periodo=dre_data.periodo,
        dre=dre_data.dre,
        perfil=usuario.role,
        metas=metas_data.model_dump() if metas_data else None,
        alertas=alertas,
        latencia_ms=latencia_ms,
    )


# ── Épico 4 — Receita/despesa por banco ───────────────────────

async def buscar_por_banco(
    inicio: date,
    fim: date,
    db: Client,
) -> DashboardPorBancoResponse:
    """Agrega receitas_outras e despesas do período por banco. Comissões não
    têm banco_id, então "receita por banco" cobre apenas receitas manuais."""
    bancos_resp = db.table("bancos").select("id, nome").eq("ativo", True).order("nome").execute()
    bancos = bancos_resp.data or []

    receitas_resp = (
        db.table("receitas_outras")
        .select("banco_id, valor")
        .gte("competencia", inicio.isoformat())
        .lte("competencia", fim.isoformat())
        .not_.is_("banco_id", "null")
        .execute()
    )
    despesas_resp = (
        db.table("despesas")
        .select("banco_id, valor")
        .gte("competencia", inicio.isoformat())
        .lte("competencia", fim.isoformat())
        .not_.is_("banco_id", "null")
        .not_.in_("status", ["excluida", "rejeitada"])
        .execute()
    )

    receitas_por_banco: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for row in (receitas_resp.data or []):
        receitas_por_banco[row["banco_id"]] += Decimal(str(row["valor"]))

    despesas_por_banco: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for row in (despesas_resp.data or []):
        despesas_por_banco[row["banco_id"]] += Decimal(str(row["valor"]))

    itens = []
    for b in bancos:
        r = receitas_por_banco.get(b["id"], Decimal(0))
        d = despesas_por_banco.get(b["id"], Decimal(0))
        itens.append(BancoResumoItem(
            banco_id=b["id"], banco_nome=b["nome"],
            receitas=r, despesas=d, saldo=r - d,
        ))

    return DashboardPorBancoResponse(periodo={"inicio": inicio, "fim": fim}, bancos=itens)


# ── Épico 4 — Despesas por classificação (fixa/variável) ──────

async def buscar_despesas_por_classificacao(
    inicio: date,
    fim: date,
    db: Client,
) -> DespesasPorClassificacaoResponse:
    """Agrega despesas do período pela classificação (custo_tipo) do subitem
    vinculado. Despesas sem subitem classificado caem em 'não classificadas',
    de forma que a soma sempre feche com o total geral do período."""
    resp = (
        db.table("despesas")
        .select("valor, tipo_lancamento_id, subitens_lancamento(custo_tipo)")
        .gte("competencia", inicio.isoformat())
        .lte("competencia", fim.isoformat())
        .not_.in_("status", ["excluida", "rejeitada"])
        .execute()
    )

    fixas = Decimal(0)
    variaveis = Decimal(0)
    nao_operacionais = Decimal(0)
    impostos = Decimal(0)
    nao_classificadas = Decimal(0)

    for row in (resp.data or []):
        valor = Decimal(str(row.get("valor", 0)))
        custo_tipo = (row.get("subitens_lancamento") or {}).get("custo_tipo")
        if custo_tipo == "fixo":
            fixas += valor
        elif custo_tipo == "variavel":
            variaveis += valor
        elif custo_tipo == "nao_operacional":
            nao_operacionais += valor
        elif custo_tipo == "imposto":
            impostos += valor
        else:
            nao_classificadas += valor

    return DespesasPorClassificacaoResponse(
        periodo={"inicio": inicio, "fim": fim},
        fixas=fixas,
        variaveis=variaveis,
        nao_operacionais=nao_operacionais,
        impostos=impostos,
        nao_classificadas=nao_classificadas,
        total=fixas + variaveis + nao_operacionais + impostos + nao_classificadas,
    )


# ── Épico 4 — Listas diária/mensal de despesas e receitas ─────

_LIMITE_LISTA_DIA_MES = 8


async def buscar_despesas_dia_mes(
    inicio: date,
    fim: date,
    db: Client,
) -> LancamentosDiaMesResponse:
    """Despesas do dia (vencidas ou pagas hoje) e do mês/período selecionado,
    limitadas às mais recentes — a tela de Lançamentos mostra a lista completa."""
    hoje, cri_ini, cri_fim = _janela_hoje_br()
    cols = "id, descricao, valor, competencia, data_vencimento, paga_em, criado_em, subitens_lancamento(nome)"

    resp_venc_hoje = (
        db.table("despesas").select(cols)
        .neq("status", "excluida").eq("data_vencimento", hoje.isoformat())
        .execute()
    )
    resp_pago_hoje = (
        db.table("despesas").select(cols)
        .neq("status", "excluida").eq("paga_em", hoje.isoformat())
        .execute()
    )
    # Também o que foi LANÇADO hoje (criado hoje), mesmo com vencimento/pagamento futuro
    resp_criado_hoje = (
        db.table("despesas").select(cols)
        .neq("status", "excluida")
        .gte("criado_em", cri_ini).lt("criado_em", cri_fim)
        .order("criado_em", desc=True).limit(_LIMITE_LISTA_DIA_MES)
        .execute()
    )
    linhas_dia: dict[str, dict] = {r["id"]: r for r in (resp_venc_hoje.data or [])}
    for r in (resp_pago_hoje.data or []) + (resp_criado_hoje.data or []):
        linhas_dia[r["id"]] = r

    resp_mes = (
        db.table("despesas").select(cols)
        .neq("status", "excluida")
        .gte("competencia", inicio.isoformat())
        .lte("competencia", fim.isoformat())
        .order("competencia", desc=True)
        .limit(_LIMITE_LISTA_DIA_MES)
        .execute()
    )

    def _mapear(rows: list[dict]) -> list[LancamentoResumoItem]:
        itens = []
        for row in rows:
            itens.append(LancamentoResumoItem(
                id=row["id"],
                descricao=row.get("descricao", ""),
                tipo_nome=(row.get("subitens_lancamento") or {}).get("nome"),
                valor=Decimal(str(row.get("valor", 0))),
                data=row.get("data_vencimento") or row.get("paga_em") or row.get("competencia"),
            ))
        return itens

    return LancamentosDiaMesResponse(
        dia=_mapear(list(linhas_dia.values())[:_LIMITE_LISTA_DIA_MES]),
        mes=_mapear(resp_mes.data or []),
    )


async def buscar_receitas_dia_mes(
    inicio: date,
    fim: date,
    db: Client,
) -> LancamentosDiaMesResponse:
    """Receitas manuais do dia (vencidas ou recebidas hoje) e do mês/período
    selecionado, limitadas às mais recentes."""
    hoje, cri_ini, cri_fim = _janela_hoje_br()
    cols = "id, descricao, valor, competencia, data_vencimento, recebido_em, criado_em, subitens_lancamento(nome)"

    resp_venc_hoje = (
        db.table("receitas_outras").select(cols)
        .eq("data_vencimento", hoje.isoformat())
        .execute()
    )
    resp_recebido_hoje = (
        db.table("receitas_outras").select(cols)
        .eq("recebido_em", hoje.isoformat())
        .execute()
    )
    # Também o que foi LANÇADO hoje (criado hoje)
    resp_criado_hoje = (
        db.table("receitas_outras").select(cols)
        .gte("criado_em", cri_ini).lt("criado_em", cri_fim)
        .order("criado_em", desc=True).limit(_LIMITE_LISTA_DIA_MES)
        .execute()
    )
    linhas_dia: dict[str, dict] = {r["id"]: r for r in (resp_venc_hoje.data or [])}
    for r in (resp_recebido_hoje.data or []) + (resp_criado_hoje.data or []):
        linhas_dia[r["id"]] = r

    resp_mes = (
        db.table("receitas_outras").select(cols)
        .gte("competencia", inicio.isoformat())
        .lte("competencia", fim.isoformat())
        .order("competencia", desc=True)
        .limit(_LIMITE_LISTA_DIA_MES)
        .execute()
    )

    def _mapear(rows: list[dict]) -> list[LancamentoResumoItem]:
        itens = []
        for row in rows:
            itens.append(LancamentoResumoItem(
                id=row["id"],
                descricao=row.get("descricao", ""),
                tipo_nome=(row.get("subitens_lancamento") or {}).get("nome"),
                valor=Decimal(str(row.get("valor", 0))),
                data=row.get("data_vencimento") or row.get("recebido_em") or row.get("competencia"),
            ))
        return itens

    return LancamentosDiaMesResponse(
        dia=_mapear(list(linhas_dia.values())[:_LIMITE_LISTA_DIA_MES]),
        mes=_mapear(resp_mes.data or []),
    )
