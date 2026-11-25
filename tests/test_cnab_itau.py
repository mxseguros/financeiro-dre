"""Remessa Itaú SISPAG v085 — leiautes, posições e regras próprias."""
from datetime import date, datetime
from decimal import Decimal as D

import pytest

from app.cnab import pix
from app.cnab.builders import itau as I
from app.cnab.builders.santander import BRT
from app.cnab.engine import verificar_layout
from app.cnab.layouts import itau_sispag_v085 as L
from app.cnab.modelo import Empresa, Favorecido, ItemPagamento

EMP = Empresa(cnpj="11222333000181", razao_social="MX Seguros Ltda", agencia="0350", conta="12345", conta_dv="6",
              endereco={"logradouro": "Rua Teste", "numero": "100", "cidade": "Sao Paulo", "cep": "04315999", "uf": "SP"})
DIA = date(2026, 12, 1)
FORN = Favorecido(nome="Papelaria Boa", cpf_cnpj="11222333000181", banco_codigo="237", agencia="1234",
                  conta="56789", conta_dv="0", tipo_conta="corrente", pix_tipo_chave="email", pix_chave="fin@papelaria.com.br")
ITAU_F = Favorecido(nome="Maria Souza", cpf_cnpj="52998224725", banco_codigo="341", agencia="0350",
                    conta="98765", conta_dv="4", tipo_conta="corrente", funcionario=True)


def _linhas(arq):
    return arq.texto.split("\r\n")[:-1]


def _det(arq, ref, seg="A"):
    lote, seq = arq.posicoes[ref]
    return next(l for l in _linhas(arq) if l[3:7] == f"{lote:04d}" and l[7] == "3" and int(l[8:13]) == seq and l[13] == seg[0]
                and (seg != "J52" or l[17:19] == "52") and (seg != "J" or l[17:19] != "52"))


def test_leiautes_cobrem_240():
    for nome, layout in L.TODOS.items():
        verificar_layout(nome, layout)


def test_arquivo_geral():
    itens = [
        ItemPagamento("t1", "MX3410000020000011", "ted", D("300.00"), DIA, favorecido=FORN),
        ItemPagamento("s1", "MX3410000020000027", "credito_conta", D("2500.00"), DIA, favorecido=ITAU_F, salario=True),
        ItemPagamento("b1", "MX3410000020000033", "boleto", D("100.00"), DIA,
                      codigo_barras="03394718600000100009814582200000000000210101", cedente_doc="11222333000181",
                      cedente_nome="Empresa ABC"),
        ItemPagamento("o1", "MX3410000020000049", "concessionaria", D("123.45"), DIA, descricao="Conta de luz",
                      codigo_barras="83600000001234500001111111111111111111111111"),
        ItemPagamento("d1", "MX3410000020000055", "tributo", D("1050.00"), DIA, vencimento=date(2026, 12, 20),
                      tributo={"tipo": "darf", "codigo_receita": "0561", "periodo_apuracao": "2026-11-30", "valor_multa": "50.00"}),
        ItemPagamento("g1", "MX3410000020000061", "tributo", D("800.00"), DIA,
                      tributo={"tipo": "gps", "codigo_receita": "2100", "competencia": "2026-11", "valor_outras": "100"}),
    ]
    for it in itens:
        assert I.validar(it) == [], (it.ref, I.validar(it))
    arq = I.gerar(EMP, itens, nsa=2, agora=datetime(2026, 11, 25, 9, 0, tzinfo=BRT))
    linhas = _linhas(arq)
    assert all(len(l) == 240 for l in linhas)
    h = linhas[0]
    assert h[:8] == "34100000" and h[14:17] == "080" and h[18:32] == "11222333000181"
    assert h[52:57] == "00350" and h[58:70] == "000000012345" and h[71] == "6" and h[157:166] == "000000000"
    assert [(l.forma_lancamento, l.tipo_servico) for l in arq.lotes] == [
        ("01", "30"), ("13", "20"), ("16", "22"), ("17", "22"), ("31", "20"), ("41", "20")]
    hl = next(l for l in linhas if l[7] == "1" and l[11:13] == "41")
    assert hl[9:11] == "20" and hl[13:16] == "040"
    assert next(l for l in linhas if l[7] == "1" and l[11:13] == "31")[13:16] == "030"
    ted = _det(arq, "t1")
    assert ted[14:17] == "000" and ted[17:20] == "000" and ted[20:23] == "237"
    assert ted[23:43] == "01234 000000056789 0" and ted[101:104] == "REA"
    assert ted[203:217] == "11222333000181" and ted[219:224] == "00005" and ted[119:134] == "000000000030000"
    sal = _det(arq, "s1")
    assert sal[23:43] == "00350 000000098765 4" and sal[203:217] == "00052998224725"
    j = _det(arq, "b1", "J")
    assert j[17:61] == "03394718600000100009814582200000000000210101" and j[182:202].rstrip() == "MX3410000020000033"
    j52 = _det(arq, "b1", "J52")
    assert j52[75] == "2" and j52[76:91] == "011222333000181" and j52[20:35] == "011222333000181"
    o = _det(arq, "o1", "O")
    assert o[17:65] == I.linha_arrecadacao("83600000001234500001111111111111111111111111")
    assert o[121:136] == "000000000012345" and o[174:194].rstrip() == "MX3410000020000049"
    darf = _det(arq, "d1", "N")
    assert darf[17:19] == "02" and darf[19:23] == "0561" and darf[23] == "2" and darf[24:38] == "11222333000181"
    assert darf[63:77] == "00000000100000" and darf[77:91] == "00000000005000" and darf[105:119] == "00000000105000"
    gps = _det(arq, "g1", "N")
    assert gps[17:19] == "01" and gps[19:23] == "2100" and gps[23:29] == "112026"
    assert gps[43:57] == "00000000070000" and gps[57:71] == "00000000010000" and gps[195:215].rstrip() == "MX3410000020000061"
    tn = next(l for l in linhas if l[7] == "5" and l[3:7] == f"{arq.posicoes['g1'][0]:04d}")
    assert tn[23:37] == "00000000070000" and tn[37:51] == "00000000010000" and tn[65:79] == "00000000080000"
    # complementos repetem o número do segmento principal (nota 9)
    lote_j = arq.posicoes["b1"][0]
    assert [l[8:13] for l in linhas if l[3:7] == f"{lote_j:04d}" and l[7] == "3"] == ["00001", "00001"]


def _qr(dinamico=True):
    if dinamico:
        base = ("00020101021226850014br.gov.bcb.pix2563pix.santander.com.br/qr/v2/"
                "e2bcdb46-0f01-47b5-9999-2e7cccd3671b520400005303986540510.005802BR"
                "5917SODRO BENTO FILHO6009SAO PAULO62070503***6304")
    else:
        base = "00020126330014br.gov.bcb.pix0111529982247255204000053039865802BR5902MX6009SAO PAULO62070503ABC6304"
    return base + pix.crc16(base)


def test_arquivo_pix_separado():
    itens = [
        ItemPagamento("p1", "MX3410000030000017", "pix", D("150.00"), DIA, favorecido=FORN),
        ItemPagamento("q1", "MX3410000030000023", "pix_qr", D("10.00"), DIA, pix_copia_cola=_qr()),
        ItemPagamento("q2", "MX3410000030000039", "pix_qr", D("20.00"), DIA, pix_copia_cola=_qr(False)),
    ]
    assert [t for t, _ in I.separar(itens + [ItemPagamento("x", "MX", "ted", D(1), DIA, favorecido=FORN)])] == ["geral", "pix"]
    with pytest.raises(ValueError):
        I.gerar(EMP, itens + [ItemPagamento("x", "MX", "ted", D(1), DIA, favorecido=FORN)], 3)
    arq = I.gerar(EMP, itens, nsa=3)
    a = _det(arq, "p1")
    assert a[17:20] == "009" and a[112:114] == "04" and a[20:23] == "000" and a[23:43] == " " * 20
    b = _det(arq, "p1", "B")
    assert b[14:16] == "02" and b[17] == "2" and b[18:32] == "11222333000181" and b[127:227].rstrip() == "fin@papelaria.com.br"
    jq = _det(arq, "q1", "J52")
    assert jq[131:208].rstrip() == "pix.santander.com.br/qr/v2/e2bcdb46-0f01-47b5-9999-2e7cccd3671b"
    assert _det(arq, "q1", "J")[17:61] == "0" * 44
    je = _det(arq, "q2", "J52")
    assert je[131:208].rstrip() == "52998224725" and je[208:240].rstrip() == "ABC"


@pytest.mark.parametrize("item,msg", [
    (ItemPagamento("x", "MX", "credito_conta", D(10), DIA, favorecido=FORN), "Itaú"),
    (ItemPagamento("x", "MX", "ted", D(10), DIA, favorecido=ITAU_F), "Crédito em conta"),
    (ItemPagamento("x", "MX", "pix", D(10), DIA, favorecido=Favorecido(nome="X", cpf_cnpj="12ABC34501DE35",
                                                                         pix_tipo_chave="email", pix_chave="a@b.com")), "letras"),
    (ItemPagamento("x", "MX", "tributo", D(10), DIA, tributo={"tipo": "darf", "codigo_receita": "123456",
                                                               "periodo_apuracao": "2026-11-30"}), "4 números"),
])
def test_validacoes(item, msg):
    assert any(msg.lower() in e.lower() for e in I.validar(item))


def test_linha_arrecadacao_volta_ao_codigo():
    from app.cnab import barcode
    # Exemplo do anexo B do manual Itaú (pág. 68).
    cod = "84610000000362700060002000102000000457986595"
    assert I.linha_arrecadacao(cod) == "846100000005362700060001200010200000004579865959"
    assert barcode.arrecadacao_linha_para_codigo(I.linha_arrecadacao(cod)) == cod
