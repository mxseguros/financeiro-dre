"""CPF, CNPJ (numérico e alfanumérico) e chaves Pix."""
from __future__ import annotations

import re

from app.cnab.normalize import so_alfanum, so_digitos

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TELEFONE = re.compile(r"^\+55\d{10,11}$")
_CNPJ_ALFA = re.compile(r"^[0-9A-Z]{12}\d{2}$")


def cpf_valido(valor: str | None) -> bool:
    cpf = so_digitos(valor)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for n in (9, 10):
        soma = sum(int(cpf[i]) * (n + 1 - i) for i in range(n))
        dv = (soma * 10) % 11 % 10
        if dv != int(cpf[n]):
            return False
    return True


def _cnpj_dv(base: str) -> str:
    """DV do CNPJ (também do alfanumérico): cada caractere vale ord(c) − 48,
    pesos 2..9 da direita para a esquerda (regra da Receita, 2026)."""
    for _ in range(2):
        pesos = [(i % 8) + 2 for i in range(len(base))][::-1]
        soma = sum((ord(c) - 48) * p for c, p in zip(base, pesos))
        resto = soma % 11
        base += "0" if resto < 2 else str(11 - resto)
    return base[-2:]


def cnpj_valido(valor: str | None) -> bool:
    cnpj = so_alfanum(valor)
    if not _CNPJ_ALFA.match(cnpj) or cnpj == cnpj[0] * 14:
        return False
    return _cnpj_dv(cnpj[:12]) == cnpj[12:]


def cnpj_alfanumerico(valor: str | None) -> bool:
    return any(c.isalpha() for c in so_alfanum(valor))


def documento_valido(valor: str | None) -> bool:
    doc = so_alfanum(valor)
    return cpf_valido(doc) if len(doc) == 11 and doc.isdigit() else cnpj_valido(doc)


def tipo_documento(valor: str | None) -> str | None:
    """'cpf', 'cnpj' ou None."""
    doc = so_alfanum(valor)
    if len(doc) == 11 and cpf_valido(doc):
        return "cpf"
    if len(doc) == 14 and cnpj_valido(doc):
        return "cnpj"
    return None


def normalizar_chave_pix(tipo: str, chave: str | None) -> str:
    chave = (chave or "").strip()
    if tipo == "cpf_cnpj":
        return so_alfanum(chave)
    if tipo == "telefone":
        dig = so_digitos(chave)
        if not dig.startswith("55") or len(dig) <= 11:
            dig = "55" + dig
        return "+" + dig
    if tipo == "email":
        return chave.lower()
    if tipo == "aleatoria":
        return chave.lower()
    return chave


def chave_pix_valida(tipo: str, chave: str | None) -> bool:
    c = normalizar_chave_pix(tipo, chave)
    if tipo == "cpf_cnpj":
        return documento_valido(c)
    if tipo == "telefone":
        return bool(_TELEFONE.match(c))
    if tipo == "email":
        return bool(_EMAIL.match(c)) and len(c) <= 77
    if tipo == "aleatoria":
        return bool(_UUID.match(c))
    return False
