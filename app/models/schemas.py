"""
MX Seguros — DRE-IA | Schemas Pydantic (request/response).
Valores monetários: sempre Decimal, nunca float.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ── BASE ──────────────────────────────────────────────────────

class RespostaBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# ── DRE ───────────────────────────────────────────────────────

class DRERequest(BaseModel):
    inicio: date
    fim: date

    @field_validator("fim")
    @classmethod
    def fim_apos_inicio(cls, fim: date, info) -> date:
        inicio = info.data.get("inicio")
        if inicio and fim < inicio:
            raise ValueError("'fim' deve ser igual ou posterior a 'inicio'")
        return fim


class LinhasDRE(RespostaBase):
    receita_bruta:             Decimal
    estornos:                  Decimal
    impostos:                  Decimal
    receita_liquida:           Decimal | None = None  # None para perfis sem permissão
    repasses_produtores:       Decimal | None = None
    margem_contribuicao:       Decimal | None = None
    despesas_fixas:            Decimal | None = None  # bloqueado para gestor/comercial
    ebitda:                    Decimal | None = None  # bloqueado para gestor/comercial
    despesas_nao_operacionais: Decimal | None = None
    resultado_liquido:         Decimal | None = None


class DREResponse(RespostaBase):
    periodo: dict[str, date]
    dre:     LinhasDRE
    perfil:  str   # qual perfil gerou (campos podem ser None se sem permissão)


# ── COMISSÕES ─────────────────────────────────────────────────

class ComissaoItem(RespostaBase):
    id:           UUID
    apolice_id:   UUID
    tipo:         str
    valor:        Decimal
    percentual:   Decimal | None
    competencia:  date
    recebida_em:  date | None


class ComissoesResponse(RespostaBase):
    total:      int
    items:      list[ComissaoItem]
    soma_total: Decimal


# ── RECEITA POR RAMO ──────────────────────────────────────────

class ReceitaRamoItem(RespostaBase):
    ramo_codigo:   str
    ramo_nome:     str
    receita_total: Decimal
    num_apolices:  int


class ReceitaRamoResponse(RespostaBase):
    periodo:  dict[str, date]
    items:    list[ReceitaRamoItem]
    total:    Decimal


# ── RECEITA POR TIPO DE LANÇAMENTO ───────────────────────────

class ReceitaTipoItem(RespostaBase):
    tipo_nome:       str
    receita_total:   Decimal
    num_lancamentos: int


class ReceitaTipoResponse(RespostaBase):
    periodo: dict[str, date]
    items:   list[ReceitaTipoItem]
    total:   Decimal


# ── CONFIGURAÇÕES: BANCOS ─────────────────────────────────────

class BancoItem(RespostaBase):
    id:        UUID
    nome:      str
    ativo:     bool


class BancoCreate(RespostaBase):
    nome: str


class BancoUpdate(RespostaBase):
    nome:  str | None = None
    ativo: bool | None = None


# ── CONFIGURAÇÕES: CENTROS DE CUSTO ───────────────────────────

class CentroCustoItem(RespostaBase):
    id:        UUID
    nome:      str
    codigo:    str
    ativo:     bool
    # Hierarquia (0044): grupo tem parent_id None; subgrupo aponta para o grupo.
    parent_id: UUID | None = None
    numero:    str | None = None
    ordem:     int = 0


class CentroCustoCreate(RespostaBase):
    nome:      str
    # Gerado a partir do nome quando não informado (é a chave gravada no lançamento).
    codigo:    str | None = None
    parent_id: UUID | None = None
    numero:    str | None = None
    ordem:     int = 0


class CentroCustoUpdate(RespostaBase):
    nome:      str | None = None
    ativo:     bool | None = None
    numero:    str | None = None
    ordem:     int | None = None
    # Mover para outro grupo; para virar grupo raiz, mande sem_grupo=True.
    parent_id: UUID | None = None
    sem_grupo: bool = False


class CentroCustoMover(RespostaBase):
    direcao: Literal["cima", "baixo"]


# ── CONFIGURAÇÕES: FUNCIONÁRIOS (0048) ────────────────────────

class FuncionarioItem(RespostaBase):
    id:           UUID
    nome:         str
    centro_custo: str | None = None
    ativo:        bool = True


class FuncionarioCreate(RespostaBase):
    nome:         str = Field(min_length=3, max_length=200)
    centro_custo: str | None = None


class FuncionarioUpdate(RespostaBase):
    nome:         str | None = Field(default=None, min_length=3, max_length=200)
    centro_custo: str | None = None
    ativo:        bool | None = None


# ── CONFIGURAÇÕES: CATEGORIAS DE LANÇAMENTO ───────────────────

class CategoriaLancamentoItem(RespostaBase):
    id:       UUID
    nome:     str
    natureza: str   # 'despesa' | 'receita'
    ordem:    int
    ativo:    bool


class CategoriaLancamentoCreate(RespostaBase):
    nome:     str
    natureza: str
    ordem:    int = 0

    @field_validator("natureza")
    @classmethod
    def natureza_valida(cls, v: str) -> str:
        if v not in ("despesa", "receita"):
            raise ValueError("natureza deve ser 'despesa' ou 'receita'.")
        return v


class CategoriaLancamentoUpdate(RespostaBase):
    nome:  str | None = None
    ordem: int | None = None
    ativo: bool | None = None


# ── CONFIGURAÇÕES: CLASSIFICAÇÕES (migration 0039) ────────────

_NATUREZAS_CLASSIF = ("despesa", "receita", "ambas")


class ClassificacaoItem(RespostaBase):
    codigo:   str
    nome:     str
    natureza: str          # 'despesa' | 'receita' | 'ambas'
    ordem:    int = 0
    ativo:    bool = True
    sistema:  bool = False  # uma das 4 originais (informativo; sem trava desde a 0041)
    usada_dre: bool = True  # desmarcada: lançamentos com ela ficam fora da DRE (0041)


class ClassificacaoCreate(RespostaBase):
    nome:     str = Field(min_length=1, max_length=60)
    natureza: str = "ambas"
    ordem:    int = 0
    usada_dre: bool = True

    @field_validator("natureza")
    @classmethod
    def natureza_ok(cls, v: str) -> str:
        if v not in _NATUREZAS_CLASSIF:
            raise ValueError("natureza deve ser despesa, receita ou ambas")
        return v


class ClassificacaoUpdate(RespostaBase):
    nome:     str | None = Field(default=None, max_length=60)
    natureza: str | None = None
    ordem:    int | None = None
    ativo:    bool | None = None
    usada_dre: bool | None = None

    @field_validator("natureza")
    @classmethod
    def natureza_ok(cls, v: str | None) -> str | None:
        if v is not None and v not in _NATUREZAS_CLASSIF:
            raise ValueError("natureza deve ser despesa, receita ou ambas")
        return v


# ── CONFIGURAÇÕES: SUBITENS DE LANÇAMENTO (ex-"Tipos de Lançamento") ──

class TipoLancamentoItem(RespostaBase):
    id:            UUID
    nome:          str
    natureza:      str   # 'despesa' | 'receita'
    categoria:     str | None
    categoria_id:  UUID | None = None
    categoria_nome: str | None = None
    custo_tipo:    str | None
    ativo:         bool
    # Receitas deste subitem constam só na DRE (migration 0037).
    somente_dre:   bool = False
    # Despesas deste subitem: detalhe só para o Admin (0046).
    confidencial:  bool = False


def _validar_categoria_enum(v: str | None) -> str | None:
    """Categoria deve bater com o ENUM despesa_categoria do banco — valor fora
    dele quebraria a criação de despesas que usam o tipo (erro 500)."""
    if v is None:
        return v
    v = v.strip()
    if not v:
        return None
    if v not in CATEGORIAS_DESPESA_VALIDAS:
        raise ValueError(
            f"categoria inválida: '{v}'. Valores aceitos: "
            + ", ".join(sorted(CATEGORIAS_DESPESA_VALIDAS))
        )
    return v


class TipoLancamentoCreate(RespostaBase):
    nome:         str
    natureza:     str
    categoria:    str | None = None
    categoria_id: UUID   # subitens_lancamento.categoria_id é NOT NULL desde a 0026
    custo_tipo:   str | None = None
    somente_dre:  bool = False

    _categoria_ok = field_validator("categoria")(_validar_categoria_enum)


class TipoLancamentoUpdate(RespostaBase):
    nome:         str | None = None
    categoria:    str | None = None
    categoria_id: UUID | None = None
    custo_tipo:   str | None = None
    ativo:        bool | None = None
    somente_dre:  bool | None = None
    confidencial: bool | None = None   # só o Admin altera

    _categoria_ok = field_validator("categoria")(_validar_categoria_enum)


# ── CONFIGURAÇÕES: USUÁRIOS ───────────────────────────────────

class UsuarioItem(RespostaBase):
    id:          UUID
    nome:        str
    email:       str
    role:        str
    equipe_id:   UUID | None
    produtor_id: UUID | None
    ativo:       bool
    criado_em:   Any | None = None
    permissions: Any | None = None


class UsuarioCreate(RespostaBase):
    nome:        str
    email:       str
    senha:       str
    role:        str = "comercial"
    equipe_id:   UUID | None = None
    produtor_id: UUID | None = None
    permissions: Any | None = None

    @field_validator("role")
    @classmethod
    def role_valido(cls, v: str) -> str:
        validos = {"admin", "gestor", "comercial", "contador", "colaborador"}
        if v not in validos:
            raise ValueError(f"role deve ser um de: {validos}")
        return v


class UsuarioUpdate(RespostaBase):
    nome:        str | None = None
    role:        str | None = None
    equipe_id:   UUID | None = None
    produtor_id: UUID | None = None
    ativo:       bool | None = None
    permissions: Any | None = None

    @field_validator("role")
    @classmethod
    def role_valido(cls, v: str | None) -> str | None:
        if v is not None:
            validos = {"admin", "gestor", "comercial", "contador", "colaborador"}
            if v not in validos:
                raise ValueError(f"role deve ser um de: {validos}")
        return v


# ── LANÇAMENTOS: DESPESAS ─────────────────────────────────────

# Valores do ENUM despesa_categoria no banco (migrations/0001_init.sql)
CATEGORIAS_DESPESA_VALIDAS = {
    "pessoal", "comercial", "administrativa_operacional", "veiculos",
    "terceiros", "financeira", "nao_operacional", "investimento_imobilizado",
}


class EspelhoEmprestimo(RespostaBase):
    """Lado espelho de um Empréstimo (28/11/2026): a despesa cria a receita
    vinculada, ou o contrário. Banco e centro vazios = os do lançamento."""
    tipo_lancamento_id: UUID | None = None
    banco_id:           UUID | None = None
    centro_custo:       str | None = None


def _espelho_so_em_lancamento_unico(espelho, num_parcelas, repetir_ate) -> None:
    if espelho and ((num_parcelas or 0) > 1 or repetir_ate):
        raise ValueError("O espelho de empréstimo vale só para lançamento único (sem parcelas ou recorrência).")


class DespesaCreate(RespostaBase):
    tipo_lancamento_id: UUID | None = None
    banco_id:           UUID | None = None
    # Classificação do lançamento (migration 0040). Sem ela, o banco aplica a
    # do subitem como padrão (gatilho lancamento_classificacao_padrao).
    custo_tipo:         str | None = None
    categoria:          str | None = None   # ENUM legado — obrigatório se tipo_lancamento_id for None
    subcategoria:       str = Field(min_length=1, max_length=100)
    descricao:          str = Field(min_length=3, max_length=500)
    valor:              Decimal = Field(ge=0, le=99_999_999.99)
    competencia:        date
    data_vencimento:    date
    paga_em:            date | None = None
    centro_custo:       str = "matriz"
    recorrente:         bool = False
    parcela_atual:      int | None = Field(default=None, ge=1)
    parcela_total:      int | None = Field(default=None, ge=1)
    # Parcelamento atômico: quando > 1, o backend cria as N parcelas
    # (uma por mês a partir de `competencia`) em um único INSERT.
    # `valor` é o valor MENSAL de cada parcela.
    num_parcelas:       int | None = Field(default=None, ge=2, le=999)
    # Recorrência atômica (espelha ReceitaOutraCreate.repetir_ate): quando
    # informado (>= competencia), o backend cria um registro por mês até
    # este mês em um único INSERT. Mutuamente exclusivo com num_parcelas.
    repetir_ate:        date | None = None
    # Empréstimo: cria também a receita vinculada (migration 0053).
    espelho:            EspelhoEmprestimo | None = None

    @model_validator(mode="after")
    def parcelamento_e_recorrencia_sao_exclusivos(self) -> "DespesaCreate":
        if self.repetir_ate and self.num_parcelas and self.num_parcelas > 1:
            raise ValueError(
                "Informe apenas 'repetir_ate' (recorrência) ou 'num_parcelas' "
                "(parcelamento), não os dois."
            )
        _espelho_so_em_lancamento_unico(self.espelho, self.num_parcelas, self.repetir_ate)
        return self

    @field_validator("categoria")
    @classmethod
    def categoria_valida(cls, v: str | None) -> str | None:
        # Valor fora do ENUM causaria erro 500 do Postgres; rejeita com 422 claro.
        if v is not None and v not in CATEGORIAS_DESPESA_VALIDAS:
            raise ValueError(
                f"categoria inválida: '{v}'. Valores aceitos: "
                + ", ".join(sorted(CATEGORIAS_DESPESA_VALIDAS))
            )
        return v

    @field_validator("competencia")
    @classmethod
    def competencia_nao_futuro_distante(cls, v: date) -> date:
        from datetime import date as d
        hoje = d.today()
        limite = d(hoje.year + (1 if hoje.month > 10 else 0), (hoje.month + 2 - 1) % 12 + 1, 1)
        if v > limite:
            raise ValueError("Competência não pode ser mais de 2 meses no futuro.")
        return v

    # centro_custo deixa de ser validado contra lista fixa: os centros são
    # cadastrados dinamicamente em /configuracoes/centros-custo (o CHECK fixo
    # no banco já havia sido removido na migration 0005 pelo mesmo motivo).
    @field_validator("centro_custo")
    @classmethod
    def centro_custo_valido(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("centro_custo é obrigatório.")
        return v


class DespesaItem(RespostaBase):
    id:                 UUID
    tipo_lancamento_id: UUID | None
    tipo_nome:          str | None          # nome do tipo (join)
    custo_tipo:         str | None = None   # classificação do lançamento (migration 0040)
    banco_id:           UUID | None
    banco_nome:         str | None          # nome do banco (join)
    categoria:          str | None
    subcategoria:       str
    descricao:          str
    valor:              Decimal
    competencia:        date
    data_vencimento:    date | None = None
    paga_em:            date | None
    centro_custo:       str
    recorrente:         bool
    parcela_atual:      int | None
    parcela_total:      int | None
    criado_em:          Any | None = None
    # Ultima movimentacao (criacao OU edicao) — mantida por trigger na migration
    # 0034. E o campo pelo qual Lancamentos e Aprovacoes ordenam por padrao.
    atualizado_em:      Any | None = None
    # Campos do fluxo de aprovação
    status:             str = "aprovada"    # 'pendente' | 'aprovada' | 'rejeitada'
    criado_por:         UUID | None = None
    aprovado_por:       UUID | None = None
    aprovado_em:        Any | None = None
    rejeitado_motivo:   str | None = None
    # Linha "Total Salários Funcionários" (0046): soma de despesas confidenciais
    # para quem não é Admin. Não existe no banco — sem editar, excluir ou aprovar.
    agregado:           bool = False
    quantidade:         int | None = None


class DespesasResponse(RespostaBase):
    total:              int
    items:              list[DespesaItem]
    soma_total:         Decimal
    total_pendentes:    int = 0
    # Resumo da aba Despesas (redesenho UX, 26/11/2026), sobre o período inteiro
    # e não só a página: paga = com Data de Pagamento; vencida = sem pagamento e
    # vencimento antes de hoje; a pagar = o resto. Somam soma_total.
    soma_paga:          Decimal = Decimal(0)
    soma_a_pagar:       Decimal = Decimal(0)
    soma_vencida:       Decimal = Decimal(0)
    qtd_paga:           int = 0
    qtd_a_pagar:        int = 0
    qtd_vencida:        int = 0
    # Chips de Situação (28/11/2026): quantidade por situação sobre os filtros
    # da tela SEM a situação escolhida (services/situacao_filtro.py).
    contagem_situacao:  dict[str, int] = {}


class DespesaUpdate(RespostaBase):
    tipo_lancamento_id: UUID | None = None
    banco_id:           UUID | None = None
    custo_tipo:         str | None = None   # classificação (migration 0040); null limpa
    descricao:          str | None = Field(default=None, min_length=3, max_length=500)
    subcategoria:       str | None = Field(default=None, min_length=1, max_length=100)
    valor:              Decimal | None = Field(default=None, ge=0, le=99_999_999.99)
    competencia:        date | None = None
    data_vencimento:    date | None = None
    paga_em:            date | None = None
    centro_custo:       str | None = None
    # Reparcelamento. Quando informado e diferente do parcela_total atual, o
    # backend reconstrói o grupo com N parcelas mensais, preservando o valor
    # total. `1` desfaz o parcelamento e devolve um lançamento avulso.
    # Existe para o caso de uma despesa importada do extrato que, na verdade,
    # era a primeira cobrança de um financiamento.
    num_parcelas:       int | None = Field(default=None, ge=1, le=999)
    # Recorrência na edição (24/11/2026): liga/estende/encurta/desliga a série
    # a partir deste lançamento. Só vale quando `recorrente` vem no payload.
    recorrente:         bool | None = None
    repetir_ate:        date | None = None

    @model_validator(mode="after")
    def recorrencia_e_parcelas_sao_exclusivas(self) -> "DespesaUpdate":
        if self.recorrente and self.num_parcelas and self.num_parcelas > 1:
            raise ValueError("Despesa parcelada não pode ser recorrente.")
        return self

    @field_validator("centro_custo")
    @classmethod
    def centro_custo_valido(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("centro_custo não pode ser vazio.")
        return v


class DespesaAprovacaoRejeicao(RespostaBase):
    motivo: str | None = None   # obrigatório para rejeição


# ── ORDENS DE COMPRA ──────────────────────────────────────────

def _data_prevista_ok(v: date | None) -> date | None:
    """Mesma trava da competência de despesa: até 2 meses à frente — a ordem
    aprovada vira despesa no mês da data prevista."""
    if v is None:
        return v
    from datetime import date as d
    hoje = d.today()
    limite = d(hoje.year + (1 if hoje.month > 10 else 0), (hoje.month + 2 - 1) % 12 + 1, 1)
    if d(v.year, v.month, 1) > limite:
        raise ValueError("A data prevista pode ser no máximo 2 meses à frente.")
    return v


class OrdemCompraCreate(RespostaBase):
    # Colaborador (0047): o solicitante é sempre o próprio usuário — o servidor
    # preenche; para os demais perfis, vazio também vira o nome de quem lança.
    solicitante: str | None = Field(default=None, max_length=200)
    assunto:     str = Field(min_length=1, max_length=200)
    descricao:   str = Field(min_length=3, max_length=2000)
    # Obrigatório desde a 0047: ordem aprovada vira despesa com este valor.
    valor:       Decimal = Field(gt=0, le=99_999_999.99)
    # Quando a despesa acontece (pode ser futura: "viajo amanhã"). Vazio = hoje.
    data_prevista:      date | None = None
    centro_custo:       str | None = Field(default=None, max_length=100)
    tipo_lancamento_id: UUID | None = None
    # 0048: funcionário da ordem (lista de Configurações → Funcionários). Com
    # ele, o solicitante é o nome do funcionário e o centro vem do cadastro.
    funcionario_id:     UUID | None = None
    # data_solicitacao NÃO entra aqui — o servidor grava date.today().
    # status NÃO entra — toda ordem nasce 'pendente'.

    _data_ok = field_validator("data_prevista")(_data_prevista_ok)


class OrdemCompraItem(RespostaBase):
    id:               UUID
    solicitante:      str
    assunto:          str
    descricao:        str
    valor:            Decimal | None = None
    data_solicitacao: date
    status:           str = "pendente"
    criado_por:       UUID | None = None
    aprovado_por:     UUID | None = None
    aprovado_em:      Any | None = None
    rejeitado_motivo: str | None = None
    criado_em:        Any | None = None
    # 0047
    data_prevista:      date | None = None
    centro_custo:       str | None = None
    tipo_lancamento_id: UUID | None = None
    despesa_id:         UUID | None = None   # despesa gerada na aprovação
    # 0048: funcionário e recibo depois da aprovação
    funcionario_id:      UUID | None = None
    recibo_status:       str | None = None   # aguardando | enviado | aprovado | devolvido
    recibo_motivo:       str | None = None
    recibo_enviado_em:   Any | None = None
    recibo_conferido_em: Any | None = None


class OrdensCompraResponse(RespostaBase):
    total:           int
    items:           list[OrdemCompraItem]
    soma_total:      Decimal
    total_pendentes: int = 0


class OrdemCompraUpdate(RespostaBase):
    solicitante: str | None = Field(default=None, min_length=1, max_length=200)
    assunto:     str | None = Field(default=None, min_length=1, max_length=200)
    descricao:   str | None = Field(default=None, min_length=3, max_length=2000)
    valor:       Decimal | None = Field(default=None, gt=0, le=99_999_999.99)
    data_prevista:      date | None = None
    centro_custo:       str | None = Field(default=None, max_length=100)
    tipo_lancamento_id: UUID | None = None
    funcionario_id:     UUID | None = None

    _data_ok = field_validator("data_prevista")(_data_prevista_ok)


class OrdemCompraRecibo(RespostaBase):
    """O funcionário enviou a foto do recibo (anexo 'comprovante' da ordem)."""
    anexo_id: UUID


class OrdemCompraReciboConferencia(RespostaBase):
    """O financeiro confere o recibo: OK conclui; devolver pede outro."""
    ok:     bool
    motivo: str | None = Field(default=None, max_length=500)


class OrdemCompraAprovacao(RespostaBase):
    """Ao aprovar, quem aprova confirma como a despesa entra na DRE."""
    tipo_lancamento_id: UUID
    centro_custo:       str = Field(min_length=1, max_length=100)
    custo_tipo:         str | None = None   # classificação; vazio = padrão do subitem
    banco_id:           UUID | None = None


# ── LANÇAMENTOS: RECEITAS ─────────────────────────────────────

# Forma de recebimento (0054) — espelha o CHECK da migration.
FormaRecebimento = Literal["pix", "ted", "boleto", "deposito", "cartao", "dinheiro", "outro"]

class ReceitaOutraUpdate(RespostaBase):
    tipo_lancamento_id: UUID | None = None
    banco_id:           UUID | None = None
    custo_tipo:         str | None = None   # classificação (migration 0040); null limpa
    centro_custo:       str | None = None
    descricao:          str | None = Field(default=None, min_length=3, max_length=500)
    valor:              Decimal | None = Field(default=None, ge=0, le=99_999_999.99)
    competencia:        date | None = None
    data_vencimento:    date | None = None
    recebido_em:        date | None = None
    observacao:         str | None = Field(default=None, max_length=1000)
    # Bloco Recebimento do novo modal (0054): null limpa.
    recebido_de:        str | None = Field(default=None, max_length=200)
    forma_recebimento:  FormaRecebimento | None = None
    # Recorrência na edição (24/11/2026) — ver DespesaUpdate.
    recorrente:         bool | None = None
    repetir_ate:        date | None = None

    @field_validator("centro_custo")
    @classmethod
    def centro_custo_valido(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("centro_custo não pode ser vazio.")
        return v


class ReceitaOutraCreate(RespostaBase):
    tipo_lancamento_id: UUID | None = None
    banco_id:           UUID | None = None
    # Classificação do lançamento (migration 0040). Sem ela, o banco aplica a
    # do subitem como padrão (gatilho lancamento_classificacao_padrao).
    custo_tipo:         str | None = None
    centro_custo:       str = "matriz"
    descricao:          str = Field(min_length=3, max_length=500)
    valor:              Decimal = Field(ge=0, le=99_999_999.99)
    competencia:        date
    data_vencimento:    date | None = None
    recebido_em:        date | None = None
    observacao:         str | None = Field(default=None, max_length=1000)
    recebido_de:        str | None = Field(default=None, max_length=200)
    forma_recebimento:  FormaRecebimento | None = None
    # Recorrência atômica: quando informado (>= competencia), o backend cria
    # um registro por mês até este mês em um único INSERT.
    repetir_ate:        date | None = None
    # Empréstimo: cria também a despesa vinculada (migration 0053).
    espelho:            EspelhoEmprestimo | None = None

    @field_validator("centro_custo")
    @classmethod
    def centro_custo_valido(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("centro_custo é obrigatório.")
        return v

    @model_validator(mode="after")
    def espelho_unico(self) -> "ReceitaOutraCreate":
        _espelho_so_em_lancamento_unico(self.espelho, None, self.repetir_ate)
        return self


class ReceitaItem(RespostaBase):
    """Representa tanto comissão (origem=comissao) quanto receita manual (origem=manual)."""
    id:                 UUID
    origem:             str             # 'comissao' | 'manual'
    tipo_lancamento_id: UUID | None = None
    tipo_nome:          str | None = None
    custo_tipo:         str | None = None   # classificação do lançamento (migration 0040)
    banco_id:           UUID | None = None
    banco_nome:         str | None = None
    descricao:          str
    valor:              Decimal
    competencia:        date
    data_vencimento:    date | None = None
    recebido_em:        date | None = None
    centro_custo:       str | None = None
    observacao:         str | None = None
    recebido_de:        str | None = None
    forma_recebimento:  str | None = None
    criado_em:          Any | None = None
    atualizado_em:      Any | None = None
    # Só receita manual tem status (migration 0032). Comissão vem de apólice e
    # não passa por aprovação — por isso o default None em vez de "pendente".
    status:             str | None = None
    # Subitem marcado "Constar apenas na DRE": listada, mas fora dos totais.
    somente_dre:        bool = False


class ReceitasResponse(RespostaBase):
    total:               int
    items:               list[ReceitaItem]
    soma_comissoes:      Decimal
    soma_manuais:        Decimal
    soma_total:          Decimal
    contagem_situacao:   dict[str, int] = {}


# ── FECHAMENTOS MENSAIS ───────────────────────────────────────

class FechamentoCreate(RespostaBase):
    competencia: date

    @field_validator("competencia")
    @classmethod
    def normalizar_para_primeiro_dia(cls, v: date) -> date:
        return date(v.year, v.month, 1)


class ReabrirFechamento(RespostaBase):
    motivo: str


class FechamentoItem(RespostaBase):
    id:              UUID
    competencia:     date
    fechado_por:     UUID | None
    fechado_em:      datetime
    snapshot_dre:    dict[str, Any]
    reaberto_por:    UUID | None = None
    reaberto_em:     datetime | None = None
    reaberto_motivo: str | None = None


class FechamentosResponse(RespostaBase):
    total: int
    items: list[FechamentoItem]


# ── METAS ─────────────────────────────────────────────────────

class MetaCreate(RespostaBase):
    escopo:     str
    competencia: date
    valor_alvo: Decimal
    metrica:    str

    @field_validator("escopo")
    @classmethod
    def escopo_valido(cls, v: str) -> str:
        validos = {"global", "produtor", "equipe", "ramo"}
        if v not in validos:
            raise ValueError(f"escopo deve ser um de: {validos}")
        return v

    @field_validator("valor_alvo")
    @classmethod
    def valor_positivo(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("valor_alvo deve ser um valor positivo")
        return v


class MetaItem(RespostaBase):
    model_config = ConfigDict(populate_by_name=True, extra="allow")
    id: Any = None
    escopo: str | None = None
    metrica: str | None = None
    valor_alvo: Decimal | None = None
    valor_realizado: Decimal | None = None
    percentual_atingido: float | None = None


class MetasResponse(RespostaBase):
    competencia: date
    items:       list[MetaItem]


# ── ESTORNOS ──────────────────────────────────────────────────

class EstornoItem(RespostaBase):
    id:         Any
    apolice_id: Any = None
    valor:      Decimal
    competencia: date
    motivo:     str | None = None


class EstornosResponse(RespostaBase):
    items:        list[EstornoItem]
    total:        Decimal
    taxa_estorno: float
    alerta_5pct:  bool


# ── REPASSES ──────────────────────────────────────────────────

class RepasseItem(RespostaBase):
    id:          Any = None
    comissao_id: Any = None
    produtor_id: Any = None
    valor:       Decimal
    percentual:  Decimal | None = None
    competencia: date
    pago_em:     date | None = None
    status:      str = "previsto"


class RepassesResponse(RespostaBase):
    items:         list[RepasseItem]
    soma_previsto: Decimal
    soma_pago:     Decimal


# ── DASHBOARD AGREGADO ────────────────────────────────────────

class AlertaDashboard(RespostaBase):
    tipo:      str
    mensagem:  str
    severidade: str  # 'info' | 'aviso' | 'critico'


class ReceitaDespesaSaldo(RespostaBase):
    receitas: Decimal = Decimal(0)
    despesas: Decimal = Decimal(0)
    saldo:    Decimal = Decimal(0)


class TotalGeral(ReceitaDespesaSaldo):
    ate: date   # último dia considerado (12 meses à frente do mês atual)


class ResumoVisaoGeral(RespostaBase):
    """Boxes da Visão Geral (escopo de 19/10/2026). Ver dashboard_service.resumo_visao_geral."""
    previsto:       ReceitaDespesaSaldo          # competência no período, pago ou não
    despesas_pagas: Decimal = Decimal(0)         # competência no período e com Data de Pagamento
    total_geral:    TotalGeral                   # todos os meses até 12 à frente; não segue o período


class DashboardResponse(RespostaBase):
    periodo:     dict[str, date]
    dre:         LinhasDRE
    perfil:      str
    resumo:      ResumoVisaoGeral | None = None
    metas:       Any = None
    alertas:     list[AlertaDashboard]
    latencia_ms: int


# ── DASHBOARD: RECEITA/DESPESA POR BANCO ──────────────────────

class BancoResumoItem(RespostaBase):
    banco_id:   UUID
    banco_nome: str
    receitas:   Decimal
    despesas:   Decimal
    saldo:      Decimal
    # Lançamento único do subitem "Saldo Inicial" do banco, sem filtro de
    # período (box "Saldo do período Itaú", 23/10/2026). Não entra no saldo.
    saldo_inicial: Decimal = Decimal(0)
    # Saldo com os critérios do card, de out/2026 até a véspera do período. Somado
    # ao saldo_inicial na linha "Saldo inicial" do box (05/11/2026).
    saldo_anterior: Decimal = Decimal(0)


class DashboardPorBancoResponse(RespostaBase):
    periodo: dict[str, date]
    bancos:  list[BancoResumoItem]


# ── DASHBOARD: EMPRÉSTIMOS (23/10/2026) ───────────────────────

class EmprestimoSubitem(RespostaBase):
    subitem: str
    qtd:     int
    valor:   Decimal


class EmprestimoLado(RespostaBase):
    itens: list[EmprestimoSubitem]
    total: Decimal


class EmprestimoBanco(RespostaBase):
    banco:    str              # nome do banco, ou "Sem banco"
    receitas: EmprestimoLado
    despesas: EmprestimoLado
    saldo:    Decimal          # receitas − despesas
    # Receitas − despesas de out/2026 até o fim do período: linha do box "Saldo do período".
    saldo_acumulado: Decimal = Decimal(0)


class DashboardEmprestimosResponse(RespostaBase):
    periodo:  dict[str, date]
    # Um card por banco (pedido de 23/10/2026); os totais abaixo somam todos.
    bancos:   list[EmprestimoBanco] = []
    receitas: EmprestimoLado
    despesas: EmprestimoLado
    saldo:    Decimal          # receitas − despesas


class DashboardAplicacoesResponse(DashboardEmprestimosResponse):
    """Quadro Aplicações: mesmo formato de Empréstimos (um card por banco,
    receitas e despesas por subitem da categoria Aplicações)."""


# ── DASHBOARD: DESPESAS POR CLASSIFICAÇÃO (FIXA/VARIÁVEL) ─────

class ClassificacaoValor(RespostaBase):
    codigo: str
    nome:   str
    valor:  Decimal


class DespesasPorClassificacaoResponse(RespostaBase):
    periodo:            dict[str, date]
    fixas:              Decimal
    variaveis:          Decimal
    nao_operacionais:   Decimal
    impostos:           Decimal = Decimal(0)
    nao_classificadas:  Decimal
    # Classificações cadastradas além das 4 do sistema (ex.: Aplicações,
    # Empréstimos) — um card cada na Visão Geral (22/10/2026).
    outras:             list[ClassificacaoValor] = []
    total:              Decimal


# ── DASHBOARD: LISTAS DIÁRIA/MENSAL DE DESPESAS E RECEITAS ────

class LancamentoResumoItem(RespostaBase):
    id:        UUID
    descricao: str
    tipo_nome: str | None = None
    valor:     Decimal
    data:      date | None = None
    status:    str | None = None   # usado por Ordens de Compra (badge)
    # "Total Salários Funcionários" (0046): soma, não um lançamento — sem detalhe.
    agregado:  bool = False


class LancamentosDiaMesResponse(RespostaBase):
    dia: list[LancamentoResumoItem]
    mes: list[LancamentoResumoItem]


# ── ERROS ─────────────────────────────────────────────────────

class ErroResponse(RespostaBase):
    erro:    str
    detalhe: str | None = None
