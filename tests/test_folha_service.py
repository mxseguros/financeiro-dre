"""Folha CLT — contrato, parâmetros e custos (fase 1, 25/11/2026)."""
import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import folha_service as fs
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="u-gestor", email="g@x", role="gestor", tenant_id="t1")
F1, F2, F3 = uid(1), uid(2), uid(3)


def banco():
    return Db(
        funcionarios=[
            {"id": F1, "nome": "Maria Souza", "centro_custo": "venda_nova", "ativo": True, "tenant_id": "t1"},
            {"id": F2, "nome": "João Lima", "centro_custo": "venda_nova", "ativo": True, "tenant_id": "t1"},
            {"id": F3, "nome": "De fora", "centro_custo": None, "ativo": True, "tenant_id": "t2"},
        ],
        funcionarios_contrato=[], folha_parametros=[], folha_rubrica_subitem=[],
        subitens_lancamento=[
            {"id": uid(50), "nome": "Guia FGTS", "natureza": "despesa", "tenant_id": "t1"},
            {"id": uid(51), "nome": "Comissões", "natureza": "receita", "tenant_id": "t1"},
        ],
    )


def test_contrato_so_admin():
    db = banco()
    for f in (lambda: fs.obter_contrato(F1, GESTOR, db),
              lambda: fs.salvar_contrato(F1, {"salario_base": 3000}, GESTOR, db),
              lambda: fs.custos(GESTOR, db)):
        with pytest.raises(HTTPException) as e:
            f()
        assert e.value.status_code == 403


def test_contrato_salvo_e_calculado():
    db = banco()
    vazio = fs.obter_contrato(F1, ADMIN, db)
    assert vazio["cadastrado"] is False and vazio["calculo"]["liquido"] == 0
    r = fs.salvar_contrato(F1, {"salario_base": 3000, "va_valor": 600}, ADMIN, db)
    assert r["cadastrado"] and r["salario_base"] == 3000
    assert r["calculo"]["descontos"]["inss"] == 253.41
    assert r["calculo"]["custo_mes"] == 3000 + 240 + 600
    assert r["calculo"]["parametros_conferidos"] is False      # ainda os de partida
    fs.salvar_contrato(F1, {"salario_base": 3500}, ADMIN, db)
    assert len(db.tabelas["funcionarios_contrato"]) == 1
    assert db.tabelas["funcionarios_contrato"][0]["tenant_id"] == "t1"


def test_funcionario_de_outro_tenant():
    with pytest.raises(HTTPException) as e:
        fs.salvar_contrato(F3, {"salario_base": 1}, ADMIN, banco())
    assert e.value.status_code == 404


def test_parametros_por_ano():
    db = banco()
    assert fs.parametros(2026, ADMIN, db)["ano_vigente"] is None
    fs.salvar_parametros(2026, {"fgts_pct": 8, "inss_patronal_pct": 20, "lixo": 1}, True, ADMIN, db)
    p = fs.parametros(2027, ADMIN, db)                     # vale o último até o ano pedido
    assert p["ano_vigente"] == 2026 and p["conferido"] and p["inss_patronal_pct"] == 20
    assert "lixo" not in db.tabelas["folha_parametros"][0]["dados"]
    assert fs.parametros(2025, ADMIN, db)["ano_vigente"] is None


def test_rubricas_aceitam_so_subitem_de_despesa():
    db = banco()
    with pytest.raises(HTTPException):
        fs.salvar_rubricas({"fgts": uid(51)}, ADMIN, db)
    with pytest.raises(HTTPException):
        fs.salvar_rubricas({"inexistente": uid(50)}, ADMIN, db)
    r = {x["rubrica"]: x["subitem_id"] for x in fs.salvar_rubricas({"fgts": uid(50)}, ADMIN, db)}
    assert r["fgts"] == uid(50) and r["irrf"] is None


def test_custos_por_centro():
    db = banco()
    fs.salvar_contrato(F1, {"salario_base": 3000}, ADMIN, db)
    fs.salvar_contrato(F2, {"salario_base": 2000, "data_desligamento": "2026-10-31"}, ADMIN, db)
    c = fs.custos(ADMIN, db)
    assert list(c["por_funcionario"]) == [F1]              # desligado fica de fora
    assert c["por_centro"]["venda_nova"] == {"pessoas": 1, "custo_mes": 3240.0, "custo_com_provisoes": c["por_centro"]["venda_nova"]["custo_com_provisoes"]}
    assert c["total_mes"] == 3240.0
