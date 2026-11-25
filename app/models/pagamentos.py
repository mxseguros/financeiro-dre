"""Schemas de Pagamentos (CNAB 240, migration 0050)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

FormaPagamento = Literal["pix", "pix_qr", "ted", "credito_conta", "boleto", "concessionaria", "tributo"]
TipoChave = Literal["telefone", "email", "cpf_cnpj", "aleatoria"]
TipoConta = Literal["corrente", "poupanca", "pagamento"]


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class FornecedorPayload(_Base):
    nome:                   str = Field(min_length=2, max_length=200)
    tipo_pessoa:            Literal["F", "J"] = "J"
    cpf_cnpj:               str | None = None
    banco_codigo:           str | None = None
    ispb:                   str | None = None
    agencia:                str | None = None
    agencia_dv:             str | None = None
    conta:                  str | None = None
    conta_dv:               str | None = None
    tipo_conta:             TipoConta | None = None
    pix_tipo_chave:         TipoChave | None = None
    pix_chave:              str | None = None
    forma_pagamento_padrao: FormaPagamento | None = None
    ativo:                  bool = True


class FavorecidoFuncionarioPayload(_Base):
    """Dados bancários do funcionário (vira um fornecedor com funcionario_id)."""
    cpf:                    str | None = None
    banco_codigo:           str | None = None
    ispb:                   str | None = None
    agencia:                str | None = None
    agencia_dv:             str | None = None
    conta:                  str | None = None
    conta_dv:               str | None = None
    tipo_conta:             TipoConta | None = None
    pix_tipo_chave:         TipoChave | None = None
    pix_chave:              str | None = None
    forma_pagamento_padrao: FormaPagamento | None = "pix"


class OpcoesConvenio(_Base):
    sequencial_teste:       bool = False
    seu_numero_obrigatorio: bool = False
    sequencia:              Literal["nenhuma", "restrita", "diferente"] = "nenhuma"
    enviar_bloqueado:       bool = True


class ContaPagadoraPayload(_Base):
    codigo_banco:    Literal["033", "341"]
    apelido:         str | None = Field(default=None, max_length=60)
    agencia:         str
    agencia_dv:      str | None = None
    conta:           str
    conta_dv:        str | None = None
    cnpj_empresa:    str
    razao_social:    str = Field(min_length=2, max_length=200)
    codigo_convenio: str | None = None
    endereco:        dict = Field(default_factory=dict)
    proximo_nsa:     int = Field(default=1, ge=1, le=999999)
    ambiente:        Literal["homologacao", "producao"] = "homologacao"
    opcoes:          OpcoesConvenio = Field(default_factory=OpcoesConvenio)
    ativa:           bool = True


class TributoPayload(_Base):
    """Tributo sem código de barras (segmento N)."""
    tipo:               Literal["darf", "gps"]
    codigo_receita:     str
    periodo_apuracao:   str | None = None    # DARF: AAAA-MM-DD
    competencia:        str | None = None    # GPS: AAAA-MM
    numero_referencia:  str | None = None
    valor_principal:    str | None = None
    valor_multa:        str | None = None
    valor_juros:        str | None = None
    valor_outras:       str | None = None    # GPS: outras entidades
    contribuinte_doc:   str | None = None    # CNPJ/CPF/NIT; vazio = CNPJ da empresa


class PagamentoDespesaPayload(_Base):
    fornecedor_id:     str | None = None
    forma_pagamento:   FormaPagamento | None = None
    valor_pagamento:   str | None = None
    linha_digitavel:   str | None = None     # boleto / concessionária (47, 48 ou 44)
    cedente_cpf_cnpj:  str | None = None
    cedente_nome:      str | None = None
    pix_copia_cola:    str | None = None
    tributo:           TributoPayload | None = None
