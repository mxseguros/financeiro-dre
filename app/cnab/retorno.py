"""Leitura do arquivo de retorno CNAB 240 (Santander V11.7 e Itaú SISPAG v086).

Cada registro de pagamento (A, J, O, N) traz o "seu número" que a remessa
gravou e até 5 ocorrências (231–240). O segmento Z (autenticação) complementa
o registro anterior. Header e trailer de lote/arquivo podem trazer ocorrências
que valem para o lote inteiro (ex.: HA lote não aceito, TA totais com diferença).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.cnab.ocorrencias import separar


class RetornoInvalido(ValueError):
    pass


@dataclass
class Registro:
    segmento: str
    lote: int
    sequencial: int
    seu_numero: str
    nosso_numero: str
    ocorrencias: list[str]
    data_real: date | None = None
    valor_real: Decimal | None = None
    estorno: bool = False
    autenticacao: str | None = None


@dataclass
class Retorno:
    codigo_banco: str
    nsa: int | None
    data_geracao: date | None
    registros: list[Registro] = field(default_factory=list)
    ocorrencias_lote: dict[int, list[str]] = field(default_factory=dict)
    ocorrencias_arquivo: list[str] = field(default_factory=list)


# Posições (1-based, inclusivas) por banco e segmento:
# seu número, nosso número, data real, valor real.
_POS = {
    "033": {"A": ((74, 93), (135, 154), (155, 162), (163, 177)),
            "J": ((183, 202), (203, 222), (145, 152), (153, 167)),
            "O": ((123, 142), (143, 162), (100, 107), (108, 122)),
            "N": ((18, 37), (38, 57), (88, 95), (96, 110))},
    "341": {"A": ((74, 93), (135, 149), (155, 162), (163, 177)),
            "J": ((183, 202), (216, 230), (145, 152), (153, 167)),
            "O": ((175, 194), (216, 230), (137, 144), (145, 159)),
            "N": ((196, 215), (216, 230), None, None)},
}


def _f(linha: str, pos: tuple[int, int] | None) -> str:
    return linha[pos[0] - 1:pos[1]] if pos else ""


def _data(s: str) -> date | None:
    s = s.strip()
    if len(s) != 8 or not s.isdigit() or s == "00000000":
        return None
    try:
        return date(int(s[4:]), int(s[2:4]), int(s[:2]))
    except ValueError:
        return None


def _valor(s: str) -> Decimal | None:
    s = s.strip()
    return (Decimal(int(s)) / 100).quantize(Decimal("0.01")) if s.isdigit() and int(s) else None


def ler(texto: str) -> Retorno:
    linhas = [ln.rstrip("\r\n") for ln in texto.splitlines() if ln.strip()]
    if not linhas:
        raise RetornoInvalido("Arquivo vazio.")
    ruins = [i + 1 for i, ln in enumerate(linhas) if len(ln) != 240]
    if ruins:
        raise RetornoInvalido(f"Não é um arquivo CNAB 240: linha(s) {', '.join(map(str, ruins[:5]))} sem 240 posições.")
    header = linhas[0]
    banco = header[:3]
    if banco not in _POS:
        raise RetornoInvalido(f"Banco {banco} não suportado (só Santander 033 e Itaú 341).")
    if header[7] != "0":
        raise RetornoInvalido("A primeira linha não é um header de arquivo.")
    if header[142] == "1":
        raise RetornoInvalido("Este é um arquivo de REMESSA (código 1), não de retorno.")
    nsa = int(header[157:163]) if banco == "033" and header[157:163].isdigit() else None
    ret = Retorno(codigo_banco=banco, nsa=nsa or None, data_geracao=_data(header[143:151]))
    if banco == "033":
        ret.ocorrencias_arquivo = separar(header[230:240])

    for ln in linhas[1:]:
        tipo, lote = ln[7], int(ln[3:7]) if ln[3:7].isdigit() else 0
        if tipo in ("1", "5"):
            codigos = separar(ln[230:240])
            if codigos:
                ret.ocorrencias_lote.setdefault(lote, [])
                ret.ocorrencias_lote[lote] += [c for c in codigos if c not in ret.ocorrencias_lote[lote]]
            continue
        if tipo != "3":
            continue
        seg = ln[13]
        if seg == "Z":
            if ret.registros:
                ret.registros[-1].autenticacao = ln[14:78].strip() or None
            continue
        if seg == "J" and ln[17:19] == "52":
            continue                                    # J-52: complemento, sem ocorrência própria
        pos = _POS[banco].get(seg)
        if not pos:
            continue                                    # B, C, W…: complementos
        estorno = (ln[14] == "3") if banco == "033" and seg == "A" else False
        ret.registros.append(Registro(
            segmento=seg, lote=lote, sequencial=int(ln[8:13]) if ln[8:13].isdigit() else 0,
            seu_numero=_f(ln, pos[0]).strip(), nosso_numero=_f(ln, pos[1]).strip(), ocorrencias=separar(ln[230:240]),
            data_real=_data(_f(ln, pos[2])), valor_real=_valor(_f(ln, pos[3])), estorno=estorno,
        ))
    return ret
