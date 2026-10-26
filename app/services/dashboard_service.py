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
from app.database import executar_sem_bloquear as _exec
from app.logging_config import get_logger
from app.models.schemas import (
    AlertaDashboard, BancoResumoItem, ClassificacaoValor, DashboardAplicacoesResponse,
    DashboardEmprestimosResponse, DashboardPorBancoResponse,
    DashboardResponse, EmprestimoBanco, EmprestimoLado, EmprestimoSubitem,
    ReceitaDespesaSaldo, ResumoVisaoGeral, TotalGeral,
    DespesasPorClassificacaoResponse, DREResponse, LancamentoResumoItem,
    LancamentosDiaMesResponse, MetasResponse,
)
from app.services import dre_service
from app.services.somente_dre import ids_somente_dre, sem_somente_dre
from app.services.periodo_base import coluna_data

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


# Excluída é soft-delete e rejeitada é decisão de quem aprova: nenhuma das
# duas é receita/despesa. Pendente e aprovada contam (mesma regra da DRE).
_FORA = ["excluida", "rejeitada"]
MESES_TOTAL_GERAL = 12


async def _todas(q) -> list[dict]:
    """Pagina a consulta: o PostgREST corta em max_rows sem avisar."""
    linhas: list[dict] = []
    while True:
        lote = (await _exec(q.range(len(linhas), len(linhas) + 999))).data or []
        linhas += lote
        if len(lote) < 1000:
            return linhas


def _soma(linhas) -> Decimal:
    return sum((Decimal(str(r["valor"])) for r in linhas), Decimal(0))


def limite_total_geral(hoje: date | None = None) -> date:
    """Último dia do 12º mês à frente do mês atual (ex.: out/26 -> 31/out/27)."""
    h = hoje or datetime.now(_TZ_BR).date()
    y, m = h.year + 1, h.month   # 12 meses à frente
    prox = date(y + (m == 12), m % 12 + 1, 1)
    return prox - timedelta(days=1)


async def resumo_visao_geral(inicio: date, fim: date, db: Client, base: str = "competencia") -> ResumoVisaoGeral:
    """Boxes da Visão Geral — escopo de 19/10/2026 (Gabriel).

    • Previsto do período: TODAS as receitas (comissões + manuais) × TODAS as
      despesas do período, pagas ou não, de qualquer banco, categoria ou
      classificação (inclui Aplicações e Empréstimos). Só as receitas de
      subitem "Constar apenas na DRE" ficam fora (regra de 22/10/2026).
    • Despesas pagas: as do período com Data de Pagamento preenchida.
    O período segue a base do filtro (padrão "pagamento": coluna data_ref,
    que precisa vir no select — o recorte é feito em memória).
    • Total geral: TODOS os meses até 12 à frente do atual (inclui futuros,
      pagos ou não). Não acompanha o período selecionado — o limite evita que
      parcelas longas (até 2038) dominem o número.

    Uma consulta por tabela cobre os três: tudo com competência até o maior
    dos limites, recortado em memória.
    """
    lim = limite_total_geral()
    teto = max(fim, lim).isoformat()
    so_dre = await ids_somente_dre(db)   # receitas desses subitens: só na DRE
    comissoes, receitas, despesas = await asyncio.gather(
        _todas(db.table("comissoes").select("id, valor, competencia, recebida_em, data_ref")
               .lte("competencia", teto).order("id")),
        _todas(sem_somente_dre(
            db.table("receitas_outras").select("id, valor, competencia, status, tipo_lancamento_id, recebido_em, data_ref")
            .lte("competencia", teto).not_.in_("status", _FORA), so_dre).order("id")),
        _todas(db.table("despesas").select("id, valor, competencia, data_vencimento, paga_em, status, data_ref")
               .lte("competencia", teto).not_.in_("status", _FORA).order("id")),
    )
    ini_s, fim_s, lim_s = inicio.isoformat(), fim.isoformat(), lim.isoformat()
    # Período pela base escolhida (Dia = vencimento/recebimento); o total
    # geral segue sempre pela competência.
    def no_periodo_em(col: str):
        return lambda r: ini_s <= (r.get(col) or "")[:10] <= fim_s
    per_com = no_periodo_em(coluna_data("comissoes", base))
    per_rec = no_periodo_em(coluna_data("receitas_outras", base))
    per_des = no_periodo_em(coluna_data("despesas", base))
    ate_lim = lambda r: (r.get("competencia") or "")[:10] <= lim_s              # noqa: E731

    rec_per = _soma([r for r in comissoes if per_com(r)] + [r for r in receitas if per_rec(r)])
    des_per_linhas = [d for d in despesas if per_des(d)]
    des_per = _soma(des_per_linhas)
    rec_tot = _soma([r for r in [*comissoes, *receitas] if ate_lim(r)])
    des_tot = _soma([d for d in despesas if ate_lim(d)])
    return ResumoVisaoGeral(
        previsto=ReceitaDespesaSaldo(receitas=rec_per, despesas=des_per, saldo=rec_per - des_per),
        despesas_pagas=_soma([d for d in des_per_linhas if d.get("paga_em")]),
        total_geral=TotalGeral(receitas=rec_tot, despesas=des_tot, saldo=rec_tot - des_tot, ate=lim),
    )


async def buscar_dashboard(
    inicio: date,
    fim: date,
    usuario: UsuarioAtual,
    db: Client,
    base: str = "competencia",
) -> DashboardResponse:
    t0 = time.monotonic()

    competencia = date(inicio.year, inicio.month, 1)

    dre_data, metas_data, resumo = await asyncio.gather(
        dre_service.buscar_dre(inicio, fim, usuario, db),
        dre_service.buscar_metas(competencia, usuario, db),
        resumo_visao_geral(inicio, fim, db, base),
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
        resumo=resumo,
        metas=metas_data.model_dump() if metas_data else None,
        alertas=alertas,
        latencia_ms=latencia_ms,
    )


# ── Épico 4 — Receita/despesa por banco ───────────────────────

_CLASSIF_CARDS_BANCO = ("fixo", "variavel")
# Receitas que não entram nos cards (regra de 22/10/2026): movimento de caixa,
# não receita. Sem classificação ou com outras, a receita conta normalmente.
_RECEITAS_FORA_CARDS_BANCO = {"aplicacoes", "adiantamento_cliente"}


async def _saldo_inicial_por_banco(db: Client) -> dict[str, Decimal]:
    """Soma, por banco, dos lançamentos de receita do subitem "Saldo Inicial"
    (lançamento único de out/2026), em qualquer data — não segue o período."""
    import unicodedata
    subs = await _exec(db.table("subitens_lancamento").select("id, nome").eq("natureza", "receita"))
    ids = [s["id"] for s in (subs.data or [])
           if unicodedata.normalize("NFKD", s["nome"] or "").encode("ascii", "ignore").decode().strip().lower()
           == "saldo inicial"]
    if not ids:
        return {}
    resp = await _exec(db.table("receitas_outras").select("banco_id, valor")
                       .in_("tipo_lancamento_id", ids).not_.in_("status", _FORA))
    out: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for r in (resp.data or []):
        if r.get("banco_id"):
            out[r["banco_id"]] += Decimal(str(r["valor"]))
    return out


async def _ids_subitens_receita_vendas(db: Client) -> set[str]:
    """Subitens da categoria Receitas de vendas (codigo 'receita_vendas', 0036)."""
    cat = await _exec(db.table("categorias_lancamento").select("id").eq("codigo", "receita_vendas"))
    if not cat.data:
        return set()
    subs = await _exec(db.table("subitens_lancamento").select("id").in_("categoria_id", [c["id"] for c in cat.data]))
    return {s["id"] for s in (subs.data or [])}


async def buscar_por_banco(
    inicio: date,
    fim: date,
    db: Client,
    base: str = "competencia",
) -> DashboardPorBancoResponse:
    """Agrega receitas_outras e despesas do período por banco. Comissões não
    têm banco_id, então "receita por banco" cobre apenas receitas manuais.

    Escopo de 19/10/2026: só o que já passou pelo banco — data de
    recebimento/pagamento preenchida. Com a base "pagamento" (padrão das telas
    desde 22/10/2026) o período é o da própria data de pagamento/recebimento. Excluídas e
    rejeitadas ficam fora (antes as receitas não filtravam status).

    Regra de 22/10/2026: nas despesas, só as classificadas como Fixo ou
    Variável (Aplicações, Adiantamento a cliente, Imposto, não classificadas
    etc. ficam fora dos cards). Nas receitas, só a categoria Receitas de
    vendas, e mesmo nela saem as classificadas como Aplicações ou Adiantamento
    a cliente. Só aqui — nas demais telas nada muda."""
    # As três consultas são independentes — com o wrapper de thread o gather
    # paralela de verdade: 3 round-trips a São Paulo pelo preço de 1.
    so_dre = await ids_somente_dre(db)   # receitas desses subitens: só na DRE
    vendas = await _ids_subitens_receita_vendas(db)
    saldo_inicial = await _saldo_inicial_por_banco(db)
    bancos_resp, receitas_resp, despesas_resp = await asyncio.gather(
        _exec(db.table("bancos").select("id, nome").eq("ativo", True).order("nome")),
        _exec(sem_somente_dre(
            db.table("receitas_outras")
            .select("banco_id, valor, custo_tipo, tipo_lancamento_id")
            .gte(coluna_data("receitas_outras", base), inicio.isoformat())
            .lte(coluna_data("receitas_outras", base), fim.isoformat())
            .not_.is_("banco_id", "null")
            .not_.is_("recebido_em", "null")
            .not_.in_("status", _FORA), so_dre)
        ),
        _exec(
            db.table("despesas")
            .select("banco_id, valor")
            .gte(coluna_data("despesas", base), inicio.isoformat())
            .lte(coluna_data("despesas", base), fim.isoformat())
            .not_.is_("banco_id", "null")
            .not_.is_("paga_em", "null")
            .not_.in_("status", _FORA)
            .in_("custo_tipo", list(_CLASSIF_CARDS_BANCO))
        ),
    )
    bancos = bancos_resp.data or []

    receitas_por_banco: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    for row in (receitas_resp.data or []):
        # Filtro aqui, não no banco: NOT IN descartaria também as sem classificação.
        if row.get("tipo_lancamento_id") not in vendas or row.get("custo_tipo") in _RECEITAS_FORA_CARDS_BANCO:
            continue
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
            saldo_inicial=saldo_inicial.get(b["id"], Decimal(0)),
        ))

    return DashboardPorBancoResponse(periodo={"inicio": inicio, "fim": fim}, bancos=itens)


# ── Box Empréstimos (23/10/2026) ──────────────────────────────

def _categoria_com_nome(nome: str | None, alvos: set[str]) -> bool:
    """Categorias criadas em Configurações sem código (Empréstimo, Aplicações):
    a busca é pelo nome, sem acento nem espaço nas pontas."""
    import unicodedata
    n = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().strip().lower()
    return n in alvos


async def _subitens_das_categorias(db: Client, alvos: set[str]) -> tuple[dict[str, str], list[dict]]:
    """(categoria_id → natureza, subitens) das categorias com um dos nomes."""
    cats = await _exec(db.table("categorias_lancamento").select("id, nome, natureza"))
    cat_ids = {c["id"]: c["natureza"] for c in (cats.data or []) if _categoria_com_nome(c.get("nome"), alvos)}
    subs = await _exec(
        db.table("subitens_lancamento").select("id, nome, natureza, ativo, categoria_id")
        .in_("categoria_id", list(cat_ids) or ["00000000-0000-0000-0000-000000000000"])
    )
    return cat_ids, subs.data or []


async def _quadro_por_banco(
    inicio: date,
    fim: date,
    db: Client,
    base: str,
    alvos: set[str],
) -> DashboardEmprestimosResponse:
    """Receitas e despesas das categorias com um dos nomes `alvos`, por banco e
    subitem (quadros Empréstimos e Aplicações da Visão Geral).

    Um card por banco ativo (23/10/2026), mais "Sem banco" só quando houver
    lançamento sem banco (ou de banco inativo). Mesmo período das demais telas
    (base "pagamento": data de pagamento/recebimento; em aberto, vencimento).
    Excluídas e rejeitadas ficam fora. Subitens ativos sem lançamento aparecem
    com zero, para o card manter as mesmas linhas de um mês para outro."""
    cat_ids, subs = await _subitens_das_categorias(db, alvos)
    bancos_resp = await _exec(db.table("bancos").select("id, nome").eq("ativo", True).order("nome"))
    bancos = [(b["id"], b["nome"].strip()) for b in (bancos_resp.data or [])]
    ids_bancos = {bid for bid, _ in bancos}
    SEM = "sem_banco"

    async def linhas(natureza: str, tabela: str) -> tuple[list[str], dict]:
        """(subitens ativos, {banco_id|SEM: {subitem: [qtd, valor]}})."""
        meus = [s for s in subs if cat_ids.get(s["categoria_id"]) == natureza]
        nomes = {s["id"]: s["nome"].strip() for s in meus}
        ativos = sorted(s["nome"].strip() for s in meus if s.get("ativo", True))
        por_banco: dict[str, dict[str, list]] = defaultdict(dict)
        if nomes:
            resp = await _exec(
                db.table(tabela).select("valor, tipo_lancamento_id, banco_id")
                .in_("tipo_lancamento_id", list(nomes))
                .gte(coluna_data(tabela, base), inicio.isoformat())
                .lte(coluna_data(tabela, base), fim.isoformat())
                .not_.in_("status", _FORA)
            )
            for row in (resp.data or []):
                chave = row.get("banco_id") if row.get("banco_id") in ids_bancos else SEM
                item = por_banco[chave].setdefault(nomes[row["tipo_lancamento_id"]], [0, Decimal(0)])
                item[0] += 1
                item[1] += Decimal(str(row["valor"]))
        return ativos, por_banco

    def lado(ativos: list[str], soma: dict[str, list]) -> EmprestimoLado:
        tudo = {n: soma.get(n, [0, Decimal(0)]) for n in ativos} | soma
        itens = [EmprestimoSubitem(subitem=n, qtd=q, valor=v) for n, (q, v) in sorted(tudo.items())]
        return EmprestimoLado(itens=itens, total=sum((i.valor for i in itens), Decimal(0)))

    (sub_rec, rec), (sub_des, des) = await asyncio.gather(
        linhas("receita", "receitas_outras"), linhas("despesa", "despesas"))
    cards = bancos + ([(SEM, "Sem banco")] if rec.get(SEM) or des.get(SEM) else [])
    por_banco = []
    for bid, nome in cards:
        r, d = lado(sub_rec, rec.get(bid, {})), lado(sub_des, des.get(bid, {}))
        por_banco.append(EmprestimoBanco(banco=nome, receitas=r, despesas=d, saldo=r.total - d.total))

    def somar(chave: str) -> EmprestimoLado:
        tot: dict[str, list] = {}
        for c in por_banco:
            for i in getattr(c, chave).itens:
                t = tot.setdefault(i.subitem, [0, Decimal(0)])
                t[0] += i.qtd
                t[1] += i.valor
        itens = [EmprestimoSubitem(subitem=n, qtd=q, valor=v) for n, (q, v) in sorted(tot.items())]
        return EmprestimoLado(itens=itens, total=sum((i.valor for i in itens), Decimal(0)))

    receitas, despesas = somar("receitas"), somar("despesas")
    return DashboardEmprestimosResponse(
        periodo={"inicio": inicio, "fim": fim}, bancos=por_banco,
        receitas=receitas, despesas=despesas, saldo=receitas.total - despesas.total,
    )


async def buscar_emprestimos(
    inicio: date, fim: date, db: Client, base: str = "competencia",
) -> DashboardEmprestimosResponse:
    """Quadro Empréstimos: categorias "Empréstimo(s)", um card por banco."""
    return await _quadro_por_banco(inicio, fim, db, base, {"emprestimo", "emprestimos"})


async def buscar_aplicacoes(
    inicio: date, fim: date, db: Client, base: str = "competencia",
) -> DashboardAplicacoesResponse:
    """Quadro Aplicações: categoria "Aplicações", no mesmo layout de Empréstimos
    (um card por banco, receitas e despesas por subitem) — pedido de 23/10/2026."""
    q = await _quadro_por_banco(inicio, fim, db, base, {"aplicacao", "aplicacoes"})
    return DashboardAplicacoesResponse(**q.model_dump())


# ── Épico 4 — Despesas por classificação (fixa/variável) ──────

async def buscar_despesas_por_classificacao(
    inicio: date,
    fim: date,
    db: Client,
    base: str = "competencia",
) -> DespesasPorClassificacaoResponse:
    """Agrega despesas do período pela classificação (custo_tipo) do próprio
    lançamento (migration 0040). Despesas sem classificação caem em 'não classificadas',
    de forma que a soma sempre feche com o total geral do período."""
    resp = await _exec(
        db.table("despesas")
        .select("valor, custo_tipo")
        .gte(coluna_data("despesas", base), inicio.isoformat())
        .lte(coluna_data("despesas", base), fim.isoformat())
        .not_.in_("status", ["excluida", "rejeitada"])
    )

    fixas = Decimal(0)
    variaveis = Decimal(0)
    nao_operacionais = Decimal(0)
    impostos = Decimal(0)
    nao_classificadas = Decimal(0)
    outras: dict[str, Decimal] = defaultdict(lambda: Decimal(0))

    for row in (resp.data or []):
        valor = Decimal(str(row.get("valor", 0)))
        custo_tipo = row.get("custo_tipo")
        if custo_tipo == "fixo":
            fixas += valor
        elif custo_tipo == "variavel":
            variaveis += valor
        elif custo_tipo == "nao_operacional":
            nao_operacionais += valor
        elif custo_tipo == "imposto":
            impostos += valor
        elif custo_tipo:
            outras[custo_tipo] += valor   # Aplicações, Adiantamento a cliente e demais cadastradas
        else:
            nao_classificadas += valor

    from app.services import classificacao_service
    cadastro = classificacao_service.listar(db) if outras else []
    nomes = {c["codigo"]: c["nome"] for c in cadastro}
    ordem = {c["codigo"]: i for i, c in enumerate(cadastro)}
    lista_outras = [
        ClassificacaoValor(codigo=k, nome=nomes.get(k, k), valor=v)
        for k, v in sorted(outras.items(), key=lambda i: ordem.get(i[0], 999))
    ]

    return DespesasPorClassificacaoResponse(
        periodo={"inicio": inicio, "fim": fim},
        fixas=fixas,
        variaveis=variaveis,
        nao_operacionais=nao_operacionais,
        impostos=impostos,
        nao_classificadas=nao_classificadas,
        outras=lista_outras,
        total=fixas + variaveis + nao_operacionais + impostos + nao_classificadas + sum(outras.values(), Decimal(0)),
    )


# ── Épico 4 — Listas diária/mensal de despesas e receitas ─────

_LIMITE_LISTA_DIA_MES = 8


async def buscar_despesas_dia_mes(
    inicio: date,
    fim: date,
    db: Client,
    base: str = "competencia",
) -> LancamentosDiaMesResponse:
    """Despesas que VENCEM hoje e as do mês/período selecionado, limitadas às
    mais recentes — a tela de Lançamentos mostra a lista completa.

    Regra de 19/10/2026 (Gabriel): o bloco HOJE traz só o vencimento de hoje.
    Antes entravam também as pagas hoje e as LANÇADAS hoje — uma recorrência
    lançada hoje até dezembro aparecia 3 vezes (out, nov, dez), parecendo
    duplicada, e ia junto no Compartilhar."""
    hoje, _cri_ini, _cri_fim = _janela_hoje_br()
    cols = "id, descricao, valor, competencia, data_vencimento, paga_em, criado_em, subitens_lancamento(nome)"

    resp_venc_hoje, resp_mes = await asyncio.gather(
        _exec(
            db.table("despesas").select(cols)
            .neq("status", "excluida").eq("data_vencimento", hoje.isoformat())
        ),
        _exec(
            db.table("despesas").select(cols)
            .neq("status", "excluida")
            .gte(coluna_data("despesas", base), inicio.isoformat())
            .lte(coluna_data("despesas", base), fim.isoformat())
            .order("competencia", desc=True)
            .limit(_LIMITE_LISTA_DIA_MES)
        ),
    )
    linhas_dia: dict[str, dict] = {r["id"]: r for r in (resp_venc_hoje.data or [])}

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
    base: str = "competencia",
) -> LancamentosDiaMesResponse:
    """Receitas manuais que vencem OU foram recebidas hoje, e as do mês/período
    selecionado, limitadas às mais recentes.

    Regra de 19/10/2026 (Gabriel), par da das despesas: saiu o "lançado hoje",
    que repetia as ocorrências futuras de uma série lançada hoje. O recebimento
    continua valendo porque nenhuma receita tem vencimento preenchido (o
    extrato só traz a data de recebimento) — só vencimento deixaria a lista
    sempre vazia. Excluídas ficam fora (antes apareciam aqui)."""
    hoje, _cri_ini, _cri_fim = _janela_hoje_br()
    cols = "id, descricao, valor, competencia, data_vencimento, recebido_em, criado_em, subitens_lancamento(nome)"

    so_dre = await ids_somente_dre(db)   # receitas desses subitens: só na DRE
    resp_venc_hoje, resp_recebido_hoje, resp_mes = await asyncio.gather(
        _exec(sem_somente_dre(
            db.table("receitas_outras").select(cols)
            .neq("status", "excluida").eq("data_vencimento", hoje.isoformat()), so_dre)
        ),
        _exec(sem_somente_dre(
            db.table("receitas_outras").select(cols)
            .neq("status", "excluida").eq("recebido_em", hoje.isoformat()), so_dre)
        ),
        _exec(sem_somente_dre(
            db.table("receitas_outras").select(cols)
            .neq("status", "excluida")
            .gte(coluna_data("receitas_outras", base), inicio.isoformat())
            .lte(coluna_data("receitas_outras", base), fim.isoformat()), so_dre)
            .order("competencia", desc=True)
            .limit(_LIMITE_LISTA_DIA_MES)
        ),
    )
    linhas_dia: dict[str, dict] = {r["id"]: r for r in (resp_venc_hoje.data or [])}
    for r in (resp_recebido_hoje.data or []):
        linhas_dia[r["id"]] = r

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
