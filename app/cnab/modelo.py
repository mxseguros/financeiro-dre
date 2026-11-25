"""Modelo neutro (sem banco de dados) do que vai na remessa."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass
class Empresa:
    cnpj: str
    razao_social: str
    agencia: str
    conta: str
    agencia_dv: str | None = None
    conta_dv: str | None = None
    convenio: str | None = None
    endereco: dict = field(default_factory=dict)
    opcoes: dict = field(default_factory=dict)


@dataclass
class Favorecido:
    nome: str
    cpf_cnpj: str | None = None
    banco_codigo: str | None = None
    ispb: str | None = None
    agencia: str | None = None
    agencia_dv: str | None = None
    conta: str | None = None
    conta_dv: str | None = None
    tipo_conta: str | None = None
    pix_tipo_chave: str | None = None
    pix_chave: str | None = None
    funcionario: bool = False


@dataclass
class ItemPagamento:
    ref: str                       # id da despesa
    seu_numero: str
    forma: str                     # pix | pix_qr | ted | credito_conta | boleto | concessionaria | tributo
    valor: Decimal
    data_pagamento: date
    descricao: str = ""
    favorecido: Favorecido | None = None
    codigo_barras: str | None = None
    vencimento: date | None = None          # do documento (boleto) ou da despesa
    cedente_doc: str | None = None
    cedente_nome: str | None = None
    pix_copia_cola: str | None = None
    tributo: dict | None = None
    salario: bool = False


@dataclass
class LoteGerado:
    numero: int
    forma_lancamento: str
    tipo_servico: str
    qtd_itens: int
    valor_total: Decimal


@dataclass
class ArquivoGerado:
    texto: str
    lotes: list[LoteGerado]
    posicoes: dict[str, tuple[int, int]]     # ref → (lote, sequencial do 1º segmento)
    valor_total: Decimal
    qtd_registros: int
