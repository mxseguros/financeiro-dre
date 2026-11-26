"""
MX Seguros — DRE-IA | Arquivo de teste para homologação com o banco (fase 6).

Gera uma remessa com pagamentos fictícios (boleto, Pix por chave, Pix QR,
TED, conta de consumo e DARF) para o banco criticar o leiaute. Não reserva NSA
nem marca despesas. Travas para nunca virar pagamento de verdade:
- Santander: só com o "sequencial de teste" contratado e NSA de 1 a 10
  (o banco trata esses arquivos como teste) e sempre bloqueado (instrução 09);
- Itaú: o arquivo é para a Transmissão (Teste) do Internet Banking — a tela avisa para não
  enviar como remessa.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.cnab import dias_uteis, pix
from app.cnab.builders import itau, santander
from app.cnab.modelo import Favorecido, ItemPagamento
from app.permissions import permissao_pagamentos
from app.services import contas_pagadoras_service
from app.services.remessa_service import _empresa, seu_numero

# Exemplos dos próprios manuais (Santander G008/G041, Itaú anexo B).
_BOLETO_SANTANDER = "03394718600000100009814582200000000000210101"
_CONTA_CONSUMO = "84610000000362700060002000102000000457986595"
_QR_BASE = ("00020101021226850014br.gov.bcb.pix2563pix.santander.com.br/qr/v2/"
            "e2bcdb46-0f01-47b5-9999-2e7cccd3671b520400005303986540510.005802BR"
            "5917SODRO BENTO FILHO6009SAO PAULO62070503***6304")


def _itens(codigo_banco: str, nsa: int, dia: date) -> list[ItemPagamento]:
    forn = Favorecido(nome="FORNECEDOR TESTE LTDA", cpf_cnpj="11222333000181", banco_codigo="237", agencia="1234",
                      conta="56789", conta_dv="0", tipo_conta="corrente", pix_tipo_chave="email",
                      pix_chave="teste@exemplo.com.br")
    um = Decimal("1.00")
    base = [
        ("pix", dict(favorecido=forn, valor=um)),
        ("pix_qr", dict(pix_copia_cola=_QR_BASE + pix.crc16(_QR_BASE), valor=Decimal("10.00"))),
        ("ted", dict(favorecido=forn, valor=um)),
        ("boleto", dict(codigo_barras=_BOLETO_SANTANDER, cedente_doc="11222333000181", cedente_nome="EMPRESA ABC SA",
                        valor=Decimal("100.00"))),
        ("concessionaria", dict(codigo_barras=_CONTA_CONSUMO, descricao="CONTA DE CONSUMO TESTE", valor=Decimal("36.27"))),
        ("tributo", dict(tributo={"tipo": "darf", "codigo_receita": "0561", "periodo_apuracao": (dia - timedelta(days=30)).isoformat()},
                         vencimento=dia, valor=Decimal("10.00"))),
    ]
    return [ItemPagamento(ref=f"teste{n}", seu_numero=seu_numero(codigo_banco, nsa, n), forma=forma, data_pagamento=dia,
                          **kw) for n, (forma, kw) in enumerate(base, start=1)]


def gerar(conta_id: str, nsa: int | None, parte: str, usuario: UsuarioAtual, db: Client) -> tuple[str, str]:
    if not permissao_pagamentos(usuario.role, usuario.permissions, "config"):
        raise HTTPException(403, "Só o Admin gera arquivo de teste.")
    conta = contas_pagadoras_service.ler(conta_id, usuario, db)
    opcoes = conta.get("opcoes") or {}
    dia = dias_uteis.proximo_dia_util(date.today() + timedelta(days=1))
    empresa = _empresa(conta)
    if conta["codigo_banco"] == "033":
        if not opcoes.get("sequencial_teste"):
            raise HTTPException(422, "Sem o \"sequencial de teste\" contratado, o Santander processaria o arquivo como "
                                     "real. Confirme a opção com o gerente e marque-a na conta antes de gerar o teste.")
        nsa = nsa or 1
        if not 1 <= nsa <= 10:
            raise HTTPException(422, "No Santander, arquivo de teste usa número (NSA) de 1 a 10.")
        empresa.opcoes = {**empresa.opcoes, "enviar_bloqueado": True}
        arq = santander.gerar(empresa, _itens("033", nsa, dia), nsa)
        return f"TESTE_PAG033_NSA{nsa:02d}.REM", arq.texto
    nsa = nsa or 1
    grupos = dict(itau.separar(_itens("341", nsa, dia)))
    if parte not in grupos:
        raise HTTPException(422, "Parte inválida: use geral ou pix.")
    arq = itau.gerar(empresa, grupos[parte], nsa)
    return f"TESTE_PAG341_{parte.upper()}.REM", arq.texto
