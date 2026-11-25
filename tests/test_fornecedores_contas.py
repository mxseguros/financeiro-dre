"""Pagamentos (0050) — favorecidos, máscara e contas pagadoras."""
import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.models.pagamentos import ContaPagadoraPayload, FavorecidoFuncionarioPayload, FornecedorPayload
from app.services import contas_pagadoras_service as cps
from app.services import fornecedores_service as fs
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="a", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="g", email="g@x", role="gestor", tenant_id="t1")
COMERCIAL = UsuarioAtual(user_id="c", email="c@x", role="comercial", tenant_id="t1")
F1 = uid(1)


def banco():
    return Db(
        fornecedores=[], despesas=[], contas_pagadoras=[], remessas=[],
        funcionarios=[{"id": F1, "nome": "Maria Souza", "centro_custo": None, "ativo": True, "tenant_id": "t1"}],
        bancos=[{"id": uid(90), "nome": "Itaú"}, {"id": uid(91), "nome": "Santander"}],
    )


def _forn(**kw):
    base = dict(nome="Papelaria Boa Ltda", cpf_cnpj="11.222.333/0001-81", banco_codigo="341",
                agencia="1234", conta="56789", conta_dv="0", tipo_conta="corrente",
                pix_tipo_chave="email", pix_chave="Fin@Papelaria.com.br", forma_pagamento_padrao="pix")
    base.update(kw)
    return FornecedorPayload(**base)


def test_criar_normaliza_e_mascara_para_quem_nao_gera_remessa():
    db = banco()
    item = fs.criar(_forn(), GESTOR, db)
    assert item["tipo_pessoa"] == "J" and item["pix_chave"] == "fin@papelaria.com.br"
    lista = fs.listar(COMERCIAL, db)
    assert lista[0]["conta"] is None and lista[0]["pix_chave"] is None and lista[0]["cpf_cnpj"] is None
    assert lista[0]["conta_mascarada"] == "341 · Ag 1234 · CC ****89-0"
    assert lista[0]["pix_mascarada"] == "fi***@papelaria.com.br"
    assert fs.listar(GESTOR, db)[0]["conta"] == "56789"


def test_comercial_nao_cadastra():
    with pytest.raises(HTTPException) as e:
        fs.criar(_forn(), COMERCIAL, banco())
    assert e.value.status_code == 403


@pytest.mark.parametrize("kw,msg", [
    ({"cpf_cnpj": "11.222.333/0001-80"}, "CPF/CNPJ"),
    ({"pix_chave": "nao-e-email"}, "Chave Pix"),
    ({"forma_pagamento_padrao": "ted", "conta": None}, "conta"),
    ({"forma_pagamento_padrao": "pix", "cpf_cnpj": None}, "CPF/CNPJ"),
])
def test_validacoes(kw, msg):
    with pytest.raises(HTTPException) as e:
        fs.criar(_forn(**kw), ADMIN, banco())
    assert e.value.status_code == 422 and msg in e.value.detail


def test_cnpj_alfanumerico_e_duplicidade():
    db = banco()
    fs.criar(_forn(cpf_cnpj="12.ABC.345/01DE-35"), ADMIN, db)
    assert db.tabelas["fornecedores"][0]["cpf_cnpj"] == "12ABC34501DE35"
    with pytest.raises(HTTPException) as e:
        fs.criar(_forn(nome="Outro", cpf_cnpj="12ABC34501DE35"), ADMIN, db)
    assert e.value.status_code == 409


def test_funcionario_favorecido():
    db = banco()
    item = fs.salvar_do_funcionario(F1, FavorecidoFuncionarioPayload(
        cpf="529.982.247-25", pix_tipo_chave="cpf_cnpj", pix_chave="52998224725"), ADMIN, db)
    assert item["nome"] == "Maria Souza" and item["tipo_pessoa"] == "F" and item["funcionario_id"] == F1
    # não se edita pela tela de fornecedores
    with pytest.raises(HTTPException):
        fs.atualizar(item["id"], _forn(), ADMIN, db)
    # limpar desativa
    assert fs.salvar_do_funcionario(F1, FavorecidoFuncionarioPayload(), ADMIN, db) is None
    assert db.tabelas["fornecedores"][0]["ativo"] is False


def _conta(**kw):
    base = dict(codigo_banco="033", agencia="3501", conta="13000123", conta_dv="4",
                cnpj_empresa="11.222.333/0001-81", razao_social="MX Seguros Ltda",
                codigo_convenio="8145822", ambiente="homologacao")
    base.update(kw)
    return ContaPagadoraPayload(**base)


def test_conta_pagadora_so_admin_e_mascara():
    db = banco()
    with pytest.raises(HTTPException):
        cps.criar(_conta(), GESTOR, db)
    item = cps.criar(_conta(), ADMIN, db)
    assert item["banco_id"] == uid(91) and item["opcoes"]["enviar_bloqueado"] is True
    lista = cps.listar(GESTOR, db)
    assert lista[0]["conta"] is None and lista[0]["codigo_convenio"] is None
    assert "Ag 3501" in lista[0]["descricao"]


def test_santander_exige_convenio_e_nsa_teste():
    with pytest.raises(HTTPException):
        cps.criar(_conta(codigo_convenio=None), ADMIN, banco())
    db = banco()
    item = cps.criar(_conta(ambiente="producao", opcoes={"sequencial_teste": True}), ADMIN, db)
    assert item["proximo_nsa"] == 11
    with pytest.raises(HTTPException):
        cps.atualizar(item["id"], _conta(ambiente="producao", proximo_nsa=5,
                                          opcoes={"sequencial_teste": True}), ADMIN, db)
    _, mud = cps.atualizar(item["id"], _conta(ambiente="producao", proximo_nsa=20,
                                               opcoes={"sequencial_teste": True}), ADMIN, db)
    assert mud["proximo_nsa"] == {"de": 11, "para": 20}
