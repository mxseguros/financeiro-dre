"""Pix copia-e-cola (BR Code / EMV): leitura, CRC16 e a URL do payload que o
CNAB pede no J52-Pix (QR dinâmico, FGTS Digital)."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation


class PixInvalido(ValueError):
    pass


def crc16(dados: str) -> str:
    """CRC16-CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em hexa maiúsculo."""
    crc = 0xFFFF
    for b in dados.encode("utf-8"):
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def _tlv(texto: str) -> dict[str, str]:
    campos, i = {}, 0
    while i < len(texto):
        if i + 4 > len(texto):
            raise PixInvalido("Código Pix incompleto.")
        tag, tam = texto[i:i + 2], texto[i + 2:i + 4]
        if not tam.isdigit():
            raise PixInvalido("Código Pix com formato inválido.")
        n = int(tam)
        valor = texto[i + 4:i + 4 + n]
        if len(valor) != n:
            raise PixInvalido("Código Pix incompleto.")
        campos[tag] = valor
        i += 4 + n
    return campos


@dataclass
class BrCode:
    chave: str | None
    url: str | None             # QR dinâmico: endereço do payload (sem https://)
    valor: Decimal | None
    nome_recebedor: str | None
    cidade: str | None
    txid: str | None
    crc_ok: bool
    campos: dict = field(default_factory=dict, repr=False)

    @property
    def dinamico(self) -> bool:
        return bool(self.url)


def ler(copia_cola: str, exigir_crc: bool = True) -> BrCode:
    texto = (copia_cola or "").strip()
    if not texto.startswith("000201"):
        raise PixInvalido("Isto não parece um Pix copia-e-cola (deve começar com 000201).")
    campos = _tlv(texto)
    crc_ok = "63" in campos and texto.endswith(campos["63"]) and crc16(texto[:-4]) == campos["63"].upper()
    if exigir_crc and not crc_ok:
        raise PixInvalido("Código Pix com dígito de conferência (CRC) errado. Copie de novo.")
    conta = _tlv(campos.get("26", ""))
    if conta.get("00", "").lower() != "br.gov.bcb.pix":
        raise PixInvalido("Código Pix sem a identificação br.gov.bcb.pix.")
    adicionais = _tlv(campos.get("62", "")) if campos.get("62") else {}
    valor = None
    if campos.get("54"):
        try:
            valor = Decimal(campos["54"])
        except InvalidOperation as exc:
            raise PixInvalido("Valor do Pix inválido.") from exc
    url = conta.get("25")
    if url:
        url = url.removeprefix("https://").removeprefix("http://")
    txid = adicionais.get("05")
    return BrCode(
        chave=conta.get("01"), url=url, valor=valor,
        nome_recebedor=campos.get("59"), cidade=campos.get("60"),
        txid=None if txid in (None, "***") else txid, crc_ok=crc_ok, campos=campos,
    )
