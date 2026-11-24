"""Recorrência ligada/estendida/encurtada/desligada pela edição (24/11/2026)."""
from datetime import date

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.models.schemas import DespesaUpdate
from app.services import recorrencia_service as rec
from tests import fake_supabase

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1",
                     permissions={"aprovacoes": {"aprovar": True}})
COMERCIAL = UsuarioAtual(user_id="u-com", email="c@x", role="comercial", tenant_id="t1", permissions={})


def despesa(id_, comp, **kw):
    base = {"id": id_, "descricao": "Aluguel sede", "subcategoria": "Aluguel sede", "valor": "1000.00",
            "competencia": comp, "data_vencimento": comp[:8] + "10", "centro_custo": "matriz",
            "tipo_lancamento_id": "t-aluguel", "criado_por": "u-admin", "tenant_id": "t1",
            "status": "aprovada", "recorrente": False, "parcela_total": None, "paga_em": None,
            "grupo_recorrencia": None}
    return {**base, **kw}


def receita(id_, comp, **kw):
    base = {"id": id_, "descricao": "Consultoria", "valor": "500.00", "competencia": comp,
            "centro_custo": "matriz", "tipo_lancamento_id": "t-cons", "criado_por": "u-admin",
            "tenant_id": "t1", "status": "aprovada", "recorrente": False, "recebido_em": None,
            "grupo_recorrencia": None}
    return {**base, **kw}


def ativas(db, tabela="despesas"):
    return sorted((r for r in db.tabelas[tabela] if r.get("status") != "excluida"),
                  key=lambda r: r["competencia"])


def test_ligar_cria_os_meses_seguintes_na_serie():
    db = fake_supabase.Db(despesas=[despesa("d1", "2026-11-01", paga_em="2026-11-10")])
    rec.aplicar("despesas", "d1", True, date(2027, 2, 1), ADMIN, db)
    linhas = ativas(db)
    assert [r["competencia"] for r in linhas] == ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]
    grupos = {r["grupo_recorrencia"] for r in linhas}
    assert len(grupos) == 1 and None not in grupos
    assert all(r["recorrente"] for r in linhas)
    copias = linhas[1:]
    assert all(r.get("paga_em") is None for r in copias)            # pagamento não é copiado
    assert [r["data_vencimento"] for r in copias] == ["2026-12-10", "2027-01-10", "2027-02-10"]
    assert all(r["status"] == "aprovada" for r in copias)           # admin aprova


def test_copia_de_quem_nao_aprova_nasce_pendente():
    db = fake_supabase.Db(despesas=[despesa("d1", "2026-11-01", criado_por="u-com", status="pendente")])
    rec.aplicar("despesas", "d1", True, date(2026, 12, 1), COMERCIAL, db)
    assert ativas(db)[1]["status"] == "pendente"


def test_estender_nao_duplica_e_encurtar_remove_so_em_aberto():
    db = fake_supabase.Db(despesas=[despesa("d1", "2026-11-01")])
    rec.aplicar("despesas", "d1", True, date(2027, 1, 1), ADMIN, db)
    rec.aplicar("despesas", "d1", True, date(2027, 3, 1), ADMIN, db)
    assert len(ativas(db)) == 5
    # Fevereiro já foi pago: encurtar até dezembro não o remove.
    fev = next(r for r in db.tabelas["despesas"] if r["competencia"] == "2027-02-01")
    fev["paga_em"] = "2027-02-10"
    rec.aplicar("despesas", "d1", True, date(2026, 12, 1), ADMIN, db)
    assert [r["competencia"] for r in ativas(db)] == ["2026-11-01", "2026-12-01", "2027-02-01"]


def test_desligar_remove_futuras_em_aberto():
    db = fake_supabase.Db(despesas=[despesa("d1", "2026-11-01")])
    rec.aplicar("despesas", "d1", True, date(2027, 1, 1), ADMIN, db)
    rec.aplicar("despesas", "d1", False, None, ADMIN, db)
    linhas = ativas(db)
    assert [r["id"] for r in linhas] == ["d1"] and linhas[0]["recorrente"] is False


def test_quem_nao_aprova_nao_remove_ocorrencia_aprovada():
    db = fake_supabase.Db(despesas=[despesa("d1", "2026-11-01")])
    rec.aplicar("despesas", "d1", True, date(2027, 1, 1), ADMIN, db)
    with pytest.raises(HTTPException) as e:
        rec.aplicar("despesas", "d1", False, None, COMERCIAL, db, preservar_aprovadas=True)
    assert e.value.status_code == 403


def test_serie_antiga_sem_grupo_e_achada_pela_heuristica():
    db = fake_supabase.Db(despesas=[
        despesa("d1", "2026-11-01", recorrente=True),
        despesa("d2", "2026-12-01", recorrente=True),
        despesa("d3", "2027-01-01", recorrente=True),
        despesa("x", "2026-12-01", recorrente=True, descricao="Outra coisa"),
    ])
    assert rec.resumo("despesas", "d1", db) == {"recorrente": True, "ate": "2027-01-01", "meses": 3}
    rec.aplicar("despesas", "d1", True, date(2027, 2, 1), ADMIN, db)
    assert len([r for r in ativas(db) if r["descricao"] == "Aluguel sede"]) == 4


def test_limites():
    db = fake_supabase.Db(despesas=[despesa("d1", "2026-11-01"), despesa("p1", "2026-11-01", parcela_total=3)])
    for args in ((date(2026, 10, 1),), (date(2032, 1, 1),), (None,)):
        with pytest.raises(HTTPException) as e:
            rec.aplicar("despesas", "d1", True, args[0], ADMIN, db)
        assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        rec.aplicar("despesas", "p1", True, date(2027, 1, 1), ADMIN, db)
    with pytest.raises(ValueError):
        DespesaUpdate(recorrente=True, num_parcelas=3)


def test_receita_liga_aprovada_e_desliga_apagando():
    db = fake_supabase.Db(receitas_outras=[receita("r1", "2026-11-01")])
    assert rec.resumo("receitas_outras", "r1", db)["recorrente"] is False
    rec.aplicar("receitas_outras", "r1", True, date(2027, 1, 1), ADMIN, db)
    linhas = ativas(db, "receitas_outras")
    assert len(linhas) == 3 and all(r["status"] == "aprovada" for r in linhas)
    assert rec.resumo("receitas_outras", "r1", db) == {"recorrente": True, "ate": "2027-01-01", "meses": 3}
    rec.aplicar("receitas_outras", "r1", False, None, ADMIN, db)
    assert [r["id"] for r in db.tabelas["receitas_outras"]] == ["r1"]   # receita é apagada, não soft


def test_receita_de_outro_tenant_nao_aparece():
    db = fake_supabase.Db(receitas_outras=[receita("r1", "2026-11-01", tenant_id="t2")])
    with pytest.raises(HTTPException) as e:
        rec.resumo("receitas_outras", "r1", db, "t1")
    assert e.value.status_code == 404
