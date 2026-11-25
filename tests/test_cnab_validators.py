"""CNAB — validadores, código de barras, Pix e dias úteis."""
from datetime import date
from decimal import Decimal

import pytest

from app.cnab import barcode, dias_uteis, pix
from app.cnab.normalize import texto_cnab
from app.cnab.validators import (
    chave_pix_valida, cnpj_alfanumerico, cnpj_valido, cpf_valido, normalizar_chave_pix, tipo_documento,
)


# ── Documentos ────────────────────────────────────────────────
def test_cpf():
    assert cpf_valido("529.982.247-25")
    assert not cpf_valido("529.982.247-24")
    assert not cpf_valido("111.111.111-11")


def test_cnpj_numerico():
    assert cnpj_valido("11.222.333/0001-81")
    assert not cnpj_valido("11.222.333/0001-80")


def test_cnpj_alfanumerico_exemplo_receita():
    # Exemplo oficial da Receita Federal para o CNPJ alfanumérico.
    assert cnpj_valido("12.ABC.345/01DE-35")
    assert cnpj_alfanumerico("12ABC34501DE35")
    assert not cnpj_valido("12.ABC.345/01DE-36")
    assert tipo_documento("12ABC34501DE35") == "cnpj"
    assert tipo_documento("52998224725") == "cpf"


# ── Pix ───────────────────────────────────────────────────────
@pytest.mark.parametrize("tipo,chave,ok", [
    ("cpf_cnpj", "529.982.247-25", True),
    ("cpf_cnpj", "11222333000181", True),
    ("email", "Financeiro@MX.com.br", True),
    ("email", "sem-arroba.com", False),
    ("telefone", "(11) 99999-8888", True),
    ("telefone", "1234", False),
    ("aleatoria", "123e4567-e89b-12d3-a456-426614174000", True),
    ("aleatoria", "123e4567", False),
])
def test_chave_pix(tipo, chave, ok):
    assert chave_pix_valida(tipo, chave) is ok


def test_normaliza_telefone():
    assert normalizar_chave_pix("telefone", "(11) 99999-8888") == "+5511999998888"


def _brcode(sem_crc: str) -> str:
    return sem_crc + pix.crc16(sem_crc)


def test_pix_copia_cola_dinamico_extrai_url():
    # Exemplo do manual Santander V11.7 (nota G041), com CRC recalculado.
    base = ("00020101021226850014br.gov.bcb.pix2563pix.santander.com.br/qr/v2/"
            "e2bcdb46-0f01-47b5-9999-2e7cccd3671b520400005303986540510.005802BR"
            "5917SODRO BENTO FILHO6009SAO PAULO62070503***6304")
    codigo = pix.ler(_brcode(base))
    assert codigo.dinamico
    assert codigo.url == "pix.santander.com.br/qr/v2/e2bcdb46-0f01-47b5-9999-2e7cccd3671b"
    assert codigo.valor == Decimal("10.00")
    assert codigo.txid is None


def test_pix_crc_errado():
    base = "00020126330014br.gov.bcb.pix0111529982247255204000053039865802BR5903MX 6009SAO PAULO6304"
    with pytest.raises(pix.PixInvalido):
        pix.ler(base + "0000")
    ok = pix.ler(_brcode(base))
    assert ok.chave == "52998224725" and not ok.dinamico


# ── Boleto ────────────────────────────────────────────────────
def test_boleto_exemplo_manual_santander():
    # Nota G008 do manual Santander V11.7.
    linha = "03399.81458 82200.000006 00002.101012 4 71860000010000"
    cb = barcode.ler(linha, referencia=date(2017, 6, 1))
    assert cb.codigo == "03394718600000100009814582200000000000210101"
    assert cb.valor == Decimal("100.00")
    assert cb.vencimento == date(2017, 6, 10)
    assert barcode.boleto_codigo_para_linha(cb.codigo) == "".join(c for c in linha if c.isdigit())


def test_boleto_digito_errado():
    with pytest.raises(barcode.CodigoInvalido):
        barcode.ler("03399.81458 82200.000006 00002.101012 5 71860000010000")


def test_fator_vencimento_depois_de_2025():
    # Fator 1000 recomeçou em 22/02/2025.
    assert barcode.data_do_fator(1000, date(2025, 3, 1)) == date(2025, 2, 22)
    assert barcode.data_do_fator(9999, date(2025, 2, 1)) == date(2025, 2, 21)
    assert barcode.data_do_fator(1500, date(2026, 7, 1)) == date(2026, 7, 7)


def _arrecadacao(corpo43: str) -> str:
    """Monta um código de arrecadação válido (DV na posição 4)."""
    calc = barcode.mod10 if corpo43[2] in "67" else barcode.mod11_arrecadacao
    return corpo43[:3] + str(calc(corpo43)) + corpo43[3:]


@pytest.mark.parametrize("ident", ["6", "8"])
def test_arrecadacao_48_para_44(ident):
    codigo = _arrecadacao("8" + "3" + ident + "00000012345" + "0" * 4 + "1" * 25)
    calc = barcode.mod10 if ident == "6" else barcode.mod11_arrecadacao
    linha = "".join(codigo[i:i + 11] + str(calc(codigo[i:i + 11])) for i in range(0, 44, 11))
    cb = barcode.ler(linha)
    assert cb.tipo == "arrecadacao" and cb.codigo == codigo
    assert cb.valor == Decimal("123.45")
    assert cb.segmento == "3"


# ── Texto e dias úteis ────────────────────────────────────────
def test_texto_cnab():
    assert texto_cnab("Açaí & Cia — Ltda.") == "ACAI & CIA - LTDA."
    assert texto_cnab("João  Ção\n#1") == "JOAO CAO 1"


def test_feriados_moveis_2026():
    f = dias_uteis.feriados_nacionais(2026)
    assert dias_uteis.pascoa(2026) == date(2026, 4, 5)
    assert date(2026, 2, 16) in f and date(2026, 2, 17) in f   # Carnaval
    assert date(2026, 4, 3) in f                                # Sexta-feira Santa
    assert date(2026, 6, 4) in f                                # Corpus Christi
    assert date(2026, 11, 20) in f


def test_proximo_dia_util():
    assert dias_uteis.proximo_dia_util(date(2026, 11, 20)) == date(2026, 11, 23)  # sexta feriado → segunda
    assert dias_uteis.proximo_dia_util(date(2026, 11, 24)) == date(2026, 11, 24)
    assert dias_uteis.proximo_dia_util(date(2026, 11, 24), {date(2026, 11, 24)}) == date(2026, 11, 25)
