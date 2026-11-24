"""Centros de custo em grupos e subgrupos (0044)."""
import asyncio

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.models.schemas import CentroCustoCreate, CentroCustoUpdate
from app.services import financeiro_service as fs
from tests import fake_supabase
from tests.fake_supabase import uid as _u

G1, S1, S2, M, X = (_u(n) for n in range(1, 6))
ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1")
_PADRAO = {"centros_custo": {"ativo": True, "parent_id": None, "numero": None, "ordem": 0}}


def Db(**tabelas):
    return fake_supabase.Db(_PADRAO, **tabelas)



def centro(id_, codigo, nome, parent=None, numero=None, tenant="t1"):
    return {"id": id_, "codigo": codigo, "nome": nome, "ativo": True, "parent_id": parent,
            "numero": numero, "ordem": 0, "tenant_id": tenant}


def base():
    return Db(
        centros_custo=[
            centro(G1, "venda_nova", "Venda Nova", numero="1.00"),
            centro(S1, "saude_vida", "Saúde e Vida", parent=G1, numero="1.21"),
            centro(S2, "auto", "Auto", parent=G1, numero="1.22"),
            centro(M, "matriz", "Matriz"),
            centro(X, "outro", "De outro tenant", tenant="t2"),
        ],
        despesas=[{"id": "d1", "centro_custo": "matriz", "tenant_id": "t1"}],
        receitas_outras=[],
    )


def run(coro):
    return asyncio.run(coro)


def test_criar_grava_tenant_e_gera_codigo():
    db = base()
    item = run(fs.criar_centro_custo(CentroCustoCreate(nome="Saúde e Vida", parent_id=G1), ADMIN, db))
    novo = db.tabelas["centros_custo"][-1]
    assert novo["tenant_id"] == "t1" and novo["parent_id"] == G1
    assert item.codigo == "saude_e_vida"


def test_codigo_repetido_ganha_sufixo():
    db = base()
    item = run(fs.criar_centro_custo(CentroCustoCreate(nome="Auto"), ADMIN, db))
    assert item.codigo == "auto_2"


def test_so_dois_niveis():
    with pytest.raises(HTTPException) as e:
        run(fs.criar_centro_custo(CentroCustoCreate(nome="Neto", parent_id=S1), ADMIN, base()))
    assert e.value.status_code == 422


def test_grupo_com_filhos_nao_vira_subgrupo():
    with pytest.raises(HTTPException):
        run(fs.atualizar_centro_custo(G1, CentroCustoUpdate(parent_id=M), ADMIN, base()))


def test_excluir_bloqueia_grupo_com_filhos_e_centro_em_uso():
    for alvo in (G1, M):
        with pytest.raises(HTTPException) as e:
            run(fs.excluir_centro_custo(alvo, ADMIN, base()))
        assert e.value.status_code == 409
    db = base()
    run(fs.excluir_centro_custo(S2, ADMIN, db))
    assert all(c["id"] != S2 for c in db.tabelas["centros_custo"])


def test_nao_mexe_em_centro_de_outro_tenant():
    with pytest.raises(HTTPException) as e:
        run(fs.excluir_centro_custo(X, ADMIN, base()))
    assert e.value.status_code == 404


def test_filtro_por_grupo_traz_os_subgrupos():
    assert sorted(fs.expandir_centro(base(), "venda_nova")) == ["auto", "saude_vida", "venda_nova"]
    assert fs.expandir_centro(base(), "auto") == ["auto"]
    assert fs.expandir_centro(base(), "inexistente") == ["inexistente"]


def test_lancamento_nao_vai_para_grupo():
    with pytest.raises(HTTPException) as e:
        fs.validar_centro_lancamento(base(), "venda_nova")
    assert e.value.status_code == 422
    fs.validar_centro_lancamento(base(), "saude_vida")
    fs.validar_centro_lancamento(base(), "matriz")
    # Lançamento antigo que já estava no centro que virou grupo continua editável.
    fs.validar_centro_lancamento(base(), "venda_nova", atual="venda_nova")


def test_lista_ordena_pelo_numero():
    itens = run(fs.listar_centros_custo(base()))
    assert [i.numero for i in itens][:3] == ["1.00", "1.21", "1.22"]


# ── Numeração automática do subgrupo (24/11/2026) ────────────

def _banco_numeros():
    return Db(centros_custo=[
        centro(G1, "financeiro", "Financeiro", numero="1.10"),
        centro(M, "matriz", "Matriz", numero="1"),
        centro(S1, "contas", "Contas", numero=None),
    ], despesas=[], receitas_outras=[])


def test_subgrupo_segue_o_numero_do_grupo():
    db = _banco_numeros()
    nums = [run(fs.criar_centro_custo(CentroCustoCreate(nome=n, parent_id=G1), ADMIN, db)).numero
            for n in ("Bancos", "Tarifas", "Juros")]
    assert nums == ["1.11", "1.12", "1.13"]
    assert run(fs.criar_centro_custo(CentroCustoCreate(nome="Sede", parent_id=M), ADMIN, db)).numero == "1.1"


def test_numero_informado_vale_e_nao_repete():
    db = _banco_numeros()
    assert run(fs.criar_centro_custo(CentroCustoCreate(nome="X", parent_id=G1, numero="1.15"), ADMIN, db)).numero == "1.15"
    assert run(fs.criar_centro_custo(CentroCustoCreate(nome="Y", parent_id=G1), ADMIN, db)).numero == "1.16"
    with pytest.raises(HTTPException) as e:
        run(fs.criar_centro_custo(CentroCustoCreate(nome="Z", numero="1.10"), ADMIN, db))
    assert e.value.status_code == 409


def test_atrelar_centro_existente_ao_grupo_numera():
    db = _banco_numeros()
    item = run(fs.atualizar_centro_custo(S1, CentroCustoUpdate(parent_id=G1, numero=""), ADMIN, db))
    assert item.numero == "1.11" and str(item.parent_id) == G1


def test_grupo_sem_numero_nao_numera():
    db = _banco_numeros()
    db.tabelas["centros_custo"][0]["numero"] = None
    assert run(fs.criar_centro_custo(CentroCustoCreate(nome="Bancos", parent_id=G1), ADMIN, db)).numero is None
