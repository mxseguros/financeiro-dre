"""Remessa Santander V11.7 — motor, leiautes e arquivo."""
from datetime import date, datetime
from decimal import Decimal as D

import pytest

from app.cnab import pix
from app.cnab.builders import santander as S
from app.cnab.engine import CampoInvalido, LayoutInvalido, campos, registro, verificar_layout
from app.cnab.layouts import santander_v11_7 as L
from app.cnab.modelo import Empresa, Favorecido, ItemPagamento

EMP = Empresa(cnpj="11222333000181", razao_social="MX Seguros Ltda", agencia="3501", conta="13000123",
              conta_dv="4", convenio="8145822",
              endereco={"logradouro": "Rua Teste", "numero": "100", "cidade": "São Paulo", "cep": "04315999", "uf": "SP"},
              opcoes={"enviar_bloqueado": True})
DIA = date(2026, 12, 1)
BOLETO = "03399.81458 82200.000006 00002.101012 4 71860000010000"


def _qr_dinamico():
    base = ("00020101021226850014br.gov.bcb.pix2563pix.santander.com.br/qr/v2/"
            "e2bcdb46-0f01-47b5-9999-2e7cccd3671b520400005303986540510.005802BR"
            "5917SODRO BENTO FILHO6009SAO PAULO62070503***6304")
    return base + pix.crc16(base)


def _itens():
    forn = Favorecido(nome="Papelaria Boa", cpf_cnpj="11222333000181", banco_codigo="341", agencia="1234",
                      conta="56789", conta_dv="0", tipo_conta="corrente", pix_tipo_chave="email", pix_chave="fin@papelaria.com.br")
    func = Favorecido(nome="Maria Souza", cpf_cnpj="52998224725", pix_tipo_chave="cpf_cnpj", pix_chave="52998224725",
                      funcionario=True)
    stdr = Favorecido(nome="Aluguel Ltda", cpf_cnpj="11222333000181", banco_codigo="033", agencia="3501",
                      conta="9988776", conta_dv="1", tipo_conta="corrente")
    return [
        ItemPagamento("d1", "MX0330000110000011", "pix", D("150.00"), DIA, favorecido=forn),
        ItemPagamento("d2", "MX0330000110000027", "pix", D("2500.00"), DIA, favorecido=func, salario=True),
        ItemPagamento("d3", "MX0330000110000033", "ted", D("300.00"), DIA, favorecido=forn),
        ItemPagamento("d4", "MX0330000110000049", "credito_conta", D("4000.00"), DIA, favorecido=stdr),
        ItemPagamento("d5", "MX0330000110000055", "boleto", D("100.00"), DIA, codigo_barras=S.so_digitos(BOLETO) and
                      "03394718600000100009814582200000000000210101", cedente_doc="11222333000181", cedente_nome="Empresa ABC"),
        ItemPagamento("d6", "MX0330000110000061", "pix_qr", D("10.00"), DIA, pix_copia_cola=_qr_dinamico()),
        ItemPagamento("d7", "MX0330000110000077", "concessionaria", D("123.45"), DIA, descricao="Conta de luz",
                      codigo_barras="83600000001234500001111111111111111111111111"),
        ItemPagamento("d8", "MX0330000110000083", "tributo", D("1050.00"), DIA, vencimento=date(2026, 12, 20),
                      tributo={"tipo": "darf", "codigo_receita": "0561", "periodo_apuracao": "2026-11-30",
                               "valor_multa": "50.00"}),
        ItemPagamento("d9", "MX0330000110000099", "tributo", D("800.00"), DIA,
                      tributo={"tipo": "gps", "codigo_receita": "2100", "competencia": "2026-11"}),
    ]


def test_leiautes_cobrem_240():
    for nome, layout in L.TODOS.items():
        verificar_layout(nome, layout)


def test_leiaute_com_buraco_falha():
    with pytest.raises(LayoutInvalido):
        verificar_layout("x", campos(("a", 1, 10, "alfa"), ("b", 12, 240, "alfa")))


def test_formatacao_e_limites():
    lay = campos(("n", 1, 5, "num"), ("v", 6, 20, "valor"), ("t", 21, 240, "alfa"))
    linha = registro(lay, {"n": 42, "v": D("1234.5"), "t": "Ação & Cia"})
    assert linha[:5] == "00042" and linha[5:20] == "000000000123450" and linha[20:31] == "ACAO & CIA "
    with pytest.raises(CampoInvalido):
        registro(lay, {"n": 123456})


def test_arquivo_completo():
    itens = _itens()
    for it in itens:
        assert S.validar(it) == [], (it.ref, S.validar(it))
    arq = S.gerar(EMP, itens, nsa=11, agora=datetime(2026, 11, 25, 14, 30, 0, tzinfo=S.BRT))
    linhas = arq.texto.split("\r\n")[:-1]
    assert all(len(l) == 240 for l in linhas)
    h = linhas[0]
    assert h[:8] == "03300000" and h[32:52] == "00333501000008145822" and h[157:163] == "000011" and h[163:166] == "060"
    assert h[143:151] == "25112026" and h[151:157] == "143000"
    # lotes ordenados por forma: 01, 03, 11, 16, 17, 31, 45/20, 45/98, 47
    formas = [(l.forma_lancamento, l.tipo_servico) for l in arq.lotes]
    assert formas == [("01", "20"), ("03", "20"), ("11", "22"), ("16", "22"), ("17", "22"),
                      ("30", "20"), ("45", "20"), ("45", "98"), ("47", "20")]
    trailer = linhas[-1]
    assert trailer[17:23] == f"{len(arq.lotes):06d}" and trailer[23:29] == f"{len(linhas):06d}"
    assert arq.valor_total == sum(i.valor for i in itens)
    # cada trailer de lote soma os valores e conta header + detalhes + trailer
    for l in linhas:
        if l[7] == "5":
            lote = int(l[3:7])
            do_lote = [x for x in linhas if x[3:7] == f"{lote:04d}"]
            assert int(l[17:23]) == len(do_lote)
            assert int(l[23:41]) == int(next(x for x in arq.lotes if x.numero == lote).valor_total * 100)


def _linha(arq, ref, deslocamento=0):
    lote, seq = arq.posicoes[ref]
    linhas = arq.texto.split("\r\n")
    return next(l for l in linhas if l[3:7] == f"{lote:04d}" and l[7] == "3" and int(l[8:13]) == seq + deslocamento)


def test_segmentos():
    arq = S.gerar(EMP, _itens(), nsa=11)
    a = _linha(arq, "d1")                       # Pix por chave e-mail
    assert a[13] == "A" and a[15:17] == "09" and a[17:20] == "009" and a[73:93].rstrip() == "MX0330000110000011"
    assert a[93:101] == "01122026" and a[101:104] == "BRL" and a[119:134] == "000000000015000"
    b = _linha(arq, "d1", 1)
    assert b[13] == "B" and b[14:16] == "02" and b[17] == "2" and b[18:32] == "11222333000181"
    assert b[127:226].rstrip() == "fin@papelaria.com.br"
    b2 = _linha(arq, "d2", 1)                   # salário: chave CPF, tipo de serviço 98
    assert b2[14:16] == "03" and b2[17] == "1" and b2[127:138] == "52998224725"
    ted = _linha(arq, "d3")
    assert ted[17:20] == "018" and ted[20:23] == "341" and ted[23:28] == "01234" and ted[29:41] == "000000056789"
    assert ted[219:224] == "00005" and ted[224:226] == "CC"
    j = _linha(arq, "d5")                       # boleto + J52 com beneficiário
    assert j[13] == "J" and j[17:61] == "03394718600000100009814582200000000000210101"
    assert j[152:167] == "000000000010000" and j[182:202].rstrip() == "MX0330000110000055"
    j52 = _linha(arq, "d5", 1)
    assert j52[17:19] == "52" and j52[75] == "2" and j52[76:91] == "011222333000181"
    jpix = _linha(arq, "d6", 1)                 # QR dinâmico: só a URL do payload
    assert jpix[131:210].rstrip() == "pix.santander.com.br/qr/v2/e2bcdb46-0f01-47b5-9999-2e7cccd3671b"
    assert jpix[75] == "0"
    o = _linha(arq, "d7")
    assert o[13] == "O" and o[17:61] == "83600000001234500001111111111111111111111111" and o[107:122] == "000000000012345"
    darf = _linha(arq, "d8")
    assert darf[13] == "N" and darf[132:134] == "16" and darf[134:142] == "30112026"
    assert darf[159:174] == "000000000100000" and darf[174:189] == "000000000005000" and darf[204:212] == "20122026"
    gps = _linha(arq, "d9")
    assert gps[132:134] == "17" and gps[134:140] == "112026" and gps[140:155] == "000000000080000"


def test_instrucao_liberada_sem_bloqueio():
    emp = Empresa(**{**EMP.__dict__, "opcoes": {"enviar_bloqueado": False}})
    arq = S.gerar(emp, _itens()[:1], nsa=12)
    assert _linha(arq, "d1")[15:17] == "00"


@pytest.mark.parametrize("ajuste,msg", [
    ({"forma": "credito_conta"}, "Santander"),
    ({"forma": "boleto", "cedente_doc": None, "codigo_barras": "03394718600000100009814582200000000000210101"}, "beneficiário"),
    ({"forma": "tributo", "tributo": {"tipo": "darf", "codigo_receita": "0561"}}, "período"),
    ({"forma": "pix_qr", "pix_copia_cola": "000201xyz"}, "Pix"),
])
def test_validacoes(ajuste, msg):
    base = _itens()[0]
    item = ItemPagamento(**{**base.__dict__, **ajuste})
    assert any(msg.lower() in e.lower() for e in S.validar(item))


def test_chave_cpf_de_outra_pessoa():
    f = Favorecido(nome="X", cpf_cnpj="11222333000181", pix_tipo_chave="cpf_cnpj", pix_chave="52998224725")
    assert S.validar(ItemPagamento("x", "MX1", "pix", D(10), DIA, favorecido=f))
