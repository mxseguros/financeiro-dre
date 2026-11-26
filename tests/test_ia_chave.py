"""Chave da IA em Configurações (0051): cifrada, só Admin, nunca exibida."""
import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import ia_chave_service as ia
from tests.fake_supabase import Db

ADMIN = UsuarioAtual(user_id="a", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="g", email="g@x", role="gestor", tenant_id="t1")
CHAVE = "sk-ant-api03-" + "AbC1" * 20 + "-fimQAA"   # fictícia


@pytest.fixture(autouse=True)
def _isolar(monkeypatch):
    ia.limpar_cache()
    monkeypatch.setenv("CRIPTO_CHAVE", "segredo-de-teste")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(ia.cfg, "anthropic_api_key", "")
    monkeypatch.setattr(ia, "testar", lambda chave: (True, "ok"))
    yield
    ia.limpar_cache()


def test_cifra_e_mascara():
    token = ia.cifrar(CHAVE)
    assert CHAVE not in token and ia.decifrar(token) == CHAVE
    assert ia.mascarar(CHAVE) == "sk-ant-…mQAA"


def test_salvar_grava_cifrado_e_nao_devolve_a_chave():
    db = Db()
    res = ia.salvar(CHAVE, ADMIN, db)
    assert res["configurada"] and res["origem"] == "configuracoes" and res["mascara"] == "sk-ant-…mQAA"
    assert CHAVE not in str(res)
    linha = db.tabelas["integracoes_ia"][0]
    assert CHAVE not in str(linha) and linha["tenant_id"] == "t1"
    # Trocar a chave atualiza a mesma linha.
    ia.salvar(CHAVE.replace("fim", "nov"), ADMIN, db)
    assert len(db.tabelas["integracoes_ia"]) == 1


def test_so_admin():
    for f in (lambda: ia.situacao(GESTOR, Db()), lambda: ia.salvar(CHAVE, GESTOR, Db()),
              lambda: ia.remover(GESTOR, Db()), lambda: ia.testar_atual(GESTOR)):
        with pytest.raises(HTTPException) as e:
            f()
        assert e.value.status_code == 403


def test_formato_e_chave_recusada(monkeypatch):
    with pytest.raises(HTTPException):
        ia.salvar("chave-qualquer-sem-prefixo-1234567890", ADMIN, Db())
    monkeypatch.setattr(ia, "testar", lambda chave: (False, "A Anthropic recusou a chave."))
    db = Db()
    with pytest.raises(HTTPException) as e:
        ia.salvar(CHAVE, ADMIN, db)
    assert "recusou" in e.value.detail and not db.tabelas.get("integracoes_ia")


def test_obter_chave_prefere_configuracoes_e_cai_no_ambiente(monkeypatch):
    db = Db()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-ambiente")
    assert ia.obter_chave("t1", db) == "sk-ant-ambiente"
    ia.salvar(CHAVE, ADMIN, db)
    assert ia.obter_chave("t1", db) == CHAVE
    ia.remover(ADMIN, db)
    assert ia.obter_chave("t1", db) == "sk-ant-ambiente"


def test_sem_chave_nenhuma():
    with pytest.raises(ia.ChaveIndisponivel):
        ia.obter_chave("t1", Db())
    assert ia.situacao(ADMIN, Db())["configurada"] is False


def test_segredo_trocado_nao_vaza_e_avisa(monkeypatch):
    db = Db()
    ia.salvar(CHAVE, ADMIN, db)
    monkeypatch.setenv("CRIPTO_CHAVE", "outro-segredo")
    ia.limpar_cache()
    assert ia.situacao(ADMIN, db)["legivel"] is False
    with pytest.raises(ia.ChaveIndisponivel):
        ia.obter_chave("t1", db)
