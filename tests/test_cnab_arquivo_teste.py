"""Arquivo de teste para homologação (fase 6) — travas de segurança."""
import pytest
from fastapi import HTTPException

from app.services import arquivo_teste_service as at
from tests.test_cnab_remessa import ADMIN, CONTA, GESTOR, ITAU, banco


def test_santander_so_com_sequencial_de_teste():
    with pytest.raises(HTTPException) as e:
        at.gerar(CONTA, 1, "geral", ADMIN, banco(opcoes={"enviar_bloqueado": False}))
    assert "real" in e.value.detail
    with pytest.raises(HTTPException):
        at.gerar(CONTA, 11, "geral", ADMIN, banco())
    with pytest.raises(HTTPException):
        at.gerar(CONTA, 1, "geral", GESTOR, banco())
    nome, texto = at.gerar(CONTA, 3, "geral", ADMIN, banco(opcoes={"sequencial_teste": True, "enviar_bloqueado": False}))
    linhas = texto.splitlines()
    assert nome.startswith("TESTE") and all(len(l) == 240 for l in linhas) and linhas[0][157:163] == "000003"
    # sempre bloqueado (instrução 09), mesmo com a conta liberando
    assert all(l[15:17] == "09" for l in linhas if l[7] == "3" and l[13] in "AJON" and l[17:19] != "52")


def test_itau_gera_geral_e_pix_separados():
    db = banco()
    _, geral = at.gerar(ITAU, None, "geral", ADMIN, db)
    _, pixs = at.gerar(ITAU, None, "pix", ADMIN, db)
    assert all(len(l) == 240 for l in geral.splitlines() + pixs.splitlines())
    formas = {l[11:13] for l in pixs.splitlines() if l[7] == "1"}
    assert formas == {"45", "47"}
    assert db.tabelas["contas_pagadoras"][1]["proximo_nsa"] == 11     # não consome NSA
