"""Importação de extrato (28/11/2026): centro por linha com sugestão pelo
histórico e De x Para de duplicidade (mesmo valor + lado + mês)."""
import asyncio

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import extrato_service as es
from etl.extrato_parser import ExtratoParse, TransacaoExtrato
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id=uid(1), email="a@x", role="admin", tenant_id="t1")
CONTADOR = UsuarioAtual(user_id=uid(2), email="c@x", role="contador", tenant_id="t1")


def _centro(n, codigo, parent=None):
    return {"id": uid(300 + n), "nome": codigo, "codigo": codigo, "ativo": True, "parent_id": parent,
            "numero": None, "ordem": 0, "tenant_id": "t1"}


def _banco():
    return Db(
        centros_custo=[_centro(1, "matriz"), _centro(2, "financeiro", parent=uid(301)), _centro(3, "socorro")],
        despesas=[
            {"id": uid(10), "descricao": "Boleto aluguel", "valor": "1500.00", "competencia": "2026-11-01",
             "data_vencimento": "2026-11-05", "paga_em": None, "status": "aprovada", "centro_custo": "financeiro",
             "criado_por": uid(9), "tenant_id": "t1", "atualizado_em": "2026-11-02"},
            {"id": uid(11), "descricao": "TARIFA PACOTE", "valor": "45.00", "competencia": "2026-10-01",
             "data_vencimento": "2026-10-03", "paga_em": "2026-10-03", "status": "aprovada", "centro_custo": "socorro",
             "criado_por": uid(9), "tenant_id": "t1", "atualizado_em": "2026-10-03"},
        ],
        receitas_outras=[
            {"id": uid(20), "descricao": "Repasse", "valor": "1500.00", "competencia": "2026-11-01",
             "data_vencimento": None, "recebido_em": "2026-11-04", "status": "aprovada", "centro_custo": "matriz",
             "criado_por": uid(9), "tenant_id": "t1", "atualizado_em": "2026-11-04"},
        ],
    )


def _extrato(monkeypatch, *linhas):
    trans = [TransacaoExtrato(data=d, descricao=desc, valor=v, tipo="credito" if v >= 0 else "debito")
             for d, desc, v in linhas]
    monkeypatch.setattr(es, "parsear", lambda *_a: ExtratoParse(banco="Itaú", banco_confirmado=True,
                                                               formato="txt_itau", conta="1", transacoes=trans))


def test_similar_no_sistema_por_valor_lado_e_mes(monkeypatch):
    _extrato(monkeypatch,
             ("2026-11-05", "PAG BOLETO 123", -1500.00),   # = despesa 10 (descrição diferente)
             ("2026-11-06", "PIX RECEBIDO", 1500.00),       # = receita 20 (outro lado)
             ("2026-12-05", "PAG BOLETO 123", -1500.00))    # outro mês: nada
    p = es.gerar_preview(b"", "x.txt", ADMIN, _banco())
    desp, rec, dez = p["itens"]
    assert [s["id"] for s in desp["similares_sistema"]] == [uid(10)]
    assert desp["similares_sistema"][0]["tabela"] == "despesas" and desp["duplicata"]
    assert desp["similares_sistema"][0]["situacao"] == "A pagar"
    assert [s["id"] for s in rec["similares_sistema"]] == [uid(20)]
    assert rec["similares_sistema"][0]["situacao"] == "Recebida 04/11"
    assert dez["similares_sistema"] == [] and not dez["duplicata"]
    assert p["resumo"]["duplicatas"] == 2


def test_repetidos_no_proprio_arquivo(monkeypatch):
    _extrato(monkeypatch,
             ("2026-11-03", "TARIFA", -12.50),
             ("2026-11-20", "TARIFA 2", -12.50),
             ("2026-11-21", "ESTORNO TARIFA", 12.50))      # outro lado: não agrupa
    p = es.gerar_preview(b"", "x.txt", ADMIN, _banco())
    a, b, c = p["itens"]
    assert a["grupo_arquivo"] and a["grupo_arquivo"] == b["grupo_arquivo"]
    assert c["grupo_arquivo"] is None
    assert p["resumo"]["grupos_arquivo"] == 1


def test_centro_sugerido_pelo_historico(monkeypatch):
    _extrato(monkeypatch, ("2026-11-03", "Tarifa pacote", -45.00), ("2026-11-04", "Nada parecido", -9.0))
    p = es.gerar_preview(b"", "x.txt", ADMIN, _banco())
    assert p["itens"][0]["centro_sugerido"] == "socorro" and p["itens"][0]["fonte_centro"] == "historico"
    assert p["itens"][1]["centro_sugerido"] is None


def test_historico_ignora_centro_que_virou_grupo(monkeypatch):
    db = _banco()
    db.tabelas["despesas"][1]["centro_custo"] = "matriz"      # matriz tem subgrupo
    _extrato(monkeypatch, ("2026-11-03", "Tarifa pacote", -45.00))
    assert es.gerar_preview(b"", "x.txt", ADMIN, db)["itens"][0]["centro_sugerido"] is None


def _confirmar(db, usuario, *itens, centro="socorro"):
    payload = es.ConfirmarExtratoRequest(banco_id=None, centro_custo=centro, itens=list(itens))
    return asyncio.run(es.confirmar(payload, usuario, db))


def test_confirmar_grava_centro_por_linha():
    db = _banco()
    r = _confirmar(db, ADMIN,
                   es.ExtratoItemConfirm(data="2026-11-03", descricao="A", valor=10, tipo="despesa", centro_custo="financeiro"),
                   es.ExtratoItemConfirm(data="2026-11-03", descricao="B", valor=20, tipo="receita"))
    assert r["total_importado"] == 2
    novas = {d["descricao"]: d["centro_custo"] for d in db.tabelas["despesas"] + db.tabelas["receitas_outras"]}
    assert novas["A"] == "financeiro" and novas["B"] == "socorro"


def test_confirmar_recusa_grupo_na_linha():
    with pytest.raises(HTTPException) as e:
        _confirmar(_banco(), ADMIN,
                   es.ExtratoItemConfirm(data="2026-11-03", descricao="A", valor=10, tipo="despesa", centro_custo="matriz"))
    assert e.value.status_code == 422


def test_substituir_exclui_o_do_sistema_depois_de_gravar():
    db = _banco()
    r = _confirmar(db, ADMIN, es.ExtratoItemConfirm(
        data="2026-11-05", descricao="PAG BOLETO", valor=1500, tipo="despesa",
        substituir={"tabela": "despesas", "id": uid(10)}))
    assert r["substituidos"] == 1 and r["despesas"] == 1
    antiga = next(d for d in db.tabelas["despesas"] if d["id"] == uid(10))
    assert antiga["status"] == "excluida"


def test_substituir_receita_remove_a_receita():
    db = _banco()
    r = _confirmar(db, ADMIN, es.ExtratoItemConfirm(
        data="2026-11-06", descricao="PIX", valor=1500, tipo="receita",
        substituir={"tabela": "receitas_outras", "id": uid(20)}))
    assert r["substituidos"] == 1
    assert uid(20) not in {x["id"] for x in db.tabelas["receitas_outras"]}


def test_contador_nao_substitui_despesa_aprovada_de_outro():
    db = _banco()
    with pytest.raises(HTTPException) as e:
        _confirmar(db, CONTADOR, es.ExtratoItemConfirm(
            data="2026-11-05", descricao="X", valor=1500, tipo="despesa",
            substituir={"tabela": "despesas", "id": uid(10)}))
    assert e.value.status_code == 403
    assert len(db.tabelas["despesas"]) == 2          # nada gravado


def test_substituir_de_outro_tenant_da_404():
    db = _banco()
    db.tabelas["despesas"][0]["tenant_id"] = "t2"
    with pytest.raises(HTTPException) as e:
        _confirmar(db, ADMIN, es.ExtratoItemConfirm(
            data="2026-11-05", descricao="X", valor=1500, tipo="despesa",
            substituir={"tabela": "despesas", "id": uid(10)}))
    assert e.value.status_code == 404


def test_linha_sem_centro_e_sem_padrao_da_422():
    with pytest.raises(HTTPException) as e:
        _confirmar(_banco(), ADMIN,
                   es.ExtratoItemConfirm(data="2026-11-03", descricao="A", valor=10, tipo="despesa"), centro=None)
    assert e.value.status_code == 422
