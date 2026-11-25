"""Santander — Pagamento a Fornecedores, Layout CNAB 240, YLEC_2403 V11.7 (jun/2026).

Cada registro cita a página do manual. Posições 1-based, inclusivas.
"""
from app.cnab.engine import campos

BANCO = "033"
VERSAO_ARQUIVO = "060"
VERSAO_LOTE = {"A": "031", "J": "030", "N": "010", "O": "010"}   # nota G031 / págs. 9, 21, 26, 33

# 3.1 Header de arquivo — pág. 8
HEADER_ARQUIVO = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "fixo", "0000"),
    ("tipo_registro", 8, 8, "fixo", "0"),
    ("filler1", 9, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num", "2"),
    ("cnpj", 19, 32, "doc"),
    ("convenio", 33, 52, "alfa"),
    ("agencia", 53, 57, "num"),
    ("agencia_dv", 58, 58, "alfa"),
    ("conta", 59, 70, "num"),
    ("conta_dv", 71, 71, "alfa"),
    ("ag_conta_dv", 72, 72, "alfa"),
    ("nome_empresa", 73, 102, "alfa"),
    ("nome_banco", 103, 132, "alfa", "BANCO SANTANDER"),
    ("filler2", 133, 142, "alfa"),
    ("remessa_retorno", 143, 143, "num", "1"),
    ("data_geracao", 144, 151, "data"),
    ("hora_geracao", 152, 157, "num"),
    ("nsa", 158, 163, "num"),
    ("versao", 164, 166, "fixo", VERSAO_ARQUIVO),
    ("densidade", 167, 171, "num"),
    ("reservado_banco", 172, 191, "alfa"),
    ("reservado_empresa", 192, 211, "alfa"),
    ("filler3", 212, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Header de lote — págs. 9 (A), 14 (Pix), 21 (J), 26 (N), 33 (O): mesmo leiaute.
HEADER_LOTE = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "1"),
    ("operacao", 9, 9, "fixo", "C"),
    ("tipo_servico", 10, 11, "num"),
    ("forma_lancamento", 12, 13, "num"),
    ("versao_lote", 14, 16, "num"),
    ("filler1", 17, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num", "2"),
    ("cnpj", 19, 32, "doc"),
    ("convenio", 33, 52, "alfa"),
    ("agencia", 53, 57, "num"),
    ("agencia_dv", 58, 58, "alfa"),
    ("conta", 59, 70, "num"),
    ("conta_dv", 71, 71, "alfa"),
    ("ag_conta_dv", 72, 72, "alfa"),
    ("nome_empresa", 73, 102, "alfa"),
    ("mensagem", 103, 142, "alfa"),
    ("endereco", 143, 172, "alfa"),
    ("numero", 173, 177, "num"),
    ("complemento", 178, 192, "alfa"),
    ("cidade", 193, 212, "alfa"),
    ("cep", 213, 217, "num"),
    ("cep_complemento", 218, 220, "num"),
    ("uf", 221, 222, "alfa"),
    ("filler2", 223, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

_INICIO_DETALHE = (
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "3"),
    ("sequencial", 9, 13, "num"),
)

# Segmento A — crédito em conta, TED, Pix por chave/dados bancários — págs. 10 e 15
SEG_A = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "A"),
    ("tipo_movimento", 15, 15, "num", "0"),
    ("instrucao", 16, 17, "num", "00"),
    ("camara", 18, 20, "num"),
    ("banco_favorecido", 21, 23, "num"),
    ("agencia_favorecido", 24, 28, "num"),
    ("agencia_dv", 29, 29, "alfa"),
    ("conta_favorecido", 30, 41, "num"),
    ("conta_dv", 42, 42, "alfa"),
    ("ag_conta_dv", 43, 43, "alfa"),
    ("nome_favorecido", 44, 73, "alfa"),
    ("seu_numero", 74, 93, "alfa"),
    ("data_pagamento", 94, 101, "data"),
    ("moeda", 102, 104, "fixo", "BRL"),
    ("qtd_moeda", 105, 119, "num"),
    ("valor", 120, 134, "valor"),
    ("nosso_numero", 135, 154, "alfa"),
    ("data_real", 155, 162, "data"),
    ("valor_real", 163, 177, "valor"),
    ("mensagem", 178, 217, "alfa"),
    ("filler1", 218, 219, "alfa"),
    ("finalidade_ted", 220, 224, "alfa"),
    ("finalidade_complementar", 225, 226, "alfa"),
    ("filler2", 227, 229, "alfa"),
    ("aviso", 230, 230, "fixo", "0"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento B — TED / crédito em conta — pág. 11
SEG_B = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "B"),
    ("filler1", 15, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num"),
    ("documento", 19, 32, "doc"),
    ("logradouro", 33, 62, "alfa"),
    ("numero", 63, 67, "num"),
    ("complemento", 68, 82, "alfa"),
    ("bairro", 83, 97, "alfa"),
    ("cidade", 98, 117, "alfa"),
    ("cep", 118, 125, "num"),
    ("uf", 126, 127, "alfa"),
    ("vencimento", 128, 135, "data"),
    ("valor_documento", 136, 150, "valor"),
    ("abatimento", 151, 165, "valor"),
    ("desconto", 166, 180, "valor"),
    ("mora", 181, 195, "valor"),
    ("multa", 196, 210, "valor"),
    ("horario_ted", 211, 214, "num"),
    ("filler2", 215, 225, "alfa"),
    ("historico", 226, 229, "num"),
    ("aviso", 230, 230, "fixo", "0"),
    ("filler3", 231, 231, "alfa"),
    ("ted_instituicao", 232, 232, "alfa"),
    ("ispb", 233, 240, "alfa"),
)

# Segmento B-Pix — chave ou dados bancários — pág. 16
SEG_B_PIX = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "B"),
    ("forma_iniciacao", 15, 16, "alfa"),
    ("reservado1", 17, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num"),
    ("documento", 19, 32, "doc"),
    ("txid", 33, 67, "alfa"),
    ("informacao_recebedor", 68, 127, "alfa"),
    ("chave", 128, 226, "texto"),
    ("reservado2", 227, 232, "alfa"),
    ("ispb", 233, 240, "alfa"),
)

# Segmento J — boleto — pág. 22
SEG_J = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "J"),
    ("tipo_movimento", 15, 15, "num", "0"),
    ("instrucao", 16, 17, "num", "00"),
    ("codigo_barras", 18, 61, "num"),
    ("nome_beneficiario", 62, 91, "alfa"),
    ("vencimento", 92, 99, "data"),
    ("valor_nominal", 100, 114, "valor"),
    ("desconto", 115, 129, "valor"),
    ("multa_juros", 130, 144, "valor"),
    ("data_pagamento", 145, 152, "data"),
    ("valor_pagamento", 153, 167, "valor"),
    ("qtd_moeda", 168, 182, "num"),
    ("seu_numero", 183, 202, "alfa"),
    ("nosso_numero", 203, 222, "alfa"),
    ("codigo_moeda", 223, 224, "num"),
    ("filler", 225, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento J52 — boleto — pág. 23 (beneficiário obrigatório)
SEG_J52 = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "J"),
    ("filler1", 15, 15, "alfa"),
    ("movimento", 16, 17, "num", "00"),
    ("identificacao", 18, 19, "fixo", "52"),
    ("pagador_tipo", 20, 20, "num", "2"),
    ("pagador_doc", 21, 35, "doc"),
    ("pagador_nome", 36, 75, "alfa"),
    ("beneficiario_tipo", 76, 76, "num"),
    ("beneficiario_doc", 77, 91, "doc"),
    ("beneficiario_nome", 92, 131, "alfa"),
    ("sacador_tipo", 132, 132, "num"),
    ("sacador_doc", 133, 147, "doc"),
    ("sacador_nome", 148, 187, "alfa"),
    ("filler2", 188, 240, "alfa"),
)

# Segmento J — Pix QR Code dinâmico — pág. 17
SEG_J_PIX = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "J"),
    ("tipo_movimento", 15, 15, "num", "0"),
    ("instrucao", 16, 17, "num", "00"),
    ("txid", 18, 61, "alfa"),
    ("nome_beneficiario", 62, 91, "alfa"),
    ("vencimento", 92, 99, "data"),
    ("valor_nominal", 100, 114, "valor"),
    ("desconto", 115, 129, "valor"),
    ("multa_juros", 130, 144, "valor"),
    ("data_pagamento", 145, 152, "data"),
    ("valor_pagamento", 153, 167, "valor"),
    ("qtd_moeda", 168, 182, "num"),
    ("seu_numero", 183, 202, "alfa"),
    ("nosso_numero", 203, 222, "alfa"),
    ("codigo_moeda", 223, 224, "num"),
    ("filler", 225, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento J52-Pix — pág. 17 (URL do payload, nota G041)
SEG_J52_PIX = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "J"),
    ("filler1", 15, 15, "alfa"),
    ("movimento", 16, 17, "num", "00"),
    ("identificacao", 18, 19, "fixo", "52"),
    ("devedor_tipo", 20, 20, "num", "2"),
    ("devedor_doc", 21, 35, "doc"),
    ("devedor_nome", 36, 75, "alfa"),
    ("recebedor_tipo", 76, 76, "num", "0"),
    ("recebedor_doc", 77, 91, "doc"),
    ("recebedor_nome", 92, 131, "alfa"),
    ("url", 132, 210, "texto"),
    ("filler2", 211, 240, "alfa"),
)

# Segmento O — contas e tributos com código de barras — pág. 34
SEG_O = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "O"),
    ("tipo_movimento", 15, 15, "num", "0"),
    ("instrucao", 16, 17, "num", "00"),
    ("codigo_barras", 18, 61, "num"),
    ("nome", 62, 91, "alfa"),
    ("vencimento", 92, 99, "data"),
    ("data_pagamento", 100, 107, "data"),
    ("valor", 108, 122, "valor"),
    ("seu_numero", 123, 142, "alfa"),
    ("nosso_numero", 143, 162, "alfa"),
    ("filler", 163, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

_N_INICIO = (
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "N"),
    ("tipo_movimento", 15, 15, "num", "0"),
    ("instrucao", 16, 17, "num", "00"),
    ("seu_numero", 18, 37, "alfa"),
    ("nosso_numero", 38, 57, "alfa"),
    ("contribuinte", 58, 87, "alfa"),
    ("data_pagamento", 88, 95, "data"),
    ("valor_total", 96, 110, "valor"),
)

# Segmento N + N1 GPS — pág. 27
SEG_N_GPS = campos(
    *_N_INICIO,
    ("codigo_receita", 111, 116, "num"),
    ("tipo_contribuinte", 117, 118, "num"),
    ("contribuinte_doc", 119, 132, "doc"),
    ("codigo_tributo", 133, 134, "fixo", "17"),
    ("competencia", 135, 140, "num"),
    ("valor_inss", 141, 155, "valor"),
    ("valor_outras", 156, 170, "valor"),
    ("atualizacao", 171, 185, "valor"),
    ("filler", 186, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento N + N2 DARF normal — pág. 27
SEG_N_DARF = campos(
    *_N_INICIO,
    ("codigo_receita", 111, 116, "num"),
    ("tipo_contribuinte", 117, 118, "num"),
    ("contribuinte_doc", 119, 132, "doc"),
    ("codigo_tributo", 133, 134, "fixo", "16"),
    ("periodo_apuracao", 135, 142, "data"),
    ("numero_referencia", 143, 159, "num"),
    ("valor_principal", 160, 174, "valor"),
    ("valor_multa", 175, 189, "valor"),
    ("valor_juros", 190, 204, "valor"),
    ("vencimento", 205, 212, "data"),
    ("filler", 213, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento Z — autenticação (só retorno) — pág. 13
SEG_Z = campos(
    *_INICIO_DETALHE,
    ("segmento", 14, 14, "fixo", "Z"),
    ("autenticacao", 15, 78, "alfa"),
    ("protocolo", 79, 103, "alfa"),
    ("filler", 104, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Trailer de lote — pág. 13
TRAILER_LOTE = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "5"),
    ("filler1", 9, 17, "alfa"),
    ("qtd_registros", 18, 23, "num"),
    ("soma_valores", 24, 41, "valor"),
    ("soma_moeda", 42, 59, "num"),
    ("aviso_debito", 60, 65, "num"),
    ("filler2", 66, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# 3.8 Trailer de arquivo — pág. 39
TRAILER_ARQUIVO = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "fixo", "9999"),
    ("tipo_registro", 8, 8, "fixo", "9"),
    ("filler1", 9, 17, "alfa"),
    ("qtd_lotes", 18, 23, "num"),
    ("qtd_registros", 24, 29, "num"),
    ("filler2", 30, 240, "alfa"),
)

TODOS = {
    "HEADER_ARQUIVO": HEADER_ARQUIVO, "HEADER_LOTE": HEADER_LOTE, "SEG_A": SEG_A, "SEG_B": SEG_B,
    "SEG_B_PIX": SEG_B_PIX, "SEG_J": SEG_J, "SEG_J52": SEG_J52, "SEG_J_PIX": SEG_J_PIX,
    "SEG_J52_PIX": SEG_J52_PIX, "SEG_O": SEG_O, "SEG_N_GPS": SEG_N_GPS, "SEG_N_DARF": SEG_N_DARF,
    "SEG_Z": SEG_Z, "TRAILER_LOTE": TRAILER_LOTE, "TRAILER_ARQUIVO": TRAILER_ARQUIVO,
}
