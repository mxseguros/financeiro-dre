"""Empréstimo: despesa ↔ receita vinculadas e sincronizadas (28/11/2026)."""
import asyncio
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.models.schemas import DespesaCreate, EspelhoEmprestimo, ReceitaOutraCreate
from app.services import emprestimo_vinculo as ev
from app.services import financeiro_service as fs
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id=uid(1), email="a@x", role="admin", tenant_id="t1")


def _item(id_, **kw):
    base = dict(id=id_, descricao="Empréstimo Banco X", valor=Decimal("10000"), competencia=date(2026, 11, 1),
                data_vencimento=date(2026, 11, 10), centro_custo="financeiro", banco_id=uid(50),
                paga_em=None, recebido_em=None)
    return SimpleNamespace(**{**base, **kw})


@pytest.fixture
def db(monkeypatch):
    banco = Db(despesas=[], receitas_outras=[])

    async def criar_receita(payload: ReceitaOutraCreate, _u, _db):
        linha = {"descricao": payload.descricao, "valor": str(payload.valor), "status": "aprovada",
                 "competencia": payload.competencia.isoformat(), "centro_custo": payload.centro_custo,
                 "recebido_em": payload.recebido_em.isoformat() if payload.recebido_em else None,
                 "data_vencimento": payload.data_vencimento.isoformat() if payload.data_vencimento else None,
                 "tenant_id": "t1"}
        criado = banco.table("receitas_outras").insert(linha).execute().data[0]
        return SimpleNamespace(id=criado["id"])

    async def criar_despesa(payload: DespesaCreate, _u, _db):
        linha = {"descricao": payload.descricao, "valor": str(payload.valor), "status": "aprovada",
                 "competencia": payload.competencia.isoformat(), "centro_custo": payload.centro_custo,
                 "paga_em": payload.paga_em.isoformat() if payload.paga_em else None, "tenant_id": "t1"}
        criado = banco.table("despesas").insert(linha).execute().data[0]
        return SimpleNamespace(id=criado["id"])

    monkeypatch.setattr(fs, "criar_receita_outra", criar_receita)
    monkeypatch.setattr(fs, "criar_despesa", criar_despesa)
    monkeypatch.setattr(fs, "garantir_sem_pagamento_no_banco", lambda *a, **k: None)
    return banco


def _despesa_criada(db, **kw):
    linha = {"id": uid(10), "descricao": "Empréstimo Banco X", "valor": "10000", "status": "aprovada",
             "competencia": "2026-11-01", "data_vencimento": "2026-11-10", "paga_em": kw.get("paga_em"),
             "centro_custo": "financeiro", "tenant_id": "t1"}
    db.tabelas["despesas"].append(linha)
    return _item(uid(10), **kw)


def test_despesa_cria_receita_vinculada(db):
    item = _despesa_criada(db, paga_em=date(2026, 11, 10))
    esp = EspelhoEmprestimo(tipo_lancamento_id=uid(70), centro_custo="socorro")
    criado = asyncio.run(ev.criar_espelho("despesas", item, esp, ADMIN, db, db))
    rec = next(r for r in db.tabelas["receitas_outras"] if r["id"] == criado.id)
    desp = db.tabelas["despesas"][0]
    assert rec["vinculo_emprestimo"] and rec["vinculo_emprestimo"] == desp["vinculo_emprestimo"]
    assert rec["valor"] == "10000" and rec["descricao"] == "Empréstimo Banco X"
    assert rec["centro_custo"] == "socorro"                 # trocado no espelho
    assert rec["recebido_em"] == "2026-11-10"               # data de pagamento vira recebimento
    assert ev.vinculado(db, "despesas", uid(10))["id"] == criado.id
    assert ev.vinculado(db, "receitas_outras", criado.id)["id"] == uid(10)


def test_falha_no_espelho_desfaz_o_lancamento(db, monkeypatch):
    item = _despesa_criada(db)

    async def falha(*_a):
        raise HTTPException(422, "Período fechado.")
    monkeypatch.setattr(fs, "criar_receita_outra", falha)
    with pytest.raises(HTTPException) as e:
        asyncio.run(ev.criar_espelho("despesas", item, EspelhoEmprestimo(), ADMIN, db, db))
    assert "Período fechado" in e.value.detail
    assert db.tabelas["despesas"] == [] and db.tabelas["receitas_outras"] == []


def test_editar_um_lado_atualiza_o_outro(db):
    item = _despesa_criada(db)
    criado = asyncio.run(ev.criar_espelho("despesas", item, EspelhoEmprestimo(), ADMIN, db, db))
    mudou = ev.propagar(db, "despesas", uid(10), {"valor": Decimal("12000"), "descricao": "Empréstimo Y",
                                                 "banco_id": uid(99), "paga_em": date(2026, 11, 12)}, "t1")
    assert mudou
    rec = next(r for r in db.tabelas["receitas_outras"] if r["id"] == criado.id)
    assert rec["valor"] == "12000" and rec["descricao"] == "Empréstimo Y"
    assert "banco_id" not in rec and rec["recebido_em"] is None      # campos de cada lado não vão
    # E o contrário: receita → despesa (com subcategoria acompanhando a descrição).
    ev.propagar(db, "receitas_outras", criado.id, {"descricao": "Empréstimo Z", "data_vencimento": date(2026, 11, 20)}, "t1")
    desp = db.tabelas["despesas"][0]
    assert desp["descricao"] == "Empréstimo Z" and desp["subcategoria"] == "Empréstimo Z"
    assert desp["data_vencimento"] == "2026-11-20"


def test_sem_vinculo_nao_propaga(db):
    _despesa_criada(db)
    assert ev.propagar(db, "despesas", uid(10), {"valor": Decimal(1)}, "t1") is False


def test_excluir_sem_o_vinculado_solta_o_outro_lado(db):
    item = _despesa_criada(db)
    criado = asyncio.run(ev.criar_espelho("despesas", item, EspelhoEmprestimo(), ADMIN, db, db))
    assert ev.desvincular_ou_excluir(db, "despesas", uid(10), False, ADMIN) is None
    rec = next(r for r in db.tabelas["receitas_outras"] if r["id"] == criado.id)
    assert rec["vinculo_emprestimo"] is None


def test_excluir_com_o_vinculado_devolve_o_outro_lado(db):
    item = _despesa_criada(db)
    criado = asyncio.run(ev.criar_espelho("despesas", item, EspelhoEmprestimo(), ADMIN, db, db))
    alvo = ev.desvincular_ou_excluir(db, "despesas", uid(10), True, ADMIN)
    assert alvo["id"] == criado.id and alvo["tabela"] == "receitas_outras"


def test_espelho_so_em_lancamento_unico():
    with pytest.raises(ValueError):
        DespesaCreate(subcategoria="x", descricao="Empréstimo", valor=1, competencia=date(2026, 11, 1),
                      data_vencimento=date(2026, 11, 1), num_parcelas=3, espelho=EspelhoEmprestimo())
    with pytest.raises(ValueError):
        ReceitaOutraCreate(descricao="Empréstimo", valor=1, competencia=date(2026, 11, 1),
                           repetir_ate=date(2026, 12, 1), espelho=EspelhoEmprestimo())
