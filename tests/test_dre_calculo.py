"""Testes do motor da DRE Previsto x Realizado (app/services/dre_calculo.py).

Os valores esperados estão calculados à mão nos comentários, para que uma
divergência aponte se o erro está no teste ou no motor.
"""
import pytest

from app.services.dre_calculo import derivar, montar, pct_meta

CONTAS = [
    {"id": "com", "nome": "Comissões de Vendas", "grupo": "1.1"},
    {"id": "imp", "nome": "Impostos sobre Vendas", "grupo": "2.1"},
    {"id": "pes", "nome": "Pró-Labore", "grupo": "4.1"},
    {"id": "alu", "nome": "Aluguel", "grupo": "4.3"},
    {"id": "tar", "nome": "Tarifas Bancárias", "grupo": "4.6"},
    {"id": "dis", "nome": "Distribuição de Lucros", "grupo": "7.1"},
    {"id": "inf", "nome": "Equipamentos de Informática", "grupo": "7.2"},
    {"id": "rno", "nome": "Outras Receitas Não Operacionais", "grupo": "8.1"},
    {"id": "sem", "nome": "Sem grupo", "grupo": None},  # fora da DRE
]
# Outubro (10) realizado / previsto
REAL = {"com": {9: 180000, 10: 200000}, "imp": {10: 22000}, "pes": {9: 90000, 10: 100000},
        "alu": {10: 10000}, "tar": {10: 1000}, "dis": {10: 20000}, "inf": {10: 5000},
        "rno": {10: 1500}, "sem": {10: 999999}}
PREV = {"com": {10: 210000, 11: 215000}, "imp": {10: 23100}, "pes": {10: 95000},
        "alu": {10: 10000}, "dis": {10: 20000}, "rno": {10: 1000}}
COM_REAL = {9, 10}


def _linha(dre, codigo):
    return next(linha for linha in dre["linhas"] if linha.get("codigo") == codigo)


@pytest.fixture
def outubro():
    return montar(CONTAS, REAL, PREV, COM_REAL, mes_ref=10, visao="mes")


def test_totais_realizados(outubro):
    # REC = 200.000 | MC = 200.000 − 22.000 = 178.000
    # FIXAS = 100.000 + 10.000 + 1.000 = 111.000 | RO = 67.000
    # RL = 67.000 − 20.000 − 5.000 + 1.500 = 43.500
    assert _linha(outubro, "1.1")["realizado"] == 200000
    assert _linha(outubro, "3")["realizado"] == 178000
    assert _linha(outubro, "5")["realizado"] == 111000
    assert _linha(outubro, "6")["realizado"] == 67000
    assert _linha(outubro, "9")["realizado"] == 43500


def test_conta_sem_grupo_fica_fora(outubro):
    # "sem" tem 999.999 e grupo None: não pode entrar em nenhum total.
    assert _linha(outubro, "9")["realizado"] == 43500


def test_totais_previstos(outubro):
    # REC 210.000 | MC 186.900 | FIXAS 105.000 | RO 81.900 | RL = 81.900 − 20.000 + 1.000 = 62.900
    assert _linha(outubro, "1.1")["previsto"] == 210000
    assert _linha(outubro, "3")["previsto"] == 186900
    assert _linha(outubro, "5")["previsto"] == 105000
    assert _linha(outubro, "9")["previsto"] == 62900


def test_ponto_de_equilibrio(outubro):
    pe = outubro["ponto_equilibrio"]
    assert pe["operacional"] == pytest.approx(111000 / 178000 * 200000, abs=0.01)   # 124.719,10
    assert pe["financeiro"] == pytest.approx(136000 / 178000 * 200000, abs=0.01)    # 152.808,99
    assert pe["folga_op"] == pytest.approx((200000 - 124719.101) / 200000, abs=1e-6)


def test_analise_vertical(outubro):
    assert _linha(outubro, "9")["av"] == pytest.approx(43500 / 200000)   # 21,75%
    assert _linha(outubro, "1.1")["av"] == pytest.approx(1.0)


def test_pct_meta_e_desvio(outubro):
    rec = _linha(outubro, "1.1")
    assert rec["desvio"] == -10000
    assert rec["pct_meta"] == pytest.approx(-10000 / 210000)
    assert outubro["kpis"]["resultado_liquido"]["pct_meta"] == pytest.approx((43500 - 62900) / 62900)


def test_pct_meta_previsto_zero_e_none(outubro):
    tarifas = next(c for c in _linha(outubro, "4.6")["contas"] if c["codigo"] == "tar")
    assert tarifas["previsto"] == 0
    assert tarifas["pct_meta"] is None   # sem meta não há % meta
    assert tarifas["desvio"] == 1000


def test_pct_meta_com_previsto_negativo_nao_inverte_sinal():
    # Previsto −100, realizado −50: melhorou. Pela fórmula da planilha
    # (r/p − 1) daria −50% (vermelho); o correto é +50%.
    assert pct_meta(-50, -100) == pytest.approx(0.5)
    assert pct_meta(-150, -100) == pytest.approx(-0.5)


def test_mes_sem_realizado_e_none_nao_zero():
    nov = montar(CONTAS, REAL, PREV, COM_REAL, mes_ref=11, visao="mes")
    rec = _linha(nov, "1.1")
    assert rec["realizado"] is None and rec["desvio"] is None and rec["av"] is None
    assert rec["previsto"] == 215000
    assert nov["kpis"]["receita"]["realizado"] is None
    assert nov["ponto_equilibrio"]["operacional"] is None


def test_margem_nao_positiva_sem_ponto_de_equilibrio():
    g = {k: 0.0 for k in ("1.1", "2.1", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "7.1", "7.2", "8.1")}
    g.update({"1.1": 1000.0, "2.1": 1500.0, "4.1": 200.0})
    d = derivar(g)
    assert d["mc"] == -500
    assert d["pe_op"] is None and d["pe_fin"] is None


def test_acumulado_soma_os_meses():
    acum = montar(CONTAS, REAL, PREV, COM_REAL, mes_ref=10, visao="acumulado")
    assert _linha(acum, "1.1")["realizado"] == 380000   # set 180k + out 200k
    assert _linha(acum, "4.1")["realizado"] == 190000


def test_anual_media_sobre_meses_com_realizado():
    ano = montar(CONTAS, REAL, PREV, COM_REAL, mes_ref=10, visao="anual")
    rec = _linha(ano, "1.1")
    assert rec["acumulado"] == 380000
    assert rec["media_mensal"] == 190000          # ÷ 2 meses com realizado, não ÷ 12
    assert rec["previsto"] == 210000              # só o previsto de set+out entra na comparação
    serie = {p["mes"]: p for p in rec["por_mes"]}
    assert serie[10]["realizado"] == 200000 and serie[11]["realizado"] is None
    assert serie[11]["previsto"] == 215000


def test_serie_mensal_do_grafico():
    d = montar(CONTAS, REAL, PREV, COM_REAL, mes_ref=10, visao="mes")
    m = {x["mes"]: x for x in d["mensal"]}
    assert m[10]["resultado_liquido"] == 43500
    assert m[1]["resultado_liquido"] is None      # mês sem lançamento
    assert d["ultimo_mes_realizado"] == 10


def test_visao_invalida():
    with pytest.raises(ValueError):
        montar(CONTAS, REAL, PREV, COM_REAL, mes_ref=10, visao="trimestre")
