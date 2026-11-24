"""Ordem de Compra com perfil Colaborador e despesa gerada na aprovação (0047)."""
import asyncio
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual, rota_liberada_colaborador
from app.models.schemas import OrdemCompraAprovacao, OrdemCompraCreate, OrdemCompraUpdate
from app.services import ordens_compra_service as svc
from tests.fake_supabase import Db, uid

COLAB = UsuarioAtual(user_id=uid(50), email="joao@mx", role="colaborador", tenant_id="t1")
ADMIN = UsuarioAtual(user_id=uid(51), email="a@mx", role="admin", tenant_id="t1")
GASOLINA, SAUDE, GRUPO = uid(60), "saude_vida", "venda_nova"


def banco():
    # Na tabela real, a coluna existe e vem nula; o fake só devolve o que foi gravado.
    return Db(
        {"ordens_compra": {"despesa_id": None, "rejeitado_motivo": None}},
        usuarios=[{"id": uid(50), "nome": "João da Silva"}],
        centros_custo=[
            {"id": uid(70), "codigo": GRUPO, "nome": "Venda Nova", "ativo": True, "parent_id": None, "tenant_id": "t1"},
            {"id": uid(71), "codigo": SAUDE, "nome": "Saúde e Vida", "ativo": True, "parent_id": uid(70), "tenant_id": "t1"},
        ],
        subitens_lancamento=[{"id": GASOLINA, "nome": "Combustível", "natureza": "despesa",
                              "categoria": "veiculos", "custo_tipo": "variavel", "tenant_id": "t1"}],
        ordens_compra=[], despesas=[], anexos=[], fechamentos=[],
    )


@pytest.fixture
def db(monkeypatch):
    b = banco()
    monkeypatch.setattr(svc, "get_supabase_admin", lambda: b)
    return b


def criar(db, **kw):
    dados = {"assunto": "Gasolina viagem SP", "descricao": "Abastecimento ida e volta", "valor": 150,
             "data_prevista": date.today(), **kw}
    return asyncio.run(svc.criar_ordem_compra(OrdemCompraCreate(**dados), COLAB, db))


@pytest.mark.parametrize("metodo,caminho,ok", [
    ("GET", "/usuarios/me", True),
    ("POST", "/ordens-compra", True),
    ("GET", "/ordens-compra", True),
    ("PATCH", f"/ordens-compra/{uid(1)}", True),
    ("PATCH", f"/ordens-compra/{uid(1)}/aprovar", False),
    ("POST", "/anexos/upload-url", True),
    ("GET", "/configuracoes/centros-custo", True),
    ("POST", "/configuracoes/centros-custo", False),
    ("GET", "/lancamentos/despesas", False),
    ("GET", "/dashboard/despesas-dia-mes", False),
    ("GET", "/dre/periodo", False),
    ("GET", "/relatorios/dados", False),
])
def test_colaborador_so_alcanca_a_ordem_de_compra(metodo, caminho, ok):
    assert rota_liberada_colaborador(metodo, caminho) is ok


def test_colaborador_e_sempre_o_solicitante(db):
    item = criar(db, solicitante="Outra Pessoa")
    assert item.solicitante == "João da Silva" and item.status == "pendente"
    assert item.data_prevista == date.today()


def test_ordem_nao_vai_para_grupo(db):
    with pytest.raises(HTTPException) as e:
        criar(db, centro_custo=GRUPO)
    assert e.value.status_code == 422


def aprovar(db, ordem_id, **kw):
    ap = OrdemCompraAprovacao(tipo_lancamento_id=GASOLINA, centro_custo=SAUDE, **kw)
    return asyncio.run(svc.aprovar_ordem_compra(ordem_id, ADMIN, db, ap))


def test_aprovar_gera_despesa_com_anexo_e_uma_vez_so(db):
    ordem = criar(db)
    db.tabelas["anexos"].append({"id": uid(90), "entidade": "ordem_compra", "entidade_id": str(ordem.id),
                                 "path": "t1/ordem_compra/x/nota.jpg", "tenant_id": "t1", "nome_arquivo": "nota.jpg"})
    item = aprovar(db, ordem.id)
    assert item.status == "aprovada" and item.despesa_id
    [d] = db.tabelas["despesas"]
    assert d["criado_por"] == COLAB.user_id and d["status"] == "aprovada" and not d.get("paga_em")
    assert Decimal(d["valor"]) == 150 and d["centro_custo"] == SAUDE and d["categoria"] == "veiculos"
    assert d["competencia"] == date.today().replace(day=1).isoformat()
    assert d["data_vencimento"] == date.today().isoformat()
    assert [a["entidade_id"] for a in db.tabelas["anexos"] if a["entidade"] == "despesa"] == [d["id"]]
    # Aprovar de novo não lança outra despesa.
    aprovar(db, ordem.id)
    assert len(db.tabelas["despesas"]) == 1


def test_aprovar_exige_subitem_e_centro(db):
    ordem = criar(db)
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.aprovar_ordem_compra(ordem.id, ADMIN, db, None))
    assert e.value.status_code == 422
    assert db.tabelas["despesas"] == []


def test_mes_fechado_bloqueia(db):
    ordem = criar(db)
    db.tabelas["fechamentos"].append({"id": uid(80), "competencia": date.today().replace(day=1).isoformat(),
                                      "reaberto_em": None})
    with pytest.raises(HTTPException) as e:
        aprovar(db, ordem.id)
    assert e.value.status_code == 409 and db.tabelas["despesas"] == []


def test_ordem_lancada_nao_muda_mais(db):
    ordem = criar(db)
    aprovar(db, ordem.id)
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.atualizar_ordem_compra(ordem.id, OrdemCompraUpdate(valor=999), db, COLAB))
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        asyncio.run(svc.rejeitar_ordem_compra(ordem.id, "não", ADMIN, db))


def test_colaborador_corrige_ordem_rejeitada(db):
    ordem = criar(db)
    asyncio.run(svc.rejeitar_ordem_compra(ordem.id, "Falta a nota", ADMIN, db))
    item = asyncio.run(svc.atualizar_ordem_compra(ordem.id, OrdemCompraUpdate(valor=120), db, COLAB))
    assert item.status == "pendente" and item.valor == 120 and item.rejeitado_motivo is None
