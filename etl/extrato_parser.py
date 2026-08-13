"""
MX Seguros — DRE-IA | Parser de extratos bancários (Itaú / Santander).

Detecta automaticamente o BANCO e o FORMATO e devolve transações normalizadas.
Formatos suportados:
  • OFX  (Santander e, em geral, qualquer banco que exporte OFX) — o mais rico:
         traz o banco (<ORG>/<BANKID>), tipo, data, valor e um ID único (FITID)
         ideal para deduplicação.
  • CSV Santander  (cabeçalho "Data;Histórico;Documento;Valor (R$);Saldo (R$)")
  • TXT Itaú       ("DD/MM/AAAA;descrição;valor;" — sem cabeçalho, com linhas de
                    SALDO que NÃO são transações)

Identificação do banco:
  - OFX .......... explícito no arquivo (<ORG> / <BANKID>: 033=Santander, 341=Itaú…)
  - CSV Santander  explícito (agência + assinatura do cabeçalho)
  - TXT Itaú ..... NÃO há marca do banco no conteúdo — identificado só pela
                   estrutura (linhas "data;desc;valor;" + linhas SALDO). Por isso o
                   banco vem como "sugerido" e deve ser confirmável na tela.

Saída: dataclass ExtratoParse com metadados + lista de TransacaoExtrato.
Nada aqui grava no banco nem classifica — só normaliza.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Código de compensação (BANKID no OFX) → nome do banco
_BANCOS_POR_CODIGO = {
    "033": "Santander",
    "341": "Itaú",
    "237": "Bradesco",
    "001": "Banco do Brasil",
    "104": "Caixa",
    "260": "Nubank",
    "748": "Sicredi",
    "756": "Sicoob",
}


@dataclass
class TransacaoExtrato:
    data: str            # ISO YYYY-MM-DD
    descricao: str
    valor: float         # sinalizado: negativo = débito
    tipo: str            # "credito" | "debito"
    documento: str = ""  # FITID/nº doc — usado para deduplicação
    ignorar: bool = False
    motivo_ignorar: str = ""


@dataclass
class ExtratoParse:
    banco: str
    banco_confirmado: bool          # True se o arquivo identifica o banco explicitamente
    formato: str                    # "ofx" | "csv_santander" | "txt_itau"
    conta: str
    transacoes: list[TransacaoExtrato] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)


# ── utilitários ────────────────────────────────────────────────

def _decode(conteudo: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return conteudo.decode(enc)
        except UnicodeDecodeError:
            continue
    return conteudo.decode("latin-1", errors="replace")


def _num_br(txt: str) -> float:
    """Converte '2.891,08' / '-4580,67' / '28338,76' → float."""
    s = (txt or "").strip().replace(" ", "")
    if not s:
        return 0.0
    if "," in s:                      # vírgula decimal → ponto é milhar
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _data_br(txt: str) -> str:
    """'08/07/2026' → '2026-07-08'."""
    m = re.match(r"\s*(\d{2})/(\d{2})/(\d{4})", txt or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def _limpar(desc: str) -> str:
    return re.sub(r"\s+", " ", (desc or "").strip())


# ── detecção ───────────────────────────────────────────────────

def detectar(conteudo: bytes, filename: str = "") -> str:
    texto = _decode(conteudo)
    cabeca = texto[:400].upper()
    if "OFXHEADER" in cabeca or "<OFX>" in cabeca:
        return "ofx"
    # CSV Santander: cabeçalho com Data / Histórico / Valor separados por ;
    if re.search(r"data\s*;\s*hist", texto[:600], re.IGNORECASE) or texto[:200].upper().startswith("AGENCIA;"):
        return "csv_santander"
    # TXT Itaú: linhas "DD/MM/AAAA;...;valor;"
    if re.search(r"^\d{2}/\d{2}/\d{4};", texto, re.MULTILINE):
        return "txt_itau"
    raise ValueError("Formato de extrato não reconhecido (esperado OFX, CSV Santander ou TXT Itaú).")


# ── parsers por formato ────────────────────────────────────────

def _ofx_field(bloco: str, tag: str) -> str:
    m = re.search(rf"<{tag}>([^\r\n<]*)", bloco, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _parse_ofx(texto: str) -> ExtratoParse:
    org = _ofx_field(texto, "ORG")
    bankid = _ofx_field(texto, "BANKID")
    conta = _ofx_field(texto, "ACCTID")
    banco = _BANCOS_POR_CODIGO.get(bankid) or (org.title() if org else "Desconhecido")
    res = ExtratoParse(banco=banco, banco_confirmado=bool(org or bankid), formato="ofx", conta=conta)

    for bloco in re.findall(r"<STMTTRN>(.*?)</STMTTRN>", texto, re.IGNORECASE | re.DOTALL):
        dt = _ofx_field(bloco, "DTPOSTED")[:8]
        data = f"{dt[:4]}-{dt[4:6]}-{dt[6:8]}" if len(dt) == 8 else ""
        valor = _num_br(_ofx_field(bloco, "TRNAMT"))
        res.transacoes.append(TransacaoExtrato(
            data=data,
            descricao=_limpar(_ofx_field(bloco, "MEMO")),
            valor=valor,
            tipo="credito" if valor >= 0 else "debito",
            documento=_ofx_field(bloco, "FITID"),
        ))
    return res


def _parse_csv_santander(texto: str) -> ExtratoParse:
    linhas = texto.splitlines()
    conta = ""
    m = re.search(r"CONTA;\"?([\d]+)", texto)
    if m:
        conta = m.group(1)
    res = ExtratoParse(banco="Santander", banco_confirmado=True, formato="csv_santander", conta=conta)

    cabecalho_visto = False
    for ln in linhas:
        if not cabecalho_visto:
            if re.match(r"\s*\"?data\"?\s*;", ln, re.IGNORECASE):
                cabecalho_visto = True
            continue
        campos = [c.strip().strip('"') for c in ln.split(";")]
        if len(campos) < 4 or not re.match(r"\d{2}/\d{2}/\d{4}", campos[0]):
            continue
        data, hist, doc, valor = campos[0], campos[1], campos[2], campos[3]
        v = _num_br(valor)
        res.transacoes.append(TransacaoExtrato(
            data=_data_br(data),
            descricao=_limpar(hist),
            valor=v,
            tipo="credito" if v >= 0 else "debito",
            documento=doc,
        ))
    return res


def _parse_txt_itau(texto: str) -> ExtratoParse:
    res = ExtratoParse(banco="Itaú", banco_confirmado=False, formato="txt_itau", conta="")
    res.avisos.append("Banco identificado pela estrutura do arquivo (TXT do Itaú não traz o nome do banco) — confirme na tela.")
    for ln in texto.splitlines():
        campos = ln.split(";")
        if len(campos) < 3 or not re.match(r"\d{2}/\d{2}/\d{4}", campos[0]):
            continue
        data, desc, valor = campos[0], campos[1], campos[2]
        v = _num_br(valor)
        desc_limpa = _limpar(desc)
        # Linhas de saldo NÃO são transações
        eh_saldo = desc_limpa.upper().startswith("SALDO")
        res.transacoes.append(TransacaoExtrato(
            data=_data_br(data),
            descricao=desc_limpa,
            valor=v,
            tipo="credito" if v >= 0 else "debito",
            ignorar=eh_saldo,
            motivo_ignorar="Linha de saldo (não é lançamento)" if eh_saldo else "",
        ))
    return res


def parsear(conteudo: bytes, filename: str = "") -> ExtratoParse:
    formato = detectar(conteudo, filename)
    texto = _decode(conteudo)
    if formato == "ofx":
        return _parse_ofx(texto)
    if formato == "csv_santander":
        return _parse_csv_santander(texto)
    return _parse_txt_itau(texto)
