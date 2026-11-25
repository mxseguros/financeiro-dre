"""Boleto (linha digitável de 47) e arrecadação/tributos (linha de 48) ↔
código de barras de 44 posições, com DV, valor e vencimento."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from app.cnab.normalize import so_digitos

_BASE_FATOR = date(1997, 10, 7)        # fator 1000 = 03/07/2000; 9999 = 21/02/2025
_BASE_FATOR_2025 = date(2025, 2, 22)   # a partir daqui o fator recomeça em 1000


class CodigoInvalido(ValueError):
    pass


def mod10(numero: str) -> int:
    soma, peso = 0, 2
    for ch in reversed(numero):
        p = int(ch) * peso
        soma += p // 10 + p % 10
        peso = 1 if peso == 2 else 2
    return (10 - soma % 10) % 10


def _soma_mod11(numero: str) -> int:
    soma, peso = 0, 2
    for ch in reversed(numero):
        soma += int(ch) * peso
        peso = 2 if peso == 9 else peso + 1
    return soma % 11


def mod11_boleto(numero: str) -> int:
    dv = 11 - _soma_mod11(numero)
    return 1 if dv in (0, 10, 11) else dv


def mod11_arrecadacao(numero: str) -> int:
    resto = _soma_mod11(numero)
    if resto in (0, 1):
        return 0
    if resto == 10:
        return 1
    return 11 - resto


def data_do_fator(fator: int, referencia: date | None = None) -> date | None:
    """O fator de vencimento voltou a 1000 em 22/02/2025. Entre as duas
    leituras possíveis, vale a mais próxima da data de referência."""
    if not fator:
        return None
    ref = referencia or date.today()
    candidatos = [_BASE_FATOR + timedelta(days=fator)]
    if fator >= 1000:
        candidatos.append(_BASE_FATOR_2025 + timedelta(days=fator - 1000))
    return min(candidatos, key=lambda d: abs((d - ref).days))


@dataclass
class CodigoBarras:
    tipo: str               # 'boleto' | 'arrecadacao'
    codigo: str             # 44 dígitos
    valor: Decimal | None
    vencimento: date | None
    banco: str | None = None          # boleto
    segmento: str | None = None       # arrecadação: 1 prefeitura, 2 saneamento, 3 energia/gás, 4 telecom, 5 órgãos gov., 6 outros, 9 uso exclusivo do banco


# ── Boleto ────────────────────────────────────────────────────
def _boleto_dv_ok(codigo: str) -> bool:
    return mod11_boleto(codigo[:4] + codigo[5:]) == int(codigo[4])


def boleto_linha_para_codigo(linha: str) -> str:
    d = so_digitos(linha)
    if len(d) != 47:
        raise CodigoInvalido("A linha digitável do boleto tem 47 números.")
    c1, c2, c3 = d[0:10], d[10:21], d[21:32]
    for campo in (c1, c2, c3):
        if mod10(campo[:-1]) != int(campo[-1]):
            raise CodigoInvalido("Linha digitável com dígito verificador errado. Confira a digitação.")
    codigo = d[0:4] + d[32] + d[33:47] + c1[4:9] + c2[0:10] + c3[0:10]
    if not _boleto_dv_ok(codigo):
        raise CodigoInvalido("Linha digitável com dígito verificador geral errado.")
    return codigo


def boleto_codigo_para_linha(codigo: str) -> str:
    c = so_digitos(codigo)
    livre = c[19:44]
    p1 = c[0:4] + livre[0:5]
    p2 = livre[5:15]
    p3 = livre[15:25]
    return (p1 + str(mod10(p1)) + p2 + str(mod10(p2)) + p3 + str(mod10(p3))
            + c[4] + c[5:19])


# ── Arrecadação (concessionárias e tributos) ──────────────────
def _arrec_mod(codigo: str):
    if codigo[2] in "67":
        return mod10
    if codigo[2] in "89":
        return mod11_arrecadacao
    raise CodigoInvalido("Código de arrecadação com identificador de valor inválido.")


def arrecadacao_linha_para_codigo(linha: str) -> str:
    d = so_digitos(linha)
    if len(d) != 48 or d[0] != "8":
        raise CodigoInvalido("A linha de contas e tributos tem 48 números e começa com 8.")
    blocos = [d[i:i + 12] for i in range(0, 48, 12)]
    calc = _arrec_mod(blocos[0])
    for b in blocos:
        if calc(b[:11]) != int(b[11]):
            raise CodigoInvalido("Linha de contas/tributos com dígito verificador errado. Confira a digitação.")
    codigo = "".join(b[:11] for b in blocos)
    if calc(codigo[:3] + codigo[4:]) != int(codigo[3]):
        raise CodigoInvalido("Código de contas/tributos com dígito verificador geral errado.")
    return codigo


def ler(texto: str, referencia: date | None = None) -> CodigoBarras:
    """Aceita linha digitável (47/48) ou código de barras (44) e devolve o
    código de 44 com valor e vencimento (quando o código traz)."""
    d = so_digitos(texto)
    if len(d) == 47:
        d = boleto_linha_para_codigo(d)
    elif len(d) == 48:
        d = arrecadacao_linha_para_codigo(d)
    elif len(d) != 44:
        raise CodigoInvalido("Informe a linha digitável (47 ou 48 números) ou o código de barras (44).")

    if d[0] == "8":
        calc = _arrec_mod(d)
        if calc(d[:3] + d[4:]) != int(d[3]):
            raise CodigoInvalido("Código de barras com dígito verificador geral errado.")
        valor = (Decimal(int(d[4:15])) / 100).quantize(Decimal("0.01")) if d[2] in "68" else None
        return CodigoBarras("arrecadacao", d, valor or None, None, segmento=d[1])

    if not _boleto_dv_ok(d):
        raise CodigoInvalido("Código de barras com dígito verificador geral errado.")
    fator = int(d[5:9])
    valor = (Decimal(int(d[9:19])) / 100).quantize(Decimal("0.01"))
    return CodigoBarras("boleto", d, valor or None, data_do_fator(fator, referencia), banco=d[0:3])
