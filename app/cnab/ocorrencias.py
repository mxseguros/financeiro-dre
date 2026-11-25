"""Códigos de ocorrência do retorno (posições 231–240, até 5 × 2).

Santander: §5 do manual V11.7 (págs. 61–64). Itaú: nota 8 do SISPAG v085
(págs. 47–49). `classificar` reduz as ocorrências de um registro a um resultado.
"""
from __future__ import annotations

import re

SANTANDER = {
    "00": "Crédito ou débito efetivado",
    "01": "Insuficiência de fundos - débito não efetuado",
    "02": "Crédito ou débito cancelado pelo pagador/credor",
    "03": "Débito autorizado pela agência - efetuado",
    "AA": "Controle inválido",
    "AB": "Tipo de operação inválido",
    "AC": "Tipo de serviço inválido",
    "AD": "Forma de lançamento inválida",
    "AE": "Tipo/número de inscrição inválido",
    "AF": "Código de convênio inválido",
    "AG": "Agência/conta corrente/DV inválido",
    "AH": "Número sequencial do registro no lote inválido",
    "AI": "Código de segmento de detalhe inválido",
    "AJ": "Tipo de movimento inválido",
    "AK": "Código da câmara de compensação do banco do favorecido/depositário inválido",
    "AL": "Código do banco do favorecido, instituição de pagamento ou depositário inválido",
    "AM": "Agência mantenedora da conta corrente do favorecido inválida",
    "AN": "Conta corrente/DV/conta de pagamento do favorecido inválido",
    "AO": "Nome do favorecido não informado",
    "AP": "Data lançamento inválida/vencimento inválido/data de pagamento não permitida",
    "AQ": "Tipo/quantidade da moeda inválido / layout divergente (Pix)",
    "AR": "Valor do lançamento inválido/divergente/zerado",
    "AS": "Aviso ao favorecido - identificação inválida",
    "AT": "Tipo/número de inscrição do favorecido/contribuinte inválido ou divergente",
    "AU": "Logradouro do favorecido não informado",
    "AV": "Número do local do favorecido não informado",
    "AW": "Cidade do favorecido não informada",
    "AX": "CEP/complemento do favorecido inválido",
    "AY": "Sigla do estado do favorecido inválido",
    "AZ": "Código/nome do banco depositário inválido",
    "BA": "Código/nome da agência depositário não informado",
    "BB": "Número do documento inválido (seu número)",
    "BC": "Nosso número inválido",
    "BD": "Inclusão efetuada com sucesso",
    "BE": "Alteração efetuada com sucesso",
    "BF": "Exclusão efetuada com sucesso",
    "BG": "Agência/conta impedida legalmente",
    "B1": "Bloqueado pendente de autorização",
    "B3": "Bloqueado pelo cliente",
    "B4": "Bloqueado pela captura de título da cobrança",
    "B8": "Bloqueado pela validação de tributos",
    "CA": "Código de barras - código do banco inválido",
    "CB": "Código de barras - código da moeda inválido",
    "CC": "Código de barras - dígito verificador geral inválido",
    "CD": "Código de barras - valor do título inválido",
    "CE": "Código de barras - campo livre inválido",
    "CF": "Valor do documento/principal/menor que o mínimo inválido",
    "CH": "Valor do desconto inválido",
    "CI": "Valor de mora inválido",
    "CJ": "Valor da multa inválido",
    "CK": "Valor do IR inválido",
    "CL": "Valor do ISS inválido",
    "CG": "Valor do abatimento inválido",
    "CM": "Valor do IOF inválido",
    "CN": "Valor de outras deduções inválido",
    "CO": "Valor de outros acréscimos inválido",
    "HA": "Lote não aceito",
    "HB": "Inscrição da empresa inválida para o contrato",
    "HC": "Convênio com a empresa inexistente/inválido para o contrato",
    "HD": "Agência/conta corrente da empresa inexistente/inválida para o contrato",
    "HE": "Tipo de serviço inválido para o contrato",
    "HF": "Conta corrente da empresa com saldo insuficiente",
    "HG": "Lote de serviço fora de sequência",
    "HH": "Lote de serviço inválido",
    "HI": "Arquivo não aceito",
    "HJ": "Tipo de registro inválido",
    "HL": "Versão de layout inválida",
    "HU": "Data / hora de envio inválida",
    "IA": "Pagamento exclusivo em cartório",
    "IJ": "Competência ou período de referência ou número da parcela inválido",
    "IL": "Código pagamento / receita não numérico ou com zeros",
    "IM": "Município inválido",
    "IN": "Número declaração inválido",
    "IO": "Número etiqueta inválido",
    "IP": "Número notificação inválido",
    "IQ": "Inscrição estadual inválida",
    "IR": "Dívida ativa inválida",
    "IS": "Valor honorários ou outros acréscimos inválido",
    "IT": "Período apuração inválido",
    "IU": "Valor ou percentual da receita inválido",
    "IV": "Número referência inválida",
    "PA": "Pix não efetivado",
    "PB": "Transação interrompida devido a erro no PSP do recebedor",
    "PC": "Número da conta transacional encerrada no PSP do recebedor",
    "PD": "Tipo incorreto para a conta transacional especificada",
    "PE": "Tipo de transação não é suportado/autorizado na conta transacional especificada",
    "PF": "CPF/CNPJ do usuário recebedor não é consistente com o titular da conta transacional especificada",
    "PG": "CPF/CNPJ do usuário recebedor incorreto",
    "PH": "Ordem rejeitada pelo PSP do recebedor",
    "PI": "ISPB do PSP do pagador inválido ou inexistente",
    "PK": "QR Code inválido ou vencido",
    "PM": "Chave de pagamento ou QR Code inválido",
    "PN": "Chave de pagamento ou QR Code não informado",
    "SC": "Validação parcial",
    "TA": "Lote não aceito - totais do lote com diferença",
    "XB": "Número de inscrição do contribuinte inválido",
    "XC": "Código do pagamento ou competência ou número de inscrição inválido",
    "XF": "Código do pagamento ou competência não numérico ou igual a zeros",
    "YA": "Título não encontrado",
    "YB": "Identificação registro opcional inválido",
    "YC": "Código padrão inválido",
    "YD": "Código de ocorrência inválido",
    "YE": "Complemento de ocorrência inválido",
    "YF": "Alegação já informada",
    "ZA": "Transferência devolvida",
    "ZB": "Transferência mesma titularidade não permitida",
    "ZC": "Código pagamento tributo inválido",
    "ZD": "Competência inválida",
    "ZE": "Título bloqueado na base",
    "ZF": "Sistema em contingência - título com valor maior que referência",
    "ZG": "Banco destino não recebe TED/Pix / sistema em contingência - título vencido",
    "ZH": "Sistema em contingência - título indexado",
    "ZI": "Beneficiário divergente",
    "ZJ": "Limite de pagamentos parciais excedido",
    "ZK": "Título já liquidado",
    "ZT": "Valor outras entidades inválido",
    "ZU": "Sistema origem inválido",
    "ZW": "Banco destino não recebe essa modalidade de pagamento",
    "ZX": "Banco destino inoperante para essa modalidade de pagamento",
    "ZY": "Código do histórico de crédito inválido",
    "ZV": "Autorização iniciada no Internet Banking",
    "Z0": "Conta com bloqueio",
    "Z1": "Conta fechada. É necessário ativar a conta",
    "Z2": "Conta com movimento controlado",
    "Z3": "Conta cancelada",
    "Z4": "Registro inconsistente (título)",
    "Z5": "Apresentação indevida (título)",
    "Z6": "Dados do destinatário inválidos",
    "Z7": "Agência ou conta destinatária do crédito inválida",
    "Z8": "Divergência na titularidade",
    "Z9": "Conta destinatária do crédito encerrada",
    "C1": "COMPROR - devolvido por outros bancos",
    "C2": "COMPROR - recusado",
    "C3": "COMPROR - rejeitado por sistema",
    "C4": "COMPROR - rejeitado por horário",
    "C6": "COMPROR - aprovado",
    "C7": "COMPROR - compromisso inválido",
    "F1": "CONFIRMING - compromisso liquidado",
    "F2": "CONFIRMING - compromisso em negociação",
    "O1": "Código da OCT inválido",
    "O2": "Descrição do remetente inválida",
    "O3": "Descrição da finalidade inválida",
    "O4": "Código convênio cobrança inválido",
}

# Texto como está no manual (maiúsculas); `descricao` deixa legível.
ITAU = {
    '00': 'PAGAMENTO EFETUADO',
    'AE': 'DATA DE PAGAMENTO ALTERADA',
    'AG': 'NÚMERO DO LOTE INVÁLIDO',
    'AH': 'NÚMERO SEQUENCIAL DO REGISTRO NO LOTE INVÁLIDO',
    'AI': 'PRODUTO DEMONSTRATIVO DE PAGAMENTO NÃO CONTRATADO',
    'AJ': 'TIPO DE MOVIMENTO INVÁLIDO',
    'AL': 'CÓDIGO DO BANCO FAVORECIDO INVÁLIDO',
    'AM': 'AGÊNCIA DO FAVORECIDO INVÁLIDA',
    'AN': 'CONTA CORRENTE DO FAVORECIDO INVÁLIDA',
    'AO': 'NOME DO FAVORECIDO INVÁLIDO',
    'AP': 'DATA DE PAGAMENTO / DATA DE VALIDADE / HORA DE LANÇAMENTO / ARRECADAÇÃO / APURAÇÃO INVÁLIDA',
    'AQ': 'QUANTIDADE DE REGISTROS MAIOR QUE 999999',
    'AR': 'VALOR ARRECADADO / LANÇAMENTO INVÁLIDO',
    'BC': 'NOSSO NÚMERO INVÁLIDO',
    'BD': 'PAGAMENTO AGENDADO',
    'BE': 'PAGAMENTO AGENDADO COM FORMA ALTERADA PARA OP',
    'BI': 'CNPJ / CPF DO FAVORECIDO NO SEGMENTO J-52 ou B INVÁLIDO / DOCUMENTO FAVORECIDO INVÁLIDO PIX',
    'BL': 'VALOR DA PARCELA INVÁLIDO',
    'CD': 'CNPJ / CPF INFORMADO DIVERGENTE DO CADASTRADO',
    'CE': 'PAGAMENTO CANCELADO',
    'CF': 'VALOR DO DOCUMENTO INVÁLIDO / VALOR DIVERGENTE DO QR CODE',
    'CG': 'VALOR DO ABATIMENTO INVÁLIDO',
    'CH': 'VALOR DO DESCONTO INVÁLIDO',
    'CI': 'CNPJ / CPF / IDENTIFICADOR / INSCRIÇÃO ESTADUAL / INSCRIÇÃO NO CAD / ICMS INVÁLIDO',
    'CJ': 'VALOR DA MULTA INVÁLIDO',
    'CK': 'TIPO DE INSCRIÇÃO INVÁLIDA',
    'CL': 'VALOR DO INSS INVÁLIDO',
    'CM': 'VALOR DO COFINS INVÁLIDO',
    'CN': 'CONTA NÃO CADASTRADA',
    'CO': 'VALOR DE OUTRAS ENTIDADES INVÁLIDO',
    'CP': 'CONFIRMAÇÃO DE OP CUMPRIDA',
    'CQ': 'SOMA DAS FATURAS DIFERE DO PAGAMENTO',
    'CR': 'VALOR DO CSLL INVÁLIDO',
    'CS': 'DATA DE VENCIMENTO DA FATURA INVÁLIDA',
    'D0': 'FINALIDADE DO HOLERITE INVÁLIDA',
    'D1': 'MÊS DE COMPETENCIA DO HOLERITE INVÁLIDA',
    'D2': 'DIA DA COMPETENCIA DO HOLETITE INVÁLIDA',
    'D3': 'CENTRO DE CUSTO INVÁLIDO',
    'D4': 'CAMPO NUMÉRICO DA FUNCIONAL INVÁLIDO',
    'D5': 'DATA INÍCIO DE FÉRIAS NÃO NUMÉRICA',
    'D6': 'DATA INÍCIO DE FÉRIAS INCONSISTENTE',
    'D7': 'DATA FIM DE FÉRIAS NÃO NUMÉRICO',
    'D8': 'DATA FIM DE FÉRIAS INCONSISTENTE',
    'D9': 'NÚMERO DE DEPENDENTES IR INVÁLIDO',
    'DA': 'NÚMERO DE DEPEND. SALÁRIO FAMILIA INVALIDO',
    'DB': 'NÚMERO DE HORAS SEMANAIS INVÁLIDO',
    'DC': 'SALÁRIO DE CONTRIBUIÇÃO INSS INVÁLIDO',
    'DD': 'SALÁRIO DE CONTRIBUIÇÃO FGTS INVÁLIDO',
    'DE': 'VALOR TOTAL DOS PROVENTOS INVÁLIDO',
    'DF': 'VALOR TOTAL DOS DESCONTOS INVÁLIDO',
    'DG': 'VALOR LÍQUIDO NÃO NUMÉRICO',
    'DH': 'VALOR LIQ. INFORMADO DIFERE DO CALCULADO',
    'DI': 'VALOR DO SALÁRIO-BASE INVÁLIDO',
    'DJ': 'BASE DE CÁLCULO IRRF INVÁLIDA',
    'DK': 'BASE DE CÁLCULO FGTS INVÁLIDA',
    'DL': 'FORMA DE PAGAMENTO INCOMPATÍVEL COM HOLERITE',
    'DM': 'E-MAIL DO FAVORECIDO INVÁLIDO',
    'DV': 'DOC / TED DEVOLVIDO PELO BANCO FAVORECIDO',
    'E0': 'TIPO DE MOVIMENTO HOLERITE INVÁLIDO',
    'E1': 'VALOR 01 DO HOLERITE / INFORME INVÁLIDO',
    'E2': 'VALOR 02 DO HOLERITE / INFORME INVÁLIDO',
    'E3': 'VALOR 03 DO HOLERITE / INFORME INVÁLIDO',
    'E4': 'VALOR 04 DO HOLERITE / INFORME INVÁLIDO',
    'EM': 'CONFIRMAÇÃO DE OP EMITIDA',
    'EX': 'DEVOLUÇÃO DE OP NÃO SACADA PELO FAVORECIDO',
    'FC': 'PAGAMENTO EFETUADO ATRAVÉS DE FINANCIAMENTO COMPROR',
    'FD': 'PAGAMENTO EFETUADO ATRAVÉS DE FINANCIAMENTO DESCOMPROR',
    'HA': 'ERRO NO LOTE',
    'HM': 'ERRO NO REGISTRO HEADER DE ARQUIVO',
    'IB': 'VALOR DO DOCUMENTO INVÁLIDO',
    'IC': 'VALOR DO ABATIMENTO INVÁLIDO',
    'ID': 'VALOR DO DESCONTO INVÁLIDO',
    'IE': 'VALOR DA MORA INVÁLIDO',
    'IF': 'VALOR DA MULTA INVÁLIDO',
    'IG': 'VALOR DA DEDUÇÃO INVÁLIDO',
    'IH': 'VALOR DO ACRÉSCIMO INVÁLIDO',
    'II': 'DATA DE VENCIMENTO INVÁLIDA / QR CODE EXPIRADO',
    'IJ': 'COMPETÊNCIA / PERÍODO REFERÊNCIA / PARCELA INVÁLIDA',
    'IK': 'TRIBUTO NÃO LIQUIDÁVEL VIA SISPAG OU NÃO CONVENIADO COM ITAÚ',
    'IL': 'CÓDIGO DE PAGAMENTO / EMPRESA /RECEITA INVÁLIDO',
    'IM': 'TIPO X FORMA NÃO COMPATÍVEL',
    'IN': 'BANCO/AGÊNCIA NÃO CADASTRADOS',
    'IO': 'DAC / VALOR / COMPETÊNCIA / IDENTIFICADOR DO LACRE INVÁLIDO / IDENTIFICAÇÃO DO QR CODE INVÁLIDO',
    'IP': 'DAC DO CÓDIGO DE BARRAS INVÁLIDO / ERRO NA VALIDAÇÃO DO QR CODE',
    'IQ': 'DÍVIDA ATIVA OU NÚMERO DE ETIQUETA INVÁLIDO',
    'IR': 'PAGAMENTO ALTERADO',
    'IS': 'CONCESSIONÁRIA NÃO CONVENIADA COM ITAÚ',
    'IT': 'VALOR DO TRIBUTO INVÁLIDO',
    'IU': 'VALOR DA RECEITA BRUTA ACUMULADA INVÁLIDO',
    'IV': 'NÚMERO DO DOCUMENTO ORIGEM / REFERÊNCIA INVÁLIDO',
    'IX': 'CÓDIGO DO PRODUTO INVÁLIDO',
    'LA': 'DATA DE PAGAMENTO DE UM LOTE ALTERADA',
    'LC': 'LOTE DE PAGAMENTOS CANCELADO',
    'NA': 'PAGAMENTO CANCELADO POR FALTA DE AUTORIZAÇÃO',
    'NB': 'IDENTIFICAÇÃO DO TRIBUTO INVÁLIDA',
    'NC': 'EXERCÍCIO (ANO BASE) INVÁLIDO',
    'ND': 'CÓDIGO RENAVAM NÃO ENCONTRADO/INVÁLIDO',
    'NE': 'UF INVÁLIDA',
    'NF': 'CÓDIGO DO MUNICÍPIO INVÁLIDO',
    'NG': 'PLACA INVÁLIDA',
    'NH': 'OPÇÃO/PARCELA DE PAGAMENTO INVÁLIDA',
    'NI': 'TRIBUTO JÁ FOI PAGO OU ESTÁ VENCIDO',
    'NR': 'OPERAÇÃO NÃO REALIZADA',
    'PD': 'AQUISIÇÃO CONFIRMADA (EQUIVALE A OCORRÊNCIA 02 NO LAYOUT DE RISCO SACADO)',
    'RJ': 'REGISTRO REJEITADO',
    'RS': 'PAGAMENTO DISPONÍVEL PARA ANTECIPAÇÃO NO RISCO SACADO – MODALIDADE RISCO SACADO PÓS AUTORIZADO',
    'SS': 'PAGAMENTO CANCELADO POR INSUFICIÊNCIA DE SALDO / LIMITE DIÁRIO DE PAGTO EXCEDIDO',
    'TA': 'LOTE NÃO ACEITO - TOTAIS DO LOTE COM DIFERENÇA',
    'TI': 'TITULARIDADE INVÁLIDA',
    'X1': 'FORMA INCOMPATÍVEL COM LAYOUT 010',
    'X2': 'NÚMERO DA NOTA FISCAL INVÁLIDO',
    'X3': 'IDENTIFICADOR DE NF/CNPJ INVÁLIDO',
    'X4': 'FORMA 32 INVÁLIDA',
}

# Resultado de cada código. O que não está aqui e não é "info" é rejeição.
_OK = {"033": {"00", "03", "F1"}, "341": {"00", "FC", "FD", "CP"}}
_AGENDADO = {"033": {"BD", "BE", "C6"}, "341": {"BD", "BE"}}
_BLOQUEADO = {"033": {"B1", "B3", "B4", "B8", "ZV"}, "341": set()}
_DEVOLVIDO = {"033": {"ZA"}, "341": {"DV", "EX"}}
# Informativos: não mudam a situação do pagamento.
_INFO = {"033": {"BF", "F2", "SC"} | {f"Z{i}" for i in range(10)},
         "341": {"AE", "IR", "LA", "PD", "RS", "EM"}}

_SIGLAS = {"cpf", "cnpj", "ted", "doc", "op", "qr", "pix", "inss", "fgts", "irrf", "ir", "iss", "iof", "dac",
           "nf", "csll", "cofins", "icms", "ispb", "cad", "psp", "cep", "dv", "uf", "renavam", "sispag"}


def _legivel(texto: str) -> str:
    letras = [c for c in texto or "" if c.isalpha()]
    if not letras or sum(c.isupper() for c in letras) < 0.8 * len(letras):
        return texto
    palavras = texto.lower().split()
    saida = [p.upper() if re.sub(r"\W", "", p) in _SIGLAS else p for p in palavras]
    frase = " ".join(saida)
    return frase[:1].upper() + frase[1:]


def tabela(codigo_banco: str) -> dict[str, str]:
    return SANTANDER if codigo_banco == "033" else ITAU


def descricao(codigo_banco: str, codigo: str) -> str:
    return _legivel(tabela(codigo_banco).get(codigo, f"Ocorrência {codigo}"))


def separar(campo: str) -> list[str]:
    """'BDZA      ' → ['BD', 'ZA']"""
    campo = (campo or "").rstrip()
    return [campo[i:i + 2] for i in range(0, len(campo), 2) if campo[i:i + 2].strip()]


def classificar(codigo_banco: str, codigos: list[str], estorno: bool = False) -> str:
    """'paga' | 'agendada' | 'bloqueada_banco' | 'rejeitada' | 'devolvida' | 'info'."""
    if estorno or any(c in _DEVOLVIDO[codigo_banco] for c in codigos):
        return "devolvida"
    conhecidos = _OK[codigo_banco] | _AGENDADO[codigo_banco] | _BLOQUEADO[codigo_banco] | _INFO[codigo_banco]
    if any(c not in conhecidos for c in codigos):
        return "rejeitada"
    if any(c in _OK[codigo_banco] for c in codigos):
        return "paga"
    if any(c in _AGENDADO[codigo_banco] for c in codigos):
        return "agendada"
    if any(c in _BLOQUEADO[codigo_banco] for c in codigos):
        return "bloqueada_banco"
    return "info"


def motivo(codigo_banco: str, codigos: list[str]) -> str:
    return "; ".join(f"{c} – {descricao(codigo_banco, c)}" for c in codigos)
