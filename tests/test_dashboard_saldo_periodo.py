"""Box "Saldo do período" e quadros Empréstimos/Aplicações (regra de 05/11/2026).

Sem banco real: um fake em memória responde à cadeia de consulta do supabase-py.
"""
import asyncio
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from app.services.dashboard_service import buscar_aplicacoes, buscar_emprestimos, buscar_por_banco

ITAU, SANTANDER = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"
OUT = (date(2026, 10, 1), date(2026, 10, 31))
NOV = (date(2026, 11, 1), date(2026, 11, 30))

CATEGORIAS = [
    {"id": "c-emp-r", "nome": "Empréstimo ", "natureza": "receita", "codigo": None},
    {"id": "c-emp-d", "nome": "Empréstimos", "natureza": "despesa", "codigo": None},
    {"id": "c-apl-r", "nome": "Aplicações", "natureza": "receita", "codigo": None},
    {"id": "c-apl-d", "nome": "Aplicações", "natureza": "despesa", "codigo": None},
    {"id": "c-vendas", "nome": "Receitas de vendas", "natureza": "receita", "codigo": "receita_vendas"},
]


def _sub(id_, nome, natureza, categoria):
    return {"id": id_, "nome": nome, "natureza": natureza, "ativo": True, "categoria_id": categoria, "somente_dre": False}


SUBITENS = [
    _sub("s-emp-r", "Familiar", "receita", "c-emp-r"),
    _sub("s-emp-d", "Familiar", "despesa", "c-emp-d"),
    _sub("s-apl-r", "Aplicação", "receita", "c-apl-r"),
    _sub("s-apl-d", "Reserva", "despesa", "c-apl-d"),
    _sub("s-vendas", "Recebimentos", "receita", "c-vendas"),
    _sub("s-inicial", "Saldo Inicial", "receita", "c-vendas"),
]


class Consulta:
    """Só o que o serviço usa da cadeia do PostgREST."""

    def __init__(self, linhas):
        self.linhas, self.filtros, self.negar, self.faixa = linhas, [], False, None

    def _filtro(self, teste):
        negar, self.negar = self.negar, False
        self.filtros.append((lambda r: not teste(r)) if negar else teste)
        return self

    @property
    def not_(self):
        self.negar = True
        return self

    def select(self, _colunas):
        return self

    def order(self, _coluna):
        return self

    def eq(self, col, valor):
        return self._filtro(lambda r: r.get(col) == valor)

    def in_(self, col, valores):
        return self._filtro(lambda r: r.get(col) in valores)

    def is_(self, col, _null):
        return self._filtro(lambda r: r.get(col) is None)

    def gte(self, col, valor):
        return self._filtro(lambda r: r.get(col) is not None and r[col][:10] >= valor)

    def lte(self, col, valor):
        return self._filtro(lambda r: r.get(col) is not None and r[col][:10] <= valor)

    def range(self, inicio, fim):
        self.faixa = (inicio, fim + 1)
        return self

    def execute(self):
        linhas = [r for r in self.linhas if all(f(r) for f in self.filtros)]
        if self.faixa:
            linhas = linhas[self.faixa[0]:self.faixa[1]]
        return SimpleNamespace(data=linhas)


class Banco:
    def __init__(self, despesas=(), receitas=()):
        self.tabelas = {
            "bancos": [{"id": ITAU, "nome": "Itaú", "ativo": True}, {"id": SANTANDER, "nome": "Santander", "ativo": True}],
            "categorias_lancamento": CATEGORIAS,
            "subitens_lancamento": SUBITENS,
            "despesas": list(despesas),
            "receitas_outras": list(receitas),
        }

    def table(self, nome):
        return Consulta(self.tabelas[nome])


_ids = iter(range(1, 10_000_000))


def desp(sub, valor, dia, banco=ITAU, pago=True, status="aprovada", custo=None):
    """Sem subitem = despesa operacional (Fixo), que entra no card do banco.
    Com subitem de Empréstimo/Aplicação, a classificação a deixa fora do card."""
    custo = custo or ("fixo" if sub is None else "nao_operacional")
    return {"id": f"d{next(_ids)}", "tipo_lancamento_id": sub, "valor": str(valor), "banco_id": banco, "status": status,
            "custo_tipo": custo, "paga_em": dia if pago else None, "data_ref": dia}


def rec(sub, valor, dia, banco=ITAU, recebido=True, status="aprovada", custo=None):
    return {"id": f"r{next(_ids)}", "tipo_lancamento_id": sub, "valor": str(valor), "banco_id": banco, "status": status,
            "custo_tipo": custo, "recebido_em": dia if recebido else None, "data_ref": dia}


def emprestimo(db, periodo, banco="Itaú"):
    """Linha do box: despesas − receitas, como o front calcula."""
    resp = asyncio.run(buscar_emprestimos(*periodo, db, base="pagamento"))
    card = next(b for b in resp.bancos if b.banco == banco)
    return card.despesas.total - card.receitas.total


def aplicacao(db, periodo, banco="Itaú"):
    resp = asyncio.run(buscar_aplicacoes(*periodo, db, base="pagamento"))
    card = next(b for b in resp.bancos if b.banco == banco)
    return card.despesas.total - card.receitas.total


def card_banco(db, periodo, banco="Itaú"):
    resp = asyncio.run(buscar_por_banco(*periodo, db, base="pagamento"))
    return next(b for b in resp.bancos if b.banco_nome == banco)


def resultado(db, periodo, banco="Itaú"):
    card = card_banco(db, periodo, banco)
    return card.saldo_inicial - emprestimo(db, periodo, banco) - aplicacao(db, periodo, banco) + card.saldo_acumulado


# ── Acúmulo com sinal ────────────────────────────────────────

def test_outubro_soma_com_novembro():
    db = Banco(despesas=[desp("s-emp-d", 10000, "2026-10-10"), desp("s-emp-d", 10000, "2026-11-10")])
    assert emprestimo(db, OUT) == Decimal(10000)
    assert emprestimo(db, NOV) == Decimal(20000)


def test_outubro_negativo_subtrai_em_novembro():
    db = Banco(despesas=[desp("s-emp-d", 10000, "2026-11-10")], receitas=[rec("s-emp-r", 10000, "2026-10-10")])
    assert emprestimo(db, OUT) == Decimal(-10000)
    assert emprestimo(db, NOV) == Decimal(0)


def test_aplicacao_acumula_e_quantidade_conta_o_acumulado():
    db = Banco(despesas=[desp("s-apl-d", 300, "2026-10-05"), desp("s-apl-d", 200, "2026-11-05")],
               receitas=[rec("s-apl-r", 50, "2026-11-06")])
    assert aplicacao(db, NOV) == Decimal(450)
    resp = asyncio.run(buscar_aplicacoes(*NOV, db, base="pagamento"))
    itau = next(b for b in resp.bancos if b.banco == "Itaú")
    assert [(i.subitem, i.qtd) for i in itau.despesas.itens] == [("Reserva", 2)]


def test_bancos_nao_se_misturam():
    db = Banco(despesas=[desp("s-emp-d", 100, "2026-10-10", banco=ITAU), desp("s-emp-d", 700, "2026-11-10", banco=SANTANDER)])
    assert emprestimo(db, NOV, "Itaú") == Decimal(100)
    assert emprestimo(db, NOV, "Santander") == Decimal(700)


# ── O que fica fora ──────────────────────────────────────────

def test_sem_data_fica_fora_dos_quadros_e_do_saldo():
    db = Banco(
        despesas=[desp("s-emp-d", 500, "2026-11-10", pago=False), desp("s-apl-d", 500, "2026-11-10", pago=False),
                  desp(None, 500, "2026-11-10", pago=False)],
        receitas=[rec("s-emp-r", 500, "2026-11-10", recebido=False), rec("s-vendas", 500, "2026-11-10", recebido=False)],
    )
    assert emprestimo(db, NOV) == 0
    assert aplicacao(db, NOV) == 0
    assert card_banco(db, NOV).saldo_acumulado == 0


def test_antes_de_outubro_fica_fora():
    db = Banco(despesas=[desp("s-emp-d", 500, "2026-09-30"), desp(None, 500, "2026-09-30")],
               receitas=[rec("s-vendas", 900, "2026-09-30")])
    assert emprestimo(db, NOV) == 0
    assert card_banco(db, NOV).saldo_acumulado == 0


def test_depois_do_fim_do_periodo_fica_fora():
    db = Banco(despesas=[desp("s-emp-d", 500, "2026-12-01"), desp(None, 500, "2026-12-01")])
    assert emprestimo(db, NOV) == 0
    assert card_banco(db, NOV).saldo_acumulado == 0


def test_excluidas_e_rejeitadas_ficam_fora():
    db = Banco(despesas=[desp("s-emp-d", 500, "2026-10-10", status="excluida"), desp(None, 500, "2026-10-10", status="rejeitada")],
               receitas=[rec("s-emp-r", 500, "2026-10-10", status="rejeitada"), rec("s-vendas", 500, "2026-10-10", status="excluida")])
    assert emprestimo(db, NOV) == 0
    assert card_banco(db, NOV).saldo_acumulado == 0


def test_saldo_acumulado_segue_os_criterios_do_card():
    db = Banco(
        despesas=[desp(None, 100, "2026-10-10", custo="fixo"), desp(None, 40, "2026-10-11", custo="variavel"),
                  desp(None, 999, "2026-10-12", custo="aplicacoes")],
        receitas=[rec("s-vendas", 1000, "2026-10-10"), rec("s-vendas", 999, "2026-10-11", custo="aplicacoes"),
                  rec("s-emp-r", 999, "2026-10-12")],
    )
    assert card_banco(db, OUT).saldo_acumulado == Decimal(860)


# ── Card Por Banco × box ─────────────────────────────────────

def test_card_fica_no_periodo_e_acumulado_soma_desde_outubro():
    db = Banco(despesas=[desp(None, 100, "2026-10-10"), desp(None, 30, "2026-11-10")],
               receitas=[rec("s-vendas", 500, "2026-10-10"), rec("s-vendas", 80, "2026-11-10")])
    card = card_banco(db, NOV)
    assert (card.receitas, card.despesas, card.saldo) == (Decimal(80), Decimal(30), Decimal(50))
    assert card.saldo_acumulado == Decimal(450)


def test_periodo_antes_do_inicio_mantem_card_e_zera_acumulado():
    db = Banco(despesas=[desp("s-emp-d", 500, "2026-09-10")], receitas=[rec("s-vendas", 700, "2026-09-10")])
    set26 = (date(2026, 9, 1), date(2026, 9, 30))
    card = card_banco(db, set26)
    assert card.saldo == Decimal(700)
    assert card.saldo_acumulado == 0
    assert emprestimo(db, set26) == 0


# ── Resultado ────────────────────────────────────────────────

def test_saldo_inicial_nao_exige_data_e_nao_conta_duas_vezes():
    db = Banco(receitas=[rec("s-inicial", 100000, "2026-10-01", recebido=False, custo="aplicacoes")])
    card = card_banco(db, NOV)
    assert card.saldo_inicial == Decimal(100000)
    assert card.saldo_acumulado == 0


def test_resultado_de_novembro_parte_do_de_outubro():
    db = Banco(
        despesas=[desp("s-emp-d", 30000, "2026-10-10"), desp("s-emp-d", 1000, "2026-11-10")],
        receitas=[rec("s-inicial", 100000, "2026-10-01", custo="aplicacoes"), rec("s-emp-r", 5000, "2026-10-11")],
    )
    assert resultado(db, OUT) == Decimal(75000)
    assert resultado(db, NOV) == Decimal(74000)


def test_acumulado_passa_de_mil_linhas():
    # O PostgREST corta em 1000 linhas sem avisar: o acumulado precisa paginar.
    db = Banco(despesas=[desp("s-emp-d", 1, "2026-10-10") for _ in range(1500)]
                        + [desp(None, 1, "2026-11-10") for _ in range(1500)])
    assert emprestimo(db, NOV) == Decimal(1500)
    assert card_banco(db, NOV).saldo_acumulado == Decimal(-1500)
