"""Bloco "Pagamento" da despesa (0050)."""
import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.cnab import pix
from app.models.pagamentos import PagamentoDespesaPayload as P
from app.services import pagamento_despesa_service as svc
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="a", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="g", email="g@x", role="gestor", tenant_id="t1")
D1, D2, FORN, SAL = uid(1), uid(2), uid(10), uid(50)
LINHA = "03399.81458 82200.000006 00002.101012 4 71860000010000"


def banco(**extra):
    base = dict(status_pagamento=None, fornecedor_id=None, forma_pagamento=None, valor_pagamento=None,
                codigo_barras=None, linha_digitavel=None, vencimento_boleto=None, cedente_cpf_cnpj=None,
                cedente_nome=None, pix_copia_cola=None, tributo=None, remessa_item_id=None)
    return Db(
        despesas=[
            {"id": D1, "tenant_id": "t1", "status": "aprovada", "valor": "100.00", "criado_por": "x",
             "data_vencimento": "2017-06-10", "tipo_lancamento_id": None, **base, **extra},
            {"id": D2, "tenant_id": "t1", "status": "aprovada", "valor": "5000.00", "criado_por": "x",
             "data_vencimento": "2026-12-05", "tipo_lancamento_id": SAL, **base},
        ],
        fornecedores=[{"id": FORN, "tenant_id": "t1", "nome": "Papelaria", "cpf_cnpj": "11222333000181",
                       "pix_tipo_chave": "email", "pix_chave": "f@p.com", "conta": None, "ativo": True,
                       "forma_pagamento_padrao": "pix", "funcionario_id": None}],
        subitens_lancamento=[{"id": SAL, "confidencial": True}],
    )


def test_boleto_preenche_codigo_e_exige_beneficiario():
    db = banco()
    with pytest.raises(HTTPException) as e:
        svc.salvar(D1, P(forma_pagamento="boleto", linha_digitavel=LINHA), GESTOR, db)
    assert "beneficiário" in e.value.detail
    out = svc.salvar(D1, P(forma_pagamento="boleto", linha_digitavel=LINHA,
                           cedente_cpf_cnpj="11.222.333/0001-81"), GESTOR, db)
    assert out["codigo_barras"] == "03394718600000100009814582200000000000210101"
    assert out["vencimento_boleto"] == "2017-06-10" and out["avisos"] == []


def test_boleto_valor_divergente_avisa():
    out = svc.salvar(D1, P(forma_pagamento="boleto", linha_digitavel=LINHA, valor_pagamento="90,00",
                           cedente_cpf_cnpj="11222333000181"), ADMIN, banco())
    assert out["valor_pagamento"] == "90.00" and "R$ 100.00" in out["avisos"][0]


def test_pix_herda_do_favorecido():
    out = svc.salvar(D1, P(fornecedor_id=FORN), GESTOR, banco())
    assert out["forma_pagamento"] == "pix" and out["valor_pagamento"] == "100.00"
    assert out["favorecido"]["nome"] == "Papelaria"


def test_pix_qr():
    base = "00020126330014br.gov.bcb.pix0111529982247255204000053039865406100.005802BR5902MX6009SAO PAULO6304"
    out = svc.salvar(D1, P(forma_pagamento="pix_qr", pix_copia_cola=base + pix.crc16(base)), GESTOR, banco())
    assert out["pix_copia_cola"].startswith("000201") and out["avisos"] == []


def test_travado_com_o_banco():
    with pytest.raises(HTTPException) as e:
        svc.salvar(D1, P(fornecedor_id=FORN), ADMIN, banco(status_pagamento="em_remessa"))
    assert e.value.status_code == 409


def test_salario_confidencial_some_para_gestor():
    with pytest.raises(HTTPException) as e:
        svc.obter(D2, GESTOR, banco())
    assert e.value.status_code == 404
    assert svc.obter(D2, ADMIN, banco())["habilitado"] is True


def test_interpretar_documento():
    assert svc.interpretar_documento(LINHA)["valor"] == "100.00"
    with pytest.raises(HTTPException):
        svc.interpretar_documento("123")
