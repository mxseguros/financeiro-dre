"""Motor CNAB 240: monta registros de 240 posições a partir de um layout.

Layout = lista de campos `(nome, inicio, fim, tipo, padrao)` com posições do
manual (1-based, inclusivas). Tipos:
- `num`   número, à direita com zeros
- `alfa`  texto CNAB (sem acento, maiúsculo), à esquerda com brancos
- `texto` texto como veio (chave Pix, URL do QR), à esquerda com brancos
- `doc`   CPF/CNPJ (inclui alfanumérico), à direita com zeros
- `data`  date → DDMMAAAA (None → zeros)
- `valor` Decimal com 2 casas, sem vírgula, à direita com zeros
- `fixo`  o próprio `padrao`, que já tem o tamanho do campo
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable

from app.cnab.normalize import so_alfanum, so_digitos, texto_cnab

TAMANHO = 240


class LayoutInvalido(Exception):
    pass


class CampoInvalido(ValueError):
    pass


@dataclass(frozen=True)
class Campo:
    nome: str
    ini: int
    fim: int
    tipo: str = "alfa"
    padrao: Any = None

    @property
    def tamanho(self) -> int:
        return self.fim - self.ini + 1


def campos(*defs: tuple) -> tuple[Campo, ...]:
    return tuple(Campo(*d) for d in defs)


def verificar_layout(nome: str, layout: Iterable[Campo]) -> None:
    """Cada registro cobre 1..240 sem buraco nem sobreposição."""
    pos = 1
    for c in sorted(layout, key=lambda c: c.ini):
        if c.ini != pos:
            raise LayoutInvalido(f"{nome}: campo {c.nome} começa em {c.ini}, esperado {pos}")
        if c.fim < c.ini:
            raise LayoutInvalido(f"{nome}: campo {c.nome} com fim antes do início")
        if c.tipo == "fixo" and len(str(c.padrao)) != c.tamanho:
            raise LayoutInvalido(f"{nome}: fixo {c.nome} com tamanho errado")
        pos = c.fim + 1
    if pos != TAMANHO + 1:
        raise LayoutInvalido(f"{nome}: termina em {pos - 1}, esperado 240")


def _formatar(c: Campo, v: Any) -> str:
    n = c.tamanho
    if c.tipo == "fixo":
        return str(c.padrao)
    if v is None:
        v = c.padrao
    if c.tipo == "alfa":
        s = texto_cnab(v) if v is not None else ""
        return s[:n].ljust(n)
    if c.tipo == "texto":
        s = str(v or "").strip()
        if len(s) > n:
            raise CampoInvalido(f"{c.nome}: texto com {len(s)} caracteres não cabe em {n} posições")
        return s.ljust(n)
    if c.tipo == "num":
        s = so_digitos(v) if v is not None else ""
        if len(s) > n:
            raise CampoInvalido(f"{c.nome}: '{s}' não cabe em {n} posições")
        return s.rjust(n, "0")
    if c.tipo == "doc":
        s = so_alfanum(v) if v is not None else ""
        if len(s) > n:
            raise CampoInvalido(f"{c.nome}: documento não cabe em {n} posições")
        return s.rjust(n, "0")
    if c.tipo == "data":
        if v in (None, "", 0):
            return "0" * n
        if isinstance(v, str):
            v = date.fromisoformat(v[:10])
        if isinstance(v, datetime):
            v = v.date()
        return v.strftime("%d%m%Y")
    if c.tipo == "valor":
        d = Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if d < 0:
            raise CampoInvalido(f"{c.nome}: valor negativo")
        s = str(int(d * 100))
        if len(s) > n:
            raise CampoInvalido(f"{c.nome}: valor não cabe em {n} posições")
        return s.rjust(n, "0")
    raise LayoutInvalido(f"tipo desconhecido: {c.tipo}")


def registro(layout: Iterable[Campo], valores: dict[str, Any]) -> str:
    partes = []
    for c in sorted(layout, key=lambda c: c.ini):
        s = _formatar(c, valores.get(c.nome))
        if len(s) != c.tamanho:
            raise CampoInvalido(f"{c.nome}: gerou {len(s)} posições, esperado {c.tamanho}")
        partes.append(s)
    linha = "".join(partes)
    if len(linha) != TAMANHO:
        raise LayoutInvalido(f"registro com {len(linha)} posições")
    if not linha.isascii():
        raise CampoInvalido("registro com caractere fora do ASCII")
    return linha


def ler(layout: Iterable[Campo], linha: str) -> dict[str, str]:
    """Fatia uma linha de retorno pelos campos do layout (texto cru)."""
    return {c.nome: linha[c.ini - 1:c.fim] for c in layout}
