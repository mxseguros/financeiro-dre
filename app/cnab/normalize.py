"""Texto no padrão CNAB: sem acentos, maiúsculas, só caracteres aceitos."""
from __future__ import annotations

import re
import unicodedata

# Conjunto aceito pelos bancos nos campos alfanuméricos.
_PERMITIDO = re.compile(r"[^A-Z0-9 .,/\-&()@:_+]")


def sem_acentos(texto: str) -> str:
    nfkd = unicodedata.normalize("NFKD", texto or "")
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def texto_cnab(texto: str | None) -> str:
    """'Açaí & Cia — Ltda.' → 'ACAI & CIA - LTDA.'"""
    t = sem_acentos(str(texto or "")).upper()
    t = t.replace("—", "-").replace("–", "-").replace("º", "O").replace("ª", "A")
    t = _PERMITIDO.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def so_digitos(texto: str | None) -> str:
    return re.sub(r"\D", "", str(texto or ""))


def so_alfanum(texto: str | None) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", str(texto or "")).upper()
