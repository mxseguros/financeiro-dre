"""Remuneração do funcionário (0052): valores por item, só Admin, custo mensal."""
import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import remuneracao_service as rs
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="u-gestor", email="g@x", role="gestor", tenant_id="t1")
F1, F2, F3 = uid(1), uid(2), uid(3)


def banco():
    return Db(
        funcionarios=[
            {"id": F1, "nome": "Maria Souza", "centro_custo": "venda_nova", "ativo": True, "tenant_id": "t1"},
            {"id": F2, "nome": "João Lima", "centro_custo": "venda_nova", "ativo": False, "tenant_id": "t1"},
            {"id": F3, "nome": "De fora", "centro_custo": None, "ativo": True, "tenant_id": "t2"},
        ],
        funcionarios_contrato=[],
    )


def test_itens_da_lista():
    assert list(rs.ITENS.values()) == [
        "Salário", "13º Salário", "1/3 Férias", "Abono de Férias", "FGTS",
        "Vale Refeição", "Odonto", "Plano de Saúde", "Seguro de Vida", "Rescisão",
    ]


def test_so_admin():
    db = banco()
    for f in (lambda: rs.obter(F1, GESTOR, db), lambda: rs.salvar(F1, {"salario": 3000}, GESTOR, db),
              lambda: rs.custos(GESTOR, db)):
        with pytest.raises(HTTPException) as e:
            f()
        assert e.value.status_code == 403


def test_salvar_e_obter():
    db = banco()
    vazio = rs.obter(F1, ADMIN, db)
    assert vazio["cadastrado"] is False and vazio["valores"]["salario"] == 0 and vazio["custo_mensal"] == 0
    r = rs.salvar(F1, {"salario": "3000", "fgts": 240, "vale_refeicao": 600, "decimo_terceiro": 3000,
                       "desconhecido": 99}, ADMIN, db)
    assert r["cadastrado"] and r["valores"]["salario"] == 3000.0 and "desconhecido" not in r["valores"]
    assert r["custo_mensal"] == 3840.0                       # 13º não entra no mensal
    rs.salvar(F1, {"salario": 3500}, ADMIN, db)
    assert len(db.tabelas["funcionarios_contrato"]) == 1
    assert db.tabelas["funcionarios_contrato"][0]["tenant_id"] == "t1"


def test_valor_invalido():
    for v in ({"salario": -1}, {"fgts": "abc"}):
        with pytest.raises(HTTPException) as e:
            rs.salvar(F1, v, ADMIN, banco())
        assert e.value.status_code == 422


def test_funcionario_de_outro_tenant():
    with pytest.raises(HTTPException) as e:
        rs.salvar(F3, {"salario": 1}, ADMIN, banco())
    assert e.value.status_code == 404


def test_custos_por_centro():
    db = banco()
    rs.salvar(F1, {"salario": 3000, "fgts": 240, "plano_saude": 400, "rescisao": 9000}, ADMIN, db)
    rs.salvar(F2, {"salario": 2000}, ADMIN, db)              # inativo: fora
    c = rs.custos(ADMIN, db)
    assert list(c["por_funcionario"]) == [F1]
    assert c["por_centro"]["venda_nova"] == {"pessoas": 1, "custo_mensal": 3640.0}
    assert c["total_mes"] == 3640.0
