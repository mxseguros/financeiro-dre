"""Filtro "Situação" de Lançamentos (28/11/2026): uma situação por lançamento,
sem sobreposição; os chips contam sobre os filtros da tela sem a situação."""
import asyncio
from datetime import date
from decimal import Decimal

import pytest

from app.auth import UsuarioAtual
from app.services import financeiro_service as fs
from app.services import situacao_filtro as sf
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1")
HOJE = date(2026, 11, 15)


def _desp(n, valor, venc, pago=None, status="aprovada"):
    return {"id": uid(n), "descricao": f"D{n}", "subcategoria": f"D{n}", "descricao_busca": f"d{n}",
            "valor": str(valor), "competencia": "2026-11-01", "data_vencimento": venc, "paga_em": pago,
            "data_ref": pago or venc, "status": status, "centro_custo": "matriz", "tenant_id": "t1",
            "tipo_lancamento_id": None, "banco_id": None, "recorrente": False, "custo_tipo": None,
            "parcela_atual": None, "parcela_total": None, "criado_por": None}


def _rec(n, valor, venc, recebido=None, status="aprovada"):
    return {"id": uid(500 + n), "descricao": f"R{n}", "descricao_busca": f"r{n}", "valor": str(valor),
            "competencia": "2026-11-01", "data_vencimento": venc, "recebido_em": recebido,
            "data_ref": recebido or venc, "status": status, "centro_custo": "matriz", "tenant_id": "t1",
            "tipo_lancamento_id": None, "banco_id": None, "custo_tipo": None, "criado_por": None}


def _banco():
    return Db(
        despesas=[
            _desp(1, 100, "2026-11-10", pago="2026-11-10"),            # paga
            _desp(2, 200, "2026-11-10"),                                # vencida
            _desp(3, 300, "2026-11-15"),                                # vence hoje
            _desp(4, 400, "2026-11-20"),                                # a pagar
            _desp(5, 500, None),                                        # a pagar (sem vencimento)
            _desp(6, 600, "2026-11-01", status="pendente"),             # aguardando (mesmo vencida)
            _desp(7, 700, "2026-11-20", status="rejeitada"),            # rejeitada
            _desp(8, 800, "2026-11-01", pago="2026-11-02", status="pendente"),  # paga vence a precedência
        ],
        receitas_outras=[
            _rec(1, 10, "2026-11-10", recebido="2026-11-11"),           # recebida
            _rec(2, 20, "2026-11-10"),                                  # atrasada
            _rec(3, 30, "2026-11-25"),                                  # a receber
            _rec(4, 40, "2026-11-25", status="rejeitada"),              # rejeitada
        ],
        comissoes=[], subitens_lancamento=[],
    )


@pytest.fixture(autouse=True)
def _hoje(monkeypatch):
    monkeypatch.setattr(fs, "hoje_brasil", lambda: HOJE)


def _despesas(db, monkeypatch, **kw):
    monkeypatch.setattr(fs, "get_supabase_admin", lambda: db)
    return asyncio.run(fs.buscar_despesas(date(2026, 11, 1), date(2026, 11, 30), ADMIN, db, **kw))


def _receitas(db, **kw):
    return asyncio.run(fs.buscar_receitas(date(2026, 11, 1), date(2026, 11, 30), ADMIN, db, **kw))


ESPERADO_DESPESA = {"paga": {1, 8}, "vencida": {2}, "vence_hoje": {3}, "a_pagar": {4, 5},
                    "aguardando": {6}, "rejeitada": {7}}


@pytest.mark.parametrize("limit", [None, 200])
@pytest.mark.parametrize("situacao", sf.SITUACOES_DESPESA)
def test_despesas_por_situacao(situacao, limit, monkeypatch):
    resp = _despesas(_banco(), monkeypatch, situacao=situacao, limit=limit)
    assert {i.descricao for i in resp.items} == {f"D{n}" for n in ESPERADO_DESPESA[situacao]}
    assert resp.total == len(ESPERADO_DESPESA[situacao])
    assert resp.soma_total == sum(Decimal(n * 100) for n in ESPERADO_DESPESA[situacao])
    # Os chips não mudam ao escolher um deles.
    assert resp.contagem_situacao == {k: len(v) for k, v in ESPERADO_DESPESA.items()}


def test_despesas_sem_situacao_contam_todas(monkeypatch):
    resp = _despesas(_banco(), monkeypatch, limit=200)
    assert resp.total == 8
    assert resp.contagem_situacao == {k: len(v) for k, v in ESPERADO_DESPESA.items()}


ESPERADO_RECEITA = {"recebida": {1}, "atrasada": {2}, "a_receber": {3}, "rejeitada": {4}}


@pytest.mark.parametrize("situacao", sf.SITUACOES_RECEITA)
def test_receitas_por_situacao(situacao):
    resp = _receitas(_banco(), situacao=situacao)
    assert {i.descricao for i in resp.items} == {f"R{n}" for n in ESPERADO_RECEITA[situacao]}
    assert resp.soma_total == sum(Decimal(n * 10) for n in ESPERADO_RECEITA[situacao])
    assert resp.contagem_situacao == {k: len(v) for k, v in ESPERADO_RECEITA.items()}


def test_comissao_entra_pela_data_de_recebimento():
    db = _banco()
    db.tabelas["comissoes"] = [
        {"id": uid(900), "valor": "5", "competencia": "2026-11-01", "recebida_em": "2026-11-03", "tipo": "auto"},
        {"id": uid(901), "valor": "7", "competencia": "2026-11-01", "recebida_em": None, "tipo": "vida"},
    ]
    assert {i.valor for i in _receitas(db, situacao="recebida").items} == {Decimal(10), Decimal(5)}
    assert {i.valor for i in _receitas(db, situacao="a_receber").items} == {Decimal(30), Decimal(7)}
