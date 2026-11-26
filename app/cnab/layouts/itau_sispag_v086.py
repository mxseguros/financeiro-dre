"""Itaú — SISPAG, Intercâmbio Eletrônico de Arquivos, Layout CNAB versão 086 (fev/2024).

A v086 não muda posições nem versões em relação à v085 (arquivo 080, lote A
040, J/O/N 030); traz as notas 42–46: agência da conta de pagamento no Pix
(225–229 do A), DOC descontinuado, "seu número" e ambiente de teste do Pix.

Cada registro cita a página do manual v085 (a numeração da v086 é próxima). Posições 1-based, inclusivas.
Diferenças marcantes em relação ao FEBRABAN puro: tipo de movimento com 3
dígitos, agência/conta em campo X(20) (nota 11), CPF/CNPJ do favorecido no
próprio segmento A (204–217), código de barras do O com 48 posições e lotes
Pix obrigatoriamente em arquivo separado (pág. 7).
"""
from app.cnab.engine import campos

BANCO = "341"
VERSAO_ARQUIVO = "080"
VERSAO_LOTE = {"A": "040", "J": "030", "O": "030", "N": "030"}

# Header de arquivo — pág. 12
HEADER_ARQUIVO = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "fixo", "0000"),
    ("tipo_registro", 8, 8, "fixo", "0"),
    ("filler1", 9, 14, "alfa"),
    ("versao", 15, 17, "fixo", VERSAO_ARQUIVO),
    ("tipo_inscricao", 18, 18, "num", "2"),
    ("cnpj", 19, 32, "num"),
    ("filler2", 33, 52, "alfa"),
    ("agencia", 53, 57, "num"),
    ("filler3", 58, 58, "alfa"),
    ("conta", 59, 70, "num"),
    ("filler4", 71, 71, "alfa"),
    ("dac", 72, 72, "num"),
    ("nome_empresa", 73, 102, "alfa"),
    ("nome_banco", 103, 132, "alfa", "BANCO ITAU SA"),
    ("filler5", 133, 142, "alfa"),
    ("remessa_retorno", 143, 143, "num", "1"),
    ("data_geracao", 144, 151, "data"),
    ("hora_geracao", 152, 157, "num"),
    ("zeros", 158, 166, "num"),
    ("densidade", 167, 171, "num"),
    ("filler6", 172, 240, "alfa"),
)

# Header de lote — págs. 13 (A, versão 040), 25 (J), 33 (O), 37 (N) (versão 030)
HEADER_LOTE = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "1"),
    ("operacao", 9, 9, "fixo", "C"),
    ("tipo_pagamento", 10, 11, "num"),
    ("forma_pagamento", 12, 13, "num"),
    ("versao_lote", 14, 16, "num"),
    ("filler1", 17, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num", "2"),
    ("cnpj", 19, 32, "num"),
    ("identificacao_lancamento", 33, 36, "alfa"),
    ("filler2", 37, 52, "alfa"),
    ("agencia", 53, 57, "num"),
    ("filler3", 58, 58, "alfa"),
    ("conta", 59, 70, "num"),
    ("filler4", 71, 71, "alfa"),
    ("dac", 72, 72, "num"),
    ("nome_empresa", 73, 102, "alfa"),
    ("finalidade_lote", 103, 132, "alfa"),
    ("historico", 133, 142, "alfa"),
    ("endereco", 143, 172, "alfa"),
    ("numero", 173, 177, "num"),
    ("complemento", 178, 192, "alfa"),
    ("cidade", 193, 212, "alfa"),
    ("cep", 213, 220, "num"),
    ("uf", 221, 222, "alfa"),
    ("filler5", 223, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

_INICIO = (
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "3"),
    ("sequencial", 9, 13, "num"),
)

# Segmento A — crédito em conta, TED, Pix transferência — pág. 15
SEG_A = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "A"),
    ("tipo_movimento", 15, 17, "num", "000"),
    ("camara", 18, 20, "num"),
    ("banco_favorecido", 21, 23, "num"),
    ("agencia_conta", 24, 43, "texto"),           # nota 11: montado pelo builder
    ("nome_favorecido", 44, 73, "alfa"),
    ("seu_numero", 74, 93, "alfa"),
    ("data_pagamento", 94, 101, "data"),
    ("moeda", 102, 104, "fixo", "REA"),
    ("ispb", 105, 112, "alfa"),
    ("tipo_transferencia", 113, 114, "alfa"),      # nota 36: 01, PG, 03, 04
    ("zeros1", 115, 119, "num"),
    ("valor", 120, 134, "valor"),
    ("nosso_numero", 135, 149, "alfa"),
    ("brancos1", 150, 154, "alfa"),               # nota 42 (agência opcional): não usamos
    ("data_efetiva", 155, 162, "data"),
    ("valor_efetivo", 163, 177, "valor"),
    ("finalidade_detalhe", 178, 197, "alfa"),
    ("numero_documento", 198, 203, "num"),
    ("documento", 204, 217, "num"),
    ("finalidade_doc", 218, 219, "alfa"),
    ("finalidade_ted", 220, 224, "alfa"),
    ("agencia_pagamento", 225, 229, "alfa"),       # nota 44: Pix p/ conta de pagamento
    ("aviso", 230, 230, "fixo", "0"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento B — TED / crédito (opcional) — pág. 17
SEG_B = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "B"),
    ("filler1", 15, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num"),
    ("documento", 19, 32, "num"),
    ("endereco", 33, 62, "alfa"),
    ("numero", 63, 67, "num"),
    ("complemento", 68, 82, "alfa"),
    ("bairro", 83, 97, "alfa"),
    ("cidade", 98, 117, "alfa"),
    ("cep", 118, 125, "num"),
    ("uf", 126, 127, "alfa"),
    ("email", 128, 227, "texto"),
    ("filler2", 228, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento B — Pix transferência (obrigatório) — pág. 18
SEG_B_PIX = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "B"),
    ("tipo_chave", 15, 16, "alfa"),                # nota 37
    ("filler1", 17, 17, "alfa"),
    ("tipo_inscricao", 18, 18, "num"),
    ("documento", 19, 32, "num"),
    ("filler2", 33, 62, "alfa"),
    ("informacao_usuarios", 63, 127, "alfa"),      # 9(65) no manual; tratado como texto (decisão de 25/11)
    ("chave", 128, 227, "texto"),                  # nota 40
    ("filler3", 228, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento J — boleto e Pix QR Code — pág. 26 (código de barras em campos = os 44 dígitos em ordem)
SEG_J = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "J"),
    ("tipo_movimento", 15, 17, "num", "000"),
    ("codigo_barras", 18, 61, "num"),
    ("nome_favorecido", 62, 91, "alfa"),
    ("vencimento", 92, 99, "data"),
    ("valor_titulo", 100, 114, "valor"),
    ("descontos", 115, 129, "valor"),
    ("acrescimos", 130, 144, "valor"),
    ("data_pagamento", 145, 152, "data"),
    ("valor_pagamento", 153, 167, "valor"),
    ("zeros", 168, 182, "num"),
    ("seu_numero", 183, 202, "alfa"),
    ("filler", 203, 215, "alfa"),
    ("nosso_numero", 216, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento J-52 — boleto — pág. 27 (cedente obrigatório, senão "BI")
SEG_J52 = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "J"),
    ("tipo_movimento", 15, 17, "num", "000"),
    ("identificacao", 18, 19, "fixo", "52"),
    ("sacado_tipo", 20, 20, "num", "2"),
    ("sacado_doc", 21, 35, "num"),
    ("sacado_nome", 36, 75, "alfa"),
    ("cedente_tipo", 76, 76, "num"),
    ("cedente_doc", 77, 91, "num"),
    ("cedente_nome", 92, 131, "alfa"),
    ("sacador_tipo", 132, 132, "num"),
    ("sacador_doc", 133, 147, "num"),
    ("sacador_nome", 148, 187, "alfa"),
    ("filler", 188, 240, "alfa"),
)

# Segmento J-52 Pix — QR Code dinâmico e estático — pág. 28 (notas 38 e 41)
SEG_J52_PIX = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "J"),
    ("tipo_movimento", 15, 17, "num", "000"),
    ("identificacao", 18, 19, "fixo", "52"),
    ("sacado_tipo", 20, 20, "num", "2"),
    ("sacado_doc", 21, 35, "num"),
    ("sacado_nome", 36, 75, "alfa"),
    ("cedente_tipo", 76, 76, "num"),
    ("cedente_doc", 77, 91, "num"),
    ("cedente_nome", 92, 131, "alfa"),
    ("chave_url", 132, 208, "texto"),
    ("txid", 209, 240, "texto"),
)

# Segmento O — concessionárias e tributos com código de barras — pág. 34
SEG_O = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "O"),
    ("tipo_movimento", 15, 17, "num", "000"),
    # Validador Itaú (26/11/2026): os 44 dígitos do código de barras em 18–61
    # (anexo B, "composição do código de barras"); a representação de 48 deu
    # "dígito verificador não confere".
    ("codigo_barras", 18, 65, "alfa"),
    ("nome", 66, 95, "alfa"),
    ("vencimento", 96, 103, "data"),
    ("moeda", 104, 106, "fixo", "REA"),
    ("quantidade_moeda", 107, 121, "num"),
    ("valor", 122, 136, "valor"),
    ("data_pagamento", 137, 144, "data"),
    ("valor_pago", 145, 159, "valor"),
    ("filler1", 160, 162, "alfa"),
    ("nota_fiscal", 163, 171, "alfa"),             # validador: 160–174 em branco
    ("filler2", 172, 174, "alfa"),
    ("seu_numero", 175, 194, "alfa"),
    ("filler3", 195, 215, "alfa"),
    ("nosso_numero", 216, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

_N_FIM = (
    ("seu_numero", 196, 215, "alfa"),
    ("nosso_numero", 216, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Segmento N + GPS — pág. 38 e anexo C item 1 (pág. 72)
SEG_N_GPS = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "N"),
    ("tipo_movimento", 15, 17, "num", "000"),
    ("tributo", 18, 19, "fixo", "01"),
    ("codigo_pagamento", 20, 23, "num"),
    ("competencia", 24, 29, "num"),
    ("identificador", 30, 43, "num"),
    ("valor_inss", 44, 57, "valor"),
    ("valor_outras", 58, 71, "valor"),
    ("atualizacao", 72, 85, "valor"),
    ("valor_arrecadado", 86, 99, "valor"),
    ("data_arrecadacao", 100, 107, "data"),
    ("filler1", 108, 115, "alfa"),
    ("uso_empresa", 116, 165, "alfa"),
    ("contribuinte", 166, 195, "alfa"),
    *_N_FIM,
)

# Segmento N + DARF — anexo C item 2 (pág. 72)
SEG_N_DARF = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "N"),
    ("tipo_movimento", 15, 17, "num", "000"),
    ("tributo", 18, 19, "fixo", "02"),
    ("codigo_receita", 20, 23, "num"),
    ("tipo_inscricao", 24, 24, "num"),
    ("inscricao", 25, 38, "texto"),                # CPF à esquerda + 3 brancos; CNPJ 14 dígitos
    ("periodo_apuracao", 39, 46, "data"),
    ("referencia", 47, 63, "alfa"),                # validador: só zeros é recusado → brancos se vazio
    ("valor_principal", 64, 77, "valor"),
    ("valor_multa", 78, 91, "valor"),
    ("valor_juros", 92, 105, "valor"),
    ("valor_total", 106, 119, "valor"),
    ("vencimento", 120, 127, "data"),
    ("data_pagamento", 128, 135, "data"),
    ("filler1", 136, 165, "alfa"),
    ("contribuinte", 166, 195, "alfa"),
    *_N_FIM,
)

# Segmento Z — autenticação (só retorno) — págs. 23, 31, 35, 41
SEG_Z = campos(
    *_INICIO,
    ("segmento", 14, 14, "fixo", "Z"),
    ("autenticacao", 15, 78, "alfa"),
    ("seu_numero", 79, 98, "alfa"),
    ("filler1", 99, 103, "alfa"),
    ("nosso_numero", 104, 118, "alfa"),
    ("filler2", 119, 240, "alfa"),
)

# Trailer de lote — A/J: págs. 24 e 32
TRAILER_LOTE = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "5"),
    ("filler1", 9, 17, "alfa"),
    ("qtd_registros", 18, 23, "num"),
    ("soma_valores", 24, 41, "valor"),
    ("zeros", 42, 59, "num"),
    ("filler2", 60, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Trailer de lote — O (concessionárias): pág. 36
TRAILER_LOTE_O = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "5"),
    ("filler1", 9, 17, "alfa"),
    ("qtd_registros", 18, 23, "num"),
    ("soma_valores", 24, 41, "valor"),
    ("soma_moeda", 42, 59, "num"),                 # validador: zeros até a 59 (como o trailer A/J)
    ("filler2", 60, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Trailer de lote — N (tributos sem código): pág. 42
TRAILER_LOTE_N = campos(
    ("banco", 1, 3, "fixo", BANCO),
    ("lote", 4, 7, "num"),
    ("tipo_registro", 8, 8, "fixo", "5"),
    ("filler1", 9, 17, "alfa"),
    ("qtd_registros", 18, 23, "num"),
    ("total_principal", 24, 37, "valor"),
    ("total_outras", 38, 51, "valor"),
    ("total_acrescimos", 52, 65, "valor"),
    ("total_arrecadado", 66, 79, "valor"),
    ("filler2", 80, 230, "alfa"),
    ("ocorrencias", 231, 240, "alfa"),
)

# Trailer de arquivo — pág. 43
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
    "SEG_B_PIX": SEG_B_PIX, "SEG_J": SEG_J, "SEG_J52": SEG_J52, "SEG_J52_PIX": SEG_J52_PIX, "SEG_O": SEG_O,
    "SEG_N_GPS": SEG_N_GPS, "SEG_N_DARF": SEG_N_DARF, "SEG_Z": SEG_Z, "TRAILER_LOTE": TRAILER_LOTE,
    "TRAILER_LOTE_O": TRAILER_LOTE_O, "TRAILER_LOTE_N": TRAILER_LOTE_N, "TRAILER_ARQUIVO": TRAILER_ARQUIVO,
}
