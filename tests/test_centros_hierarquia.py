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


def test_numero_segue_depois_do_9():
    assert [fs.numero_sub("1", k) for k in (1, 9, 10, 11)] == ["1.1", "1.9", "2.0", "2.1"]
    assert [fs.numero_sub("1.10", k) for k in (1, 9, 10)] == ["1.11", "1.19", "1.20"]
    assert fs.numero_sub(None, 1) is None and fs.numero_sub("abc", 1) is None


def _matriz():
    """Produção em 24/11: Matriz "1" com 1.1, 1.3 … 1.9 e 2.0 (sem 1.2)."""
    nomes = ["Financeiro", "Venda Nova", "Renovação", "Benefícios", "Sinistros", "TI", "Emissão",
             "Gerência", "Presidência"]
    nums = ["1.1", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "2.0"]
    subs = [centro(_u(100 + i), f"c{i}", n, parent=M, numero=num) for i, (n, num) in enumerate(zip(nomes, nums))]
    return Db(centros_custo=[centro(M, "matriz", "Matriz", numero="1")] + subs, despesas=[], receitas_outras=[])


def _numeros(db, grupo=M):
    return [c["numero"] for c in sorted((c for c in db.tabelas["centros_custo"] if c["parent_id"] == grupo),
                                        key=fs._chave_ordem)]


def test_criar_compacta_e_entra_no_fim():
    db = _matriz()
    item = run(fs.criar_centro_custo(CentroCustoCreate(nome="Novo", parent_id=M), ADMIN, db))
    assert item.numero == "2.0"
    assert _numeros(db) == ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "2.0"]
    presid = next(c for c in db.tabelas["centros_custo"] if c["nome"] == "Presidência")
    assert presid["numero"] == "1.9"


def test_excluir_sobe_os_seguintes():
    db = _matriz()
    emissao = next(c for c in db.tabelas["centros_custo"] if c["nome"] == "Emissão")
    run(fs.excluir_centro_custo(emissao["id"], ADMIN, db))
    nomes = {c["numero"]: c["nome"] for c in db.tabelas["centros_custo"] if c["parent_id"] == M}
    assert nomes["1.6"] == "TI" and nomes["1.7"] == "Gerência" and nomes["1.8"] == "Presidência"
    assert len(nomes) == 8


def test_mover_troca_com_o_vizinho():
    db = _matriz()
    ti = next(c for c in db.tabelas["centros_custo"] if c["nome"] == "TI")
    assert run(fs.mover_centro(ti["id"], "cima", ADMIN, db)).numero == "1.5"
    sin = next(c for c in db.tabelas["centros_custo"] if c["nome"] == "Sinistros")
    assert sin["numero"] == "1.6"
    fin = next(c for c in db.tabelas["centros_custo"] if c["nome"] == "Financeiro")
    assert run(fs.mover_centro(fin["id"], "cima", ADMIN, db)).numero == "1.1"   # já é o primeiro


def test_trocar_de_grupo_renumera_os_dois():
    db = _banco_numeros()
    a = run(fs.criar_centro_custo(CentroCustoCreate(nome="A", parent_id=G1), ADMIN, db))
    b = run(fs.criar_centro_custo(CentroCustoCreate(nome="B", parent_id=G1), ADMIN, db))
    assert (a.numero, b.numero) == ("1.11", "1.12")
    movido = run(fs.atualizar_centro_custo(a.id, CentroCustoUpdate(parent_id=M), ADMIN, db))
    assert movido.numero == "1.1"
    assert _numeros(db, G1) == ["1.11"]


def test_numero_do_grupo_muda_e_filhos_seguem():
    db = _banco_numeros()
    run(fs.criar_centro_custo(CentroCustoCreate(nome="A", parent_id=G1), ADMIN, db))
    run(fs.atualizar_centro_custo(G1, CentroCustoUpdate(numero="3.20"), ADMIN, db))
    assert _numeros(db, G1) == ["3.21"]


def test_numero_de_grupo_repetido_da_409():
    db = _banco_numeros()
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
