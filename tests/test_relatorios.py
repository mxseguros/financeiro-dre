"""Testes das partes puras de Relatórios dinâmicos (sem banco)."""
from datetime import date

import openpyxl
import pytest

from app.permissions import get_default_permissions, permissao_relatorios
from app.routers.relatorios import RelatorioCreate
from app.services.relatorio_service import _linha, _tabela_ausente, gerar_excel

NOMES = {"classificacao": {"fixo": "Fixo"}, "centro": {"guincho": "Socorro"}, "usuario": {"u1": "Franciele"}}


def _row(**extra):
    base = {
        "id": "d1", "descricao": " Aluguel  ", "valor": "1500.50", "competencia": "2026-10-01",
        "data_vencimento": "2026-10-10", "paga_em": "2026-10-09", "data_ref": "2026-10-09",
        "centro_custo": "guincho", "status": "pendente", "criado_por": "u1", "custo_tipo": "fixo",
        "parcela_atual": 2, "parcela_total": 10, "tipo_lancamento_id": "s1",
        "subitens_lancamento": {"nome": "Aluguel ", "categorias_lancamento": {"nome": "Despesa administrativa "}},
        "bancos": {"nome": "Itaú"},
    }
    return {**base, **extra}


# ── Permissões ───────────────────────────────────────────────

@pytest.mark.parametrize("role, compartilha", [("admin", True), ("gestor", True), ("comercial", False), ("contador", False)])
def test_padrao_do_perfil(role, compartilha):
    p = get_default_permissions(role)
    assert permissao_relatorios(role, p, "visualizar") is True
    assert permissao_relatorios(role, p, "criar") is True
    assert permissao_relatorios(role, p, "compartilhar") is compartilha


def test_permissao_personalizada_antiga_herda_do_monitor():
    # Gravada antes de existir a chave "relatorios": segue o "Ver" do Monitoramento IA.
    sem_monitor = {"assistente": {"visualizar": False}}
    com_monitor = {"assistente": {"visualizar": True}}
    assert permissao_relatorios("contador", sem_monitor, "visualizar") is False
    assert permissao_relatorios("contador", com_monitor, "criar") is True
    assert permissao_relatorios("contador", com_monitor, "compartilhar") is False
    assert permissao_relatorios("gestor", com_monitor, "compartilhar") is True


def test_chave_nova_prevalece():
    p = {"assistente": {"visualizar": True}, "relatorios": {"visualizar": True, "criar": False, "compartilhar": False}}
    assert permissao_relatorios("admin", p, "criar") is False
    assert permissao_relatorios("admin", p, "compartilhar") is False


# ── Linha plana ──────────────────────────────────────────────

def test_linha_de_despesa_resolve_nomes_e_datas():
    ln = _linha(_row(), "Despesa", NOMES, so_dre=set())
    assert ln["categoria"] == "Despesa administrativa"      # espaço sobrando removido
    assert ln["subitem"] == "Aluguel"
    assert ln["descricao"] == "Aluguel"
    assert ln["centro"] == "Socorro"                         # código guincho → nome
    assert ln["classificacao"] == "Fixo"
    assert ln["criado_por"] == "Franciele"
    assert ln["status"] == "Pendente"
    assert ln["parcela"] == "2/10"
    assert ln["data"] == "2026-10-09" and ln["pago_em"] == "2026-10-09" and ln["pago"] is True
    assert ln["vencimento"] == "2026-10-10" and ln["competencia"] == "2026-10-01"
    assert ln["valor"] == pytest.approx(1500.50)


def test_linha_de_receita_em_aberto_e_codigos_desconhecidos():
    row = _row(paga_em=None, recebido_em=None, custo_tipo="novo", centro_custo="xyz", criado_por="u9",
               parcela_total=None, tipo_lancamento_id="s9")
    ln = _linha(row, "Receita", NOMES, so_dre={"s9"})
    assert ln["pago"] is False and ln["pago_em"] is None
    assert ln["classificacao"] == "novo" and ln["centro"] == "xyz"   # sem cadastro: mostra o código
    assert ln["criado_por"] is None
    assert ln["parcela"] is None
    assert ln["so_dre"] is True


# ── Relatórios salvos ────────────────────────────────────────

def test_tabela_ausente_reconhece_erros_do_postgrest():
    assert _tabela_ausente(Exception("{'code': 'PGRST205', 'message': \"Could not find the table 'public.relatorios' in the schema cache\"}"))
    assert _tabela_ausente(Exception('relation "relatorios" does not exist (42P01)'))
    assert not _tabela_ausente(Exception("permission denied for table despesas"))


def test_config_salva_precisa_das_chaves_e_tem_limite():
    ok = {"linhas": [], "colunas": [], "valores": [], "filtros": {}, "fonte": "ambos"}
    assert RelatorioCreate(nome="X", config=ok).config == ok
    with pytest.raises(ValueError):
        RelatorioCreate(nome="X", config={"linhas": []})
    with pytest.raises(ValueError):
        RelatorioCreate(nome="X", config={**ok, "lixo": "a" * 60_000})


# ── Excel ────────────────────────────────────────────────────

def test_excel_com_tabela_e_aba_de_lancamentos():
    linhas = [
        {"rotulo": "Pessoal", "nivel": 0, "tipo": "sub", "valores": [10.5, 50.0], "formatos": ["brl", "pct"]},
        {"rotulo": "Salários", "nivel": 1, "tipo": "item", "valores": [10.5, None], "formatos": ["brl", "pct"]},
        {"rotulo": "Total geral", "nivel": 0, "tipo": "tot", "valores": [10.5, 100.0], "formatos": ["brl", "pct"]},
    ]
    lanc = [{"data": "2026-10-09", "tipo": "Despesa", "descricao": "Folha", "valor": 10.5}]
    wb = openpyxl.load_workbook(gerar_excel("Teste", "out/2026", ["Categoria", "Valor", "%"], linhas, lanc))
    ws = wb["Relatório"]
    assert [c.value for c in ws[4]] == ["Categoria", "Valor", "%"]
    assert ws["A6"].value == "Salários" and ws["A6"].alignment.indent == 1
    assert ws["B5"].font.bold and ws["C5"].number_format == '0.0"%"'
    wl = wb["Lançamentos"]
    assert wl["A1"].value == "Data" and wl["K1"].value == "Valor"
    assert wl["A2"].value.date() == date(2026, 10, 9) and wl["K2"].value == 10.5


def test_excel_sem_lancamentos_tem_uma_aba():
    wb = openpyxl.load_workbook(gerar_excel("T", "", ["A"], [{"rotulo": "Total geral", "tipo": "tot", "valores": []}]))
    assert wb.sheetnames == ["Relatório"]
