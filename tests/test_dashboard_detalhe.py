"""Modal da Visão Geral: a soma da lista precisa ser igual ao número da tela."""
import asyncio
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.routers.dashboard import exigir_lancamentos
from app.services.dashboard_detalhe_service import detalhe
from app.services.dashboard_service import (
    buscar_aplicacoes, buscar_despesas_por_classificacao, buscar_emprestimos, buscar_por_banco,
)
from tests.test_dashboard_saldo_periodo import NOV, OUT, SANTANDER, Banco, desp, rec

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin")
GESTOR = UsuarioAtual(user_id="u-gestor", email="g@x", role="gestor")
CONTADOR = UsuarioAtual(user_id="u-contador", email="c@x", role="contador")
COMERCIAL = UsuarioAtual(user_id="u-comercial", email="v@x", role="comercial")


def _de(usuario, linha):
    return {**linha, "criado_por": usuario.user_id}


def banco_real():
    """Cada grupo tem o que entra e o que precisa ficar fora."""
    return Banco(
        despesas=[
            # Empréstimo: outubro e novembro; sem data, excluída e de antes de outubro ficam fora.
            desp("s-emp-d", 1000, "2026-10-10"), desp("s-emp-d", 250, "2026-11-10"),
            desp("s-emp-d", 999, "2026-11-11", pago=False), desp("s-emp-d", 999, "2026-11-12", status="excluida"),
            desp("s-emp-d", 999, "2026-09-30"), desp("s-emp-d", 700, "2026-11-13", banco=SANTANDER),
            # Aplicação.
            desp("s-apl-d", 300, "2026-10-05"), desp("s-apl-d", 40, "2026-11-05"),
            # Card do banco: Fixo e Variável pagos; os demais ficam fora.
            desp(None, 100, "2026-10-10"), desp(None, 30, "2026-11-10"), desp(None, 7, "2026-11-11", custo="variavel"),
            desp(None, 999, "2026-11-12", pago=False), desp(None, 999, "2026-11-13", custo="aplicacoes"),
            desp(None, 11, "2026-11-14", banco=SANTANDER),
            # Centro de custo.
            {**desp(None, 60, "2026-11-15", pago=False), "centro_custo": "guincho"},
            {**desp(None, 999, "2026-11-16", status="excluida"), "centro_custo": "guincho"},
        ],
        receitas=[
            rec("s-inicial", 100000, "2026-10-01", custo="aplicacoes"),
            rec("s-inicial", 50000, "2026-10-01", banco=SANTANDER, recebido=False, custo="aplicacoes"),
            rec("s-emp-r", 200, "2026-10-11"), rec("s-emp-r", 999, "2026-11-11", recebido=False),
            rec("s-apl-r", 5, "2026-11-06"),
            rec("s-vendas", 500, "2026-10-10"), rec("s-vendas", 80, "2026-11-10"), rec("s-vendas", 13, "2026-11-11", banco=SANTANDER),
            rec("s-vendas", 999, "2026-11-12", recebido=False), rec("s-vendas", 999, "2026-11-13", custo="adiantamento_cliente"),
            {**rec("s-vendas", 25, "2026-11-14"), "centro_custo": "guincho"},
        ],
    )


def pedir(db, bloco, periodo=NOV, usuario=ADMIN, **filtros):
    return asyncio.run(detalhe(bloco, *periodo, "pagamento", usuario, db, **filtros))


def card(db, periodo, nome):
    resp = asyncio.run(buscar_por_banco(*periodo, db, base="pagamento"))
    return next(b for b in resp.bancos if b.banco_nome == nome)


def quadro(buscar, db, periodo, nome):
    resp = asyncio.run(buscar(*periodo, db, base="pagamento"))
    return next(b for b in resp.bancos if b.banco == nome)


# ── A soma da lista é o número da tela ───────────────────────

@pytest.mark.parametrize("periodo", [OUT, NOV])
@pytest.mark.parametrize("nome", ["Itaú", "Santander"])
def test_box_saldo_do_periodo(periodo, nome):
    db = banco_real()
    c = card(db, periodo, nome)
    emp = quadro(buscar_emprestimos, db, periodo, nome).saldo_acumulado
    apl = quadro(buscar_aplicacoes, db, periodo, nome).saldo_acumulado
    inicial = c.saldo_inicial + c.saldo_anterior
    assert pedir(db, "saldo_inicial", periodo, banco=nome)["valor"] == inicial
    assert pedir(db, "box_emprestimo", periodo, banco=nome)["valor"] == emp
    assert pedir(db, "box_aplicacao", periodo, banco=nome)["valor"] == apl
    assert pedir(db, "box_banco", periodo, banco=nome)["valor"] == c.saldo
    assert pedir(db, "resultado", periodo, banco=nome)["valor"] == inicial + emp + apl + c.saldo


@pytest.mark.parametrize("nome", ["Itaú", "Santander"])
def test_por_banco(nome):
    db = banco_real()
    c = card(db, NOV, nome)
    assert pedir(db, "por_banco", banco=nome, lado="receitas")["valor"] == c.receitas
    assert pedir(db, "por_banco", banco=nome, lado="despesas")["valor"] == c.despesas
    assert pedir(db, "por_banco", banco=nome)["valor"] == c.saldo


def test_por_banco_total_soma_os_bancos():
    db = banco_real()
    i, s = card(db, NOV, "Itaú"), card(db, NOV, "Santander")
    assert pedir(db, "por_banco", lado="receitas")["valor"] == i.receitas + s.receitas
    assert pedir(db, "por_banco", lado="despesas")["valor"] == i.despesas + s.despesas
    assert pedir(db, "por_banco")["valor"] == i.saldo + s.saldo


@pytest.mark.parametrize("bloco, buscar", [("emprestimos", buscar_emprestimos), ("aplicacoes", buscar_aplicacoes)])
@pytest.mark.parametrize("nome", ["Itaú", "Santander"])
def test_quadros(bloco, buscar, nome):
    db = banco_real()
    q = quadro(buscar, db, NOV, nome)
    assert pedir(db, bloco, banco=nome)["valor"] == q.saldo
    assert pedir(db, bloco, banco=nome, lado="receitas")["valor"] == q.receitas.total
    assert pedir(db, bloco, banco=nome, lado="despesas")["valor"] == q.despesas.total
    for lado, itens in (("receitas", q.receitas.itens), ("despesas", q.despesas.itens)):
        for i in itens:
            r = pedir(db, bloco, banco=nome, lado=lado, subitem=i.subitem)
            assert (r["valor"], r["total"]) == (i.valor, i.qtd)


def test_classificacao():
    db = banco_real()
    r = asyncio.run(buscar_despesas_por_classificacao(*NOV, db, base="pagamento"))
    assert pedir(db, "classificacao", classificacao="fixo")["valor"] == r.fixas
    assert pedir(db, "classificacao", classificacao="variavel")["valor"] == r.variaveis
    assert pedir(db, "classificacao", classificacao="nao_operacional")["valor"] == r.nao_operacionais


def test_classificacao_inclui_nao_pagas_como_o_card():
    db = Banco(despesas=[desp(None, 10, "2026-11-10"), desp(None, 20, "2026-11-11", pago=False)])
    assert pedir(db, "classificacao", classificacao="fixo")["valor"] == Decimal(30)


def test_nao_classificada():
    db = Banco(despesas=[{**desp(None, 15, "2026-11-10"), "custo_tipo": None}, desp(None, 20, "2026-11-11")])
    r = asyncio.run(buscar_despesas_por_classificacao(*NOV, db, base="pagamento"))
    assert pedir(db, "classificacao", classificacao="nao_classificada")["valor"] == r.nao_classificadas == Decimal(15)


def test_centro_de_custo():
    db = banco_real()
    assert pedir(db, "centro", centro="Socorro", lado="despesas")["valor"] == Decimal(60)
    assert pedir(db, "centro", centro="Socorro", lado="receitas")["valor"] == Decimal(25)
    assert pedir(db, "centro", centro="Socorro")["valor"] == Decimal(-35)


def test_lista_de_um_banco_nao_vem_vazia():
    # Regressão: a consulta não pedia banco_id e todo lançamento caía em "Sem banco".
    db = Banco(despesas=[desp("s-emp-d", 250, "2026-11-10"), desp("s-emp-d", 700, "2026-11-11", banco=SANTANDER)])
    assert [i["valor"] for i in pedir(db, "emprestimos", banco="Itaú")["itens"]] == [250.0]
    assert [i["valor"] for i in pedir(db, "emprestimos", banco="Santander")["itens"]] == [700.0]


# ── O que a lista traz ───────────────────────────────────────

def test_linha_traz_as_colunas_da_tabela():
    db = Banco(despesas=[desp("s-emp-d", 250, "2026-11-10")])
    r = pedir(db, "emprestimos", banco="Itaú")
    item = r["itens"][0]
    assert (r["total"], item["tipo"], item["valor"], item["data"]) == (1, "Despesa", 250.0, "2026-11-10")


def test_saldo_inicial_lista_o_lancamento_e_o_mes_anterior():
    db = banco_real()
    r = pedir(db, "saldo_inicial", banco="Itaú")
    assert sorted(i["valor"] for i in r["itens"]) == [100.0, 500.0, 100000.0]
    assert r["valor"] == Decimal(100400)


def test_saldo_inicial_em_outubro_nao_tem_mes_anterior():
    r = pedir(banco_real(), "saldo_inicial", OUT, banco="Itaú")
    assert [i["valor"] for i in r["itens"]] == [100000.0]


def test_periodo_antes_de_outubro_nao_lista_acumulado():
    set26 = (date(2026, 9, 1), date(2026, 9, 30))
    assert pedir(banco_real(), "box_emprestimo", set26, banco="Itaú")["itens"] == []


# ── Parâmetros ───────────────────────────────────────────────

@pytest.mark.parametrize("bloco", ["saldo_inicial", "box_emprestimo", "box_aplicacao", "box_banco", "resultado", "emprestimos", "aplicacoes"])
def test_bloco_de_banco_exige_o_banco(bloco):
    with pytest.raises(HTTPException) as e:
        pedir(banco_real(), bloco)
    assert e.value.status_code == 422


def test_centro_desconhecido_avisa():
    with pytest.raises(HTTPException) as e:
        pedir(banco_real(), "centro", centro="Inexistente")
    assert e.value.status_code == 422


# ── Quem vê o quê ────────────────────────────────────────────

def _misturado():
    return Banco(
        despesas=[_de(CONTADOR, desp(None, 10, "2026-11-10")), _de(ADMIN, desp(None, 20, "2026-11-11"))],
        receitas=[_de(COMERCIAL, rec("s-vendas", 30, "2026-11-10")), _de(ADMIN, rec("s-vendas", 40, "2026-11-11"))],
    )


@pytest.mark.parametrize("usuario", [ADMIN, GESTOR])
def test_admin_e_gestor_veem_tudo(usuario):
    r = pedir(_misturado(), "por_banco", usuario=usuario)
    assert (r["total"], r["parcial"], r["valor"]) == (4, False, Decimal(40))


def test_contador_ve_so_o_que_lancou():
    r = pedir(_misturado(), "por_banco", usuario=CONTADOR)
    assert (r["total"], r["parcial"], r["valor"]) == (1, True, Decimal(-10))


def test_comercial_nao_ve_despesas():
    db = _misturado()
    r = pedir(db, "por_banco", usuario=COMERCIAL)
    assert (r["total"], r["parcial"], r["valor"]) == (1, True, Decimal(30))
    assert pedir(db, "classificacao", usuario=COMERCIAL, classificacao="fixo")["itens"] == []


def test_recorte_de_visibilidade_vale_para_o_lancamento_de_saldo_inicial():
    db = Banco(receitas=[_de(ADMIN, rec("s-inicial", 100, "2026-10-01", custo="aplicacoes"))])
    assert pedir(db, "saldo_inicial", usuario=CONTADOR, banco="Itaú")["itens"] == []


@pytest.mark.parametrize("permissoes, permitido", [
    ({"lancamentos": {"visualizar": True}}, True),
    ({"lancamentos": {"visualizar": False}}, False),
    ({}, False),
])
def test_rota_exige_acesso_a_lancamentos(permissoes, permitido):
    usuario = UsuarioAtual(user_id="u", email="u@x", role="admin", permissions=permissoes)
    if permitido:
        exigir_lancamentos(usuario)
    else:
        with pytest.raises(HTTPException) as e:
            exigir_lancamentos(usuario)
        assert e.value.status_code == 403
