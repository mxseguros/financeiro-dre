"""Remessa CNAB (fase 2) — validação, geração, concorrência e cancelamento."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import remessa_service as rs
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="a", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="g", email="g@x", role="gestor", tenant_id="t1")
COMERCIAL = UsuarioAtual(user_id="c", email="c@x", role="comercial", tenant_id="t1")
CONTA, ITAU, FORN, FUNC, SAL = uid(70), uid(71), uid(10), uid(11), uid(50)
D1, D2, D3, D4 = uid(1), uid(2), uid(3), uid(4)
DIA = date.today() + timedelta(days=3)


def _desp(i, **kw):
    base = dict(id=i, tenant_id="t1", status="aprovada", paga_em=None, valor="150.00", descricao=f"Despesa {i[-1]}",
                data_vencimento=DIA.isoformat(), competencia=DIA.replace(day=1).isoformat(), centro_custo="matriz",
                tipo_lancamento_id=None, fornecedor_id=FORN, forma_pagamento="pix", valor_pagamento=None,
                codigo_barras=None, linha_digitavel=None, vencimento_boleto=None, cedente_cpf_cnpj=None,
                cedente_nome=None, pix_copia_cola=None, tributo=None, status_pagamento=None, remessa_item_id=None)
    base.update(kw)
    return base


def banco(**conta_kw):
    conta = dict(id=CONTA, tenant_id="t1", codigo_banco="033", apelido=None, agencia="3501", agencia_dv=None,
                 conta="13000123", conta_dv="4", cnpj_empresa="11222333000181", razao_social="MX Seguros Ltda",
                 codigo_convenio="8145822", endereco={}, proximo_nsa=11, ambiente="homologacao",
                 opcoes={"enviar_bloqueado": True, "sequencial_teste": True}, ativa=True, banco_id=None)
    conta.update(conta_kw)
    db = Db(
        contas_pagadoras=[conta, {**conta, "id": ITAU, "codigo_banco": "341"}],
        fornecedores=[
            {"id": FORN, "tenant_id": "t1", "nome": "Papelaria", "cpf_cnpj": "11222333000181", "pix_tipo_chave": "email",
             "pix_chave": "f@p.com", "conta": None, "banco_codigo": None, "funcionario_id": None, "ativo": True},
            {"id": FUNC, "tenant_id": "t1", "nome": "Maria", "cpf_cnpj": "52998224725", "pix_tipo_chave": "cpf_cnpj",
             "pix_chave": "52998224725", "conta": None, "banco_codigo": None, "funcionario_id": uid(90), "ativo": True},
        ],
        despesas=[
            _desp(D1), _desp(D2, valor="300.00"),
            _desp(D3, forma_pagamento=None),
            _desp(D4, tipo_lancamento_id=SAL, fornecedor_id=FUNC, valor="2500.00"),
        ],
        subitens_lancamento=[{"id": SAL, "confidencial": True}],
        remessas=[], remessa_arquivos=[], remessa_itens=[], despesa_pagamento_eventos=[], bancos=[],
    )

    def reservar(db, params):
        c = next(x for x in db.tabelas["contas_pagadoras"] if x["id"] == params["p_conta_id"])
        c["proximo_nsa"] += 1
        return c["proximo_nsa"] - 1
    db.funcoes["cnab_reservar_nsa"] = reservar
    return db


def test_a_pagar_esconde_salario_do_gestor():
    db = banco()
    r = rs.a_pagar(GESTOR, db)
    assert {i["id"] for i in r["itens"]} == {D1, D2, D3} and r["ocultos"] == 1
    assert next(i for i in r["itens"] if i["id"] == D3)["pendencias"]
    assert len(rs.a_pagar(ADMIN, db)["itens"]) == 4
    with pytest.raises(HTTPException):
        rs.a_pagar(COMERCIAL, db)


def test_validar_aponta_pendencias():
    v = rs.validar(CONTA, DIA, [D1, D3, D4], GESTOR, banco())
    por_id = {i["despesa_id"]: i for i in v["itens"]}
    assert por_id[D1]["ok"] and not por_id[D3]["ok"] and not por_id[D4]["ok"]
    assert "Admin" in " ".join(por_id[D4]["erros"])
    assert any("REAL" in a for a in v["avisos"])            # NSA 11: o banco já trata como real
    v2 = rs.validar(CONTA, DIA, [D1], GESTOR, banco(proximo_nsa=3))
    assert any("TESTE" in a for a in v2["avisos"])


def test_gerar_remessa_completa():
    db = banco()
    r = rs.gerar(CONTA, DIA, [D1, D2, D4], ADMIN, db)
    assert r["status"] == "gerada" and r["qtd_itens"] == 3 and r["arquivos"][0]["nsa"] == 11
    assert db.tabelas["contas_pagadoras"][0]["proximo_nsa"] == 12
    texto = next(iter(db.arquivos.values())).decode("ascii")
    linhas = texto.split("\r\n")[:-1]
    assert all(len(l) == 240 for l in linhas) and linhas[0][157:163] == "000011"
    assert {d["status_pagamento"] for d in db.tabelas["despesas"] if d["id"] in (D1, D2, D4)} == {"em_remessa"}
    itens = db.tabelas["remessa_itens"]
    assert len({i["seu_numero"] for i in itens}) == 3 and all(i["seu_numero"].startswith("MX033000011") for i in itens)
    assert all(i["seu_numero"] in texto for i in itens)
    # salário (funcionário) em lote próprio, tipo de serviço 98
    assert any(l[7] == "1" and l[9:13] == "9845" for l in linhas)
    assert len(db.tabelas["despesa_pagamento_eventos"]) == 3
    assert rs.url_arquivo(r["id"], r["arquivos"][0]["id"], ADMIN, db)["url"].startswith("https://")


def test_despesa_nao_entra_em_duas_remessas():
    db = banco()
    rs.gerar(CONTA, DIA, [D1], ADMIN, db)
    with pytest.raises(HTTPException) as e:
        rs.gerar(CONTA, DIA, [D1, D2], ADMIN, db)
    assert e.value.status_code == 422
    assert db.tabelas["despesas"][1]["status_pagamento"] is None      # D2 não ficou presa


def test_corrida_desfaz_marcacao():
    db = banco()
    original = rs._marcar
    rs._marcar = lambda ids, u, d: original(ids[:1], u, d)            # só uma ficou livre
    try:
        with pytest.raises(HTTPException) as e:
            rs.gerar(CONTA, DIA, [D1, D2], ADMIN, db)
    finally:
        rs._marcar = original
    assert e.value.status_code == 409
    assert all(d["status_pagamento"] is None for d in db.tabelas["despesas"])
    assert db.tabelas["remessas"] == [] and db.tabelas["contas_pagadoras"][0]["proximo_nsa"] == 11


def test_cancelar_devolve_despesas():
    db = banco()
    r = rs.gerar(CONTA, DIA, [D1, D2], GESTOR, db)
    rs.marcar_enviada(r["id"], GESTOR, db)
    c = rs.cancelar(r["id"], GESTOR, db)
    assert c["status"] == "cancelada"
    assert all(d["status_pagamento"] is None and d["remessa_item_id"] is None
               for d in db.tabelas["despesas"] if d["id"] in (D1, D2))
    assert rs.validar(CONTA, DIA, [D1], GESTOR, db)["validos"] == 1
    with pytest.raises(HTTPException):
        rs.cancelar(r["id"], GESTOR, db)


def test_itau_ainda_nao_e_comercial_nao_gera():
    with pytest.raises(HTTPException) as e:
        rs.validar(ITAU, DIA, [D1], ADMIN, banco())
    assert "Itaú" in e.value.detail
    with pytest.raises(HTTPException) as e:
        rs.gerar(CONTA, DIA, [D1], COMERCIAL, banco())
    assert e.value.status_code == 403


def test_producao_com_sequencial_teste_exige_nsa_11():
    db = banco(ambiente="producao", proximo_nsa=5)
    with pytest.raises(HTTPException) as e:
        rs.gerar(CONTA, DIA, [D1], ADMIN, db)
    assert "11" in e.value.detail


def test_seu_numero_tem_dv():
    from app.cnab.barcode import mod10
    sn = rs.seu_numero("033", 11, 1)
    assert sn[:17] == "MX033000011000001" and sn[17] == str(mod10("033000011000001")) and len(sn) == 18


def test_despesa_em_remessa_nao_muda_valor_nem_some():
    from app.services.financeiro_service import garantir_sem_pagamento_no_banco as g
    db = Db(despesas=[{"id": D1, "status_pagamento": "em_remessa", "valor": "150.00", "paga_em": None,
                       "parcela_total": None, "recorrente": False}])
    g(db, D1, "editar", {"valor": "150", "paga_em": None})          # nada muda de verdade: passa
    with pytest.raises(HTTPException) as e:
        g(db, D1, "editar", {"valor": "160"})
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        g(db, D1, "excluir")
    db.tabelas["despesas"][0]["status_pagamento"] = None
    g(db, D1, "excluir")
