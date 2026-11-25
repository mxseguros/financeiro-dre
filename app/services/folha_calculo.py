"""
MX Seguros — DRE-IA | Cálculo da folha CLT (25/11/2026).

Funções puras — sem banco — para o cálculo mensal de um funcionário:
proventos, descontos (INSS e IRRF pela tabela progressiva), líquido,
encargos da empresa (FGTS; INSS patronal só se fora do DAS), benefícios e
custo total. As tabelas vêm de `folha_parametros` (editáveis por ano) e
precisam ser conferidas com o contador.

Convenções:
- valores em Decimal, arredondados a centavos no fim de cada rubrica;
- `params` é o dict de folha_parametros (ver PARAMETROS_PADRAO);
- MX está no Simples Nacional, Anexo III: a CPP (INSS patronal) já está no
  DAS, por isso `inss_patronal_pct` = 0 por padrão.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
CENTAVO = Decimal("0.01")
HORAS_MES = Decimal("220")


def d(v) -> Decimal:
    if v is None or v == "":
        return ZERO
    return v if isinstance(v, Decimal) else Decimal(str(v))


def c(v) -> Decimal:
    return d(v).quantize(CENTAVO, rounding=ROUND_HALF_UP)


# Tabelas de partida. INSS e salário-família: valores de 2025 (a portaria de
# 2026 ainda precisa ser lançada em Configurações → Folha). IRRF: tabela de
# maio/2025 + redutor da Lei 15.270/2025 (isenção até R$ 5.000 a partir de
# 2026). Tudo marcado como NÃO conferido até o contador validar.
PARAMETROS_PADRAO: dict = {
    "ano": 2026,
    "conferido": False,
    "observacao": "Valores de partida: INSS e salário-família de 2025; IRRF 2025 + redutor 2026. "
                  "Confira com o contador e atualize.",
    "inss_faixas": [
        {"ate": 1518.00, "aliquota": 7.5},
        {"ate": 2793.88, "aliquota": 9},
        {"ate": 4190.83, "aliquota": 12},
        {"ate": 8157.41, "aliquota": 14},
    ],
    "irrf_faixas": [
        {"ate": 2428.80, "aliquota": 0, "deducao": 0},
        {"ate": 2826.65, "aliquota": 7.5, "deducao": 182.16},
        {"ate": 3751.05, "aliquota": 15, "deducao": 394.16},
        {"ate": 4664.68, "aliquota": 22.5, "deducao": 675.49},
        {"ate": None, "aliquota": 27.5, "deducao": 908.73},
    ],
    "irrf_deducao_dependente": 189.59,
    "irrf_desconto_simplificado": 607.20,
    # Redutor mensal de 2026: até `isencao_ate` o imposto zera (limitado a
    # `reducao_max`); até `parcial_ate`, reduz `a - b × rendimento`.
    "irrf_redutor": {"isencao_ate": 5000.00, "reducao_max": 312.89,
                     "parcial_ate": 7350.00, "a": 978.62, "b": 0.133145},
    "fgts_pct": 8,
    "inss_patronal_pct": 0,
    "vt_desconto_pct": 6,
    "salario_familia_cota": 65.00,
    "salario_familia_limite": 1906.04,
    "vencimentos": {"salario_dia_util": 5, "fgts_dia": 20, "inss_dia": 20, "irrf_dia": 20,
                    "beneficios_dia_util": 1, "plano_saude_dia": 10},
}


def inss_empregado(base, params: dict) -> Decimal:
    """Progressivo: cada faixa paga a sua alíquota só sobre o pedaço que cai
    nela. Acima da última faixa (teto), não cresce mais."""
    base = d(base)
    total, anterior = ZERO, ZERO
    for f in params.get("inss_faixas") or []:
        limite = d(f["ate"])
        if base <= anterior:
            break
        pedaco = min(base, limite) - anterior
        total += pedaco * d(f["aliquota"]) / 100
        anterior = limite
    return c(total)


def _irrf_tabela(base: Decimal, params: dict) -> Decimal:
    for f in params.get("irrf_faixas") or []:
        if f.get("ate") is None or base <= d(f["ate"]):
            return max(ZERO, base * d(f["aliquota"]) / 100 - d(f["deducao"]))
    return ZERO


def irrf(rendimento, inss, dependentes: int, pensao, params: dict) -> dict:
    """IRRF mensal. Usa a dedução mais vantajosa: a legal (INSS + dependentes
    + pensão) ou o desconto simplificado. Depois aplica o redutor de 2026, que
    olha o RENDIMENTO tributável (não a base já deduzida)."""
    rendimento, inss, pensao = d(rendimento), d(inss), d(pensao)
    legal = inss + d(params.get("irrf_deducao_dependente")) * int(dependentes or 0) + pensao
    simplificado = d(params.get("irrf_desconto_simplificado"))
    deducao = max(legal, simplificado)
    base = max(ZERO, rendimento - deducao)
    bruto = _irrf_tabela(base, params)
    reducao = ZERO
    r = params.get("irrf_redutor") or {}
    if r and bruto > 0:
        if rendimento <= d(r.get("isencao_ate")):
            reducao = min(bruto, d(r.get("reducao_max")) if r.get("reducao_max") else bruto)
        elif rendimento <= d(r.get("parcial_ate")):
            reducao = max(ZERO, d(r.get("a")) - d(r.get("b")) * rendimento)
    valor = c(max(ZERO, bruto - min(reducao, bruto)))
    return {"base": c(base), "deducao": c(deducao), "simplificado": simplificado > legal,
            "imposto_tabela": c(bruto), "redutor": c(min(reducao, bruto)), "valor": valor}


def desconto_vt(salario_base, custo_vt, params: dict) -> Decimal:
    """Até 6% do salário base, nunca mais que o próprio VT."""
    if not d(custo_vt):
        return ZERO
    return c(min(d(salario_base) * d(params.get("vt_desconto_pct", 6)) / 100, d(custo_vt)))


def salario_familia(remuneracao, filhos: int, params: dict) -> Decimal:
    if not filhos or d(remuneracao) > d(params.get("salario_familia_limite")):
        return ZERO
    return c(d(params.get("salario_familia_cota")) * int(filhos))


def dsr(variaveis_valor, dias_uteis: int, domingos_feriados: int) -> Decimal:
    """Descanso semanal remunerado sobre HE e comissões."""
    if not dias_uteis or not d(variaveis_valor):
        return ZERO
    return c(d(variaveis_valor) / int(dias_uteis) * int(domingos_feriados or 0))


def _adicionais(contrato: dict, salario: Decimal) -> Decimal:
    """`adicionais`: {"noturno": {"pct": 20}, "insalubridade": {"valor": 303.6}, ...}"""
    total = ZERO
    for v in (contrato.get("adicionais") or {}).values():
        if not isinstance(v, dict):
            continue
        total += d(v.get("valor")) if v.get("valor") not in (None, "") else salario * d(v.get("pct")) / 100
    return c(total)


def calcular_item(contrato: dict, params: dict, variaveis: dict | None = None) -> dict:
    """Folha de um funcionário em um mês. Devolve as rubricas e os totais.

    `variaveis` (opcional, fase da folha): he50_horas, he100_horas, comissao,
    premio, faltas_dias, adiantamento, outros_descontos, dias_uteis,
    domingos_feriados."""
    v = variaveis or {}
    salario = d(contrato.get("salario_base"))
    valor_hora = salario / HORAS_MES if salario else ZERO

    he50 = c(valor_hora * Decimal("1.5") * d(v.get("he50_horas")))
    he100 = c(valor_hora * 2 * d(v.get("he100_horas")))
    comissao, premio = c(v.get("comissao")), c(v.get("premio"))
    dsr_valor = dsr(he50 + he100 + comissao, int(v.get("dias_uteis") or 0), int(v.get("domingos_feriados") or 0))
    faltas = c(salario / 30 * d(v.get("faltas_dias")))
    adicionais = _adicionais(contrato, salario)

    proventos = {
        "salario": c(salario), "adicionais": adicionais, "he50": he50, "he100": he100,
        "comissao": comissao, "premio": premio, "dsr": dsr_valor,
    }
    remuneracao = c(sum(proventos.values(), ZERO) - faltas)   # base de INSS/IRRF/FGTS
    sal_familia = salario_familia(remuneracao, int(contrato.get("filhos_salario_familia") or 0), params)

    inss = inss_empregado(remuneracao, params)
    pensao = c(contrato.get("pensao_alimenticia"))
    ir = irrf(remuneracao, inss, int(contrato.get("dependentes_ir") or 0), pensao, params)
    vt_custo = c(contrato.get("vt_custo_mensal"))
    vt = desconto_vt(salario, vt_custo, params) if contrato.get("vt_descontar", True) else ZERO
    sindical = c((contrato.get("sindical") or {}).get("valor")) if isinstance(contrato.get("sindical"), dict) else ZERO

    descontos = {
        "faltas": faltas, "inss": inss, "irrf": ir["valor"], "vt": vt,
        "plano_saude": c(contrato.get("plano_saude_desconto")), "pensao": pensao, "sindical": sindical,
        "adiantamento": c(v.get("adiantamento")), "outros": c(v.get("outros_descontos")),
    }
    bruto = c(sum(proventos.values(), ZERO) + sal_familia)
    total_descontos = c(sum(descontos.values(), ZERO))
    liquido = c(bruto - total_descontos)

    fgts = c(remuneracao * d(params.get("fgts_pct", 8)) / 100)
    inss_patronal = c(remuneracao * d(params.get("inss_patronal_pct", 0)) / 100)
    outros = {str(o.get("nome") or "Outro"): c(o.get("valor")) for o in (contrato.get("outros_beneficios") or [])
              if isinstance(o, dict)}
    beneficios = {
        "vt": c(max(ZERO, vt_custo - vt)),        # o que a empresa paga além do desconto
        "va": c(contrato.get("va_valor")),
        "plano_saude": c(contrato.get("plano_saude_empresa")),
        "seguro_vida": c(contrato.get("seguro_vida")),
        **outros,
    }
    # Salário-família é pago pela empresa e compensado na guia do INSS: não é custo.
    encargos = {"fgts": fgts, "inss_patronal": inss_patronal}
    provisoes = {
        "decimo_terceiro": c(remuneracao / 12),
        "ferias": c(remuneracao / 12 * Decimal(4) / 3),
    }
    provisoes["fgts_provisoes"] = c((provisoes["decimo_terceiro"] + provisoes["ferias"]) * d(params.get("fgts_pct", 8)) / 100)

    custo_mes = c(remuneracao + sum(encargos.values(), ZERO) + sum(beneficios.values(), ZERO))
    return {
        "proventos": proventos, "salario_familia": sal_familia, "descontos": descontos,
        "irrf_detalhe": ir, "bruto": bruto, "remuneracao": remuneracao,
        "total_descontos": total_descontos, "liquido": liquido,
        "encargos": encargos, "beneficios": beneficios, "provisoes": provisoes,
        "custo_mes": custo_mes,
        "custo_com_provisoes": c(custo_mes + sum(provisoes.values(), ZERO)),
        # Guias que a empresa recolhe: o INSS do empregado (menos salário-família) e o IRRF retidos.
        "guias": {"fgts": fgts, "inss": c(inss + inss_patronal - sal_familia), "irrf": ir["valor"]},
    }
