"""Salários confidenciais (0046): quem não é Admin vê só o total."""
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import confidencial as conf
from app.services import relatorio_service as rs
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="u-gestor", email="g@x", role="gestor", tenant_id="t1")
CONTADOR = UsuarioAtual(user_id="u-cont", email="c@x", role="contador", tenant_id="t1")

FOLHA, ALUGUEL = uid(1), uid(2)


def desp(id_, valor, comp, sub=FOLHA, descricao="Salário Fulano", pago=None, status="aprovada"):
    return {"id": uid(id_), "valor": str(valor), "competencia": comp, "data_vencimento": comp,
            "paga_em": pago, "status": status, "tipo_lancamento_id": sub, "descricao": descricao,
            "subitens_lancamento": {"nome": "Folha - Salários", "categorias_lancamento": {"nome": "Pessoal"}},
            "centro_custo": "matriz", "criado_por": uid(99), "categoria": "pessoal"}


def db():
    return Db(subitens_lancamento=[
        {"id": FOLHA, "confidencial": True}, {"id": ALUGUEL, "confidencial": False},
    ])


LINHAS = [
    desp(10, 3000, "2026-11-01", descricao="Salário Ana", pago="2026-11-05"),
    desp(11, 4500, "2026-11-01", descricao="Salário Bruno", pago="2026-11-05"),
    desp(12, 2000, "2026-11-01", descricao="Salário Caio"),
    desp(13, 1000, "2026-10-01", descricao="Salário Ana", pago="2026-10-05"),
    desp(14, 900, "2026-11-01", sub=ALUGUEL, descricao="Aluguel"),
]


def test_agrega_por_mes_e_situacao_sem_nomes():
    somas = conf.agregar([r for r in LINHAS if r["tipo_lancamento_id"] == FOLHA], "t1")
    chaves = {(s["competencia"], s["paga_em"] is not None): (Decimal(s["valor"]), s["quantidade"]) for s in somas}
    assert chaves == {
        ("2026-11-01", True): (Decimal(7500), 2),
        ("2026-11-01", False): (Decimal(2000), 1),
        ("2026-10-01", True): (Decimal(1000), 1),
    }
    assert all(s["descricao"] == conf.ROTULO and s["agregado"] for s in somas)
    assert not any("Ana" in str(v) or "Bruno" in str(v) for s in somas for v in s.values())
    # id estável entre chamadas (chave da tela), sem colidir entre grupos
    assert [s["id"] for s in somas] == [s["id"] for s in conf.agregar(LINHAS[:4], "t1")]
    assert len({s["id"] for s in somas}) == 3


def test_pendente_fica_em_grupo_proprio():
    somas = conf.agregar([desp(20, 100, "2026-11-01", status="pendente"), desp(21, 50, "2026-11-01")])
    assert sorted(s["status"] for s in somas) == ["aprovada", "pendente"]


NOMES = {"classificacao": {}, "centro": {}, "centro_grupo": {}, "usuario": {}}


@pytest.mark.parametrize("usuario", [GESTOR, CONTADOR])
def test_relatorio_e_detalhe_colapsam_para_quem_nao_e_admin(usuario):
    itens = rs.linhas_despesas(LINHAS, NOMES, set(), usuario, db())
    descricoes = [i["descricao"] for i in itens]
    assert "Salário Ana" not in descricoes and "Aluguel" in descricoes
    assert descricoes.count(conf.ROTULO) == 3
    # A soma da lista continua igual à do número da tela.
    assert sum(i["valor"] for i in itens) == sum(float(r["valor"]) for r in LINHAS)
    assert all(i["agregado"] for i in itens if i["descricao"] == conf.ROTULO)


def test_admin_ve_o_detalhe():
    itens = rs.linhas_despesas(LINHAS, NOMES, set(), ADMIN, db())
    assert [i["descricao"] for i in itens] == [r["descricao"] for r in LINHAS]


def test_por_id_some_para_quem_nao_e_admin():
    linha = LINHAS[0]
    with pytest.raises(HTTPException) as e:
        conf.garantir_detalhe("despesa", linha, GESTOR, db())
    assert e.value.status_code == 404
    conf.garantir_detalhe("despesa", linha, ADMIN, db())
    conf.garantir_detalhe("despesa", LINHAS[4], GESTOR, db())
    conf.garantir_detalhe("receita", linha, GESTOR, db())


def test_sem_migration_nada_fica_oculto():
    class Quebrado:
        def table(self, _):
            raise RuntimeError("column confidencial does not exist")
    assert conf.ids_confidenciais(Quebrado()) == set()


def test_filtro_mantem_linhas_sem_subitem():
    class Q:
        def or_(self, f):
            self.f = f
            return self
    q = conf.sem_confidenciais(Q(), {FOLHA})
    assert q.f == f"tipo_lancamento_id.is.null,tipo_lancamento_id.not.in.({FOLHA})"


# ── Lista de Lançamentos ─────────────────────────────────────

def _banco_lancamentos():
    base = db()
    linhas = []
    for r in LINHAS:
        linhas.append({**r, "tenant_id": "t1", "data_ref": r["paga_em"] or r["competencia"],
                       "descricao_busca": r["descricao"].lower(), "subcategoria": r["descricao"],
                       "recorrente": False, "parcela_atual": None, "parcela_total": None, "banco_id": None,
                       "custo_tipo": None})
    base.tabelas["despesas"] = linhas
    return base


def _listar(usuario, monkeypatch, **kw):
    import asyncio
    from datetime import date
    from app.services import financeiro_service as fs
    banco = _banco_lancamentos()
    monkeypatch.setattr(fs, "get_supabase_admin", lambda: banco)
    return asyncio.run(fs.buscar_despesas(date(2026, 10, 1), date(2026, 11, 30), usuario, banco, **kw))


def test_lista_do_gestor_tem_so_o_total(monkeypatch):
    resp = _listar(GESTOR, monkeypatch, limit=200)
    descricoes = [i.descricao for i in resp.items]
    assert descricoes.count(conf.ROTULO) == 3 and "Salário Ana" not in descricoes
    assert resp.soma_total == sum(Decimal(r["valor"]) for r in LINHAS)
    assert resp.total == 4  # 3 totais + aluguel
    assert all(i.agregado for i in resp.items if i.descricao == conf.ROTULO)


def test_busca_por_nome_nao_revela_salario(monkeypatch):
    resp = _listar(GESTOR, monkeypatch, limit=200, busca="ana")
    assert resp.items == [] and resp.soma_total == 0


def test_lista_do_admin_tem_os_nomes(monkeypatch):
    resp = _listar(ADMIN, monkeypatch, limit=200)
    assert sorted(i.descricao for i in resp.items) == sorted(r["descricao"] for r in LINHAS)


def test_totais_so_na_primeira_pagina(monkeypatch):
    resp = _listar(GESTOR, monkeypatch, limit=200, offset=200)
    assert not any(i.agregado for i in resp.items)
    assert resp.soma_total == sum(Decimal(r["valor"]) for r in LINHAS)


@pytest.mark.parametrize("usuario", [ADMIN, GESTOR])
def test_resumo_paga_a_pagar_vencida_soma_o_total(usuario, monkeypatch):
    """Resumo da aba Despesas (26/11/2026): pago + a pagar + vencido = total,
    para o Admin (linhas) e para o Gestor (com o total de salários)."""
    from datetime import date as d
    from app.services import financeiro_service as fs
    monkeypatch.setattr(fs, "hoje_brasil", lambda: d(2026, 11, 15))
    resp = _listar(usuario, monkeypatch, limit=200)
    assert resp.soma_paga + resp.soma_a_pagar + resp.soma_vencida == resp.soma_total
    # Pagas: Ana 3000 + Bruno 4500 (nov) e Ana 1000 (out). Em aberto, vencimento
    # 01/11 < hoje (15/11): Caio 2000 e Aluguel 900 ficam vencidas.
    assert resp.soma_paga == Decimal(8500)
    assert resp.soma_vencida == Decimal(2900)
    assert resp.soma_a_pagar == 0
    if usuario is ADMIN:
        assert (resp.qtd_paga, resp.qtd_vencida) == (3, 2)
