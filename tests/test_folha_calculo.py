"""Cálculo da folha CLT (25/11/2026) — valores conferidos à mão contra as
tabelas de partida (INSS 2025; IRRF 2025 + redutor da Lei 15.270/2025)."""
from decimal import Decimal as D

from app.services import folha_calculo as fc

P = fc.PARAMETROS_PADRAO


def test_inss_progressivo_e_teto():
    assert fc.inss_empregado(1518, P) == D("113.85")
    # 113,85 + 114,83 + 24,73
    assert fc.inss_empregado(3000, P) == D("253.41")
    # Acima do teto (8.157,41) não cresce: 951,63.
    assert fc.inss_empregado(8157.41, P) == D("951.63")
    assert fc.inss_empregado(20000, P) == D("951.63")
    assert fc.inss_empregado(0, P) == D("0")


def test_irrf_isento_ate_5_mil_com_redutor():
    ir = fc.irrf(4800, fc.inss_empregado(4800, P), 0, 0, P)
    assert ir["imposto_tabela"] > 0 and ir["valor"] == D("0")


def test_irrf_faixa_de_transicao():
    # 6.000: INSS 649,60 (dedução legal > simplificado) → base 5.350,40
    # tabela: 5.350,40 × 27,5% − 908,73 = 562,63; redutor 978,62 − 0,133145 × 6.000 = 179,75
    inss = fc.inss_empregado(6000, P)
    assert inss == D("649.60")
    ir = fc.irrf(6000, inss, 0, 0, P)
    assert ir["base"] == D("5350.40") and ir["imposto_tabela"] == D("562.63")
    assert ir["redutor"] == D("179.75") and ir["valor"] == D("382.88")


def test_irrf_dependentes_e_sem_redutor_acima_de_7350():
    inss = fc.inss_empregado(10000, P)
    sem = fc.irrf(10000, inss, 0, 0, P)
    com = fc.irrf(10000, inss, 2, 0, P)
    assert sem["redutor"] == 0
    # cada dependente tira 189,59 da base, a 27,5%
    assert sem["valor"] - com["valor"] == D("104.27")


def test_irrf_usa_simplificado_quando_melhor():
    ir = fc.irrf(3000, fc.inss_empregado(3000, P), 0, 0, P)
    assert ir["simplificado"] is True and ir["deducao"] == D("607.20")


def test_vt_limitado_ao_custo():
    assert fc.desconto_vt(3000, 400, P) == D("180.00")
    assert fc.desconto_vt(3000, 100, P) == D("100.00")
    assert fc.desconto_vt(3000, 0, P) == D("0")


def test_item_completo():
    contrato = {"salario_base": 3000, "vt_custo_mensal": 300, "va_valor": 600,
                "plano_saude_empresa": 250, "plano_saude_desconto": 50, "dependentes_ir": 0}
    r = fc.calcular_item(contrato, P)
    assert r["bruto"] == D("3000.00")
    assert r["descontos"]["inss"] == D("253.41") and r["descontos"]["irrf"] == D("0")
    assert r["descontos"]["vt"] == D("180.00")
    assert r["liquido"] == D("3000.00") - D("253.41") - D("180.00") - D("50.00")
    assert r["encargos"]["fgts"] == D("240.00") and r["encargos"]["inss_patronal"] == 0
    # custo = 3000 + FGTS 240 + VT 120 (300 − 180) + VA 600 + plano 250
    assert r["custo_mes"] == D("4210.00")
    assert r["provisoes"]["decimo_terceiro"] == D("250.00")
    assert r["provisoes"]["ferias"] == D("333.33")


def test_horas_extras_dsr_e_faltas():
    contrato = {"salario_base": 2200}   # hora = 10
    r = fc.calcular_item(contrato, P, {"he50_horas": 10, "he100_horas": 2, "comissao": 0,
                                       "dias_uteis": 25, "domingos_feriados": 5, "faltas_dias": 1})
    assert r["proventos"]["he50"] == D("150.00") and r["proventos"]["he100"] == D("40.00")
    assert r["proventos"]["dsr"] == D("38.00")          # 190 / 25 × 5
    assert r["descontos"]["faltas"] == D("73.33")        # 2200 / 30
    assert r["encargos"]["fgts"] == D("188.37")              # (2200 + 150 + 40 + 38 − 73,33) × 8%


def test_adicional_por_pct_ou_valor_e_inss_patronal_fora_do_das():
    contrato = {"salario_base": 2000, "adicionais": {"noturno": {"pct": 20}, "insal": {"valor": 303.6}}}
    params = {**P, "inss_patronal_pct": 20}
    r = fc.calcular_item(contrato, params)
    assert r["proventos"]["adicionais"] == D("703.60")
    assert r["encargos"]["inss_patronal"] == D("540.72")


def test_salario_familia_nao_e_custo_e_abate_a_guia():
    r = fc.calcular_item({"salario_base": 1600, "filhos_salario_familia": 2}, P)
    assert r["salario_familia"] == D("130.00")
    assert r["bruto"] == D("1730.00")
    assert r["guias"]["inss"] == r["descontos"]["inss"] - D("130.00")
    assert r["custo_mes"] == D("1600.00") + r["encargos"]["fgts"]
