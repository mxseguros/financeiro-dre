"""Anexos (0045): quem pode enviar, ver e excluir."""
import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual
from app.services import anexos_service as svc
from tests.fake_supabase import Db, uid

ADMIN = UsuarioAtual(user_id="u-admin", email="a@x", role="admin", tenant_id="t1")
GESTOR = UsuarioAtual(user_id="u-gestor", email="g@x", role="gestor", tenant_id="t1")
CONTADOR = UsuarioAtual(user_id="u-cont", email="c@x", role="contador", tenant_id="t1")
OUTRO_TENANT = UsuarioAtual(user_id="u-x", email="x@x", role="admin", tenant_id="t2")

D_CONT, D_ADMIN, D_EXCL = uid(1), uid(2), uid(3)
PDF = dict(nome_arquivo="NF 123.pdf", mime="application/pdf", tamanho=1000)


def base():
    return Db(
        despesas=[
            {"id": D_CONT, "criado_por": "u-cont", "status": "pendente", "tenant_id": "t1"},
            {"id": D_ADMIN, "criado_por": "u-admin", "status": "aprovada", "tenant_id": "t1"},
            {"id": D_EXCL, "criado_por": "u-cont", "status": "excluida", "tenant_id": "t1"},
        ],
        anexos=[],
    )


def subir(db, usuario, despesa_id, **arq):
    a = {**PDF, **arq}
    up = svc.gerar_upload("despesa", despesa_id, a["nome_arquivo"], a["mime"], a["tamanho"], usuario, db)
    return svc.registrar("despesa", despesa_id, up["path"], a["nome_arquivo"], a["mime"], a["tamanho"],
                         "nota_fiscal", usuario, db)


def test_caminho_fica_no_tenant_e_no_lancamento():
    up = svc.gerar_upload("despesa", D_CONT, "Nota Fiscal ção.pdf", "application/pdf", 10, ADMIN, base())
    assert up["path"].startswith(f"t1/despesa/{D_CONT}/") and up["path"].endswith("-Nota_Fiscal_cao.pdf")


def test_quem_nao_ve_tudo_so_anexa_no_proprio():
    db = base()
    subir(db, CONTADOR, D_CONT)
    with pytest.raises(HTTPException) as e:
        subir(db, CONTADOR, D_ADMIN)
    assert e.value.status_code == 404
    subir(db, GESTOR, D_CONT)
    assert len(db.tabelas["anexos"]) == 2


def test_outro_tenant_e_excluida_nao_aparecem():
    for usuario, desp in ((OUTRO_TENANT, D_CONT), (ADMIN, D_EXCL)):
        with pytest.raises(HTTPException) as e:
            svc.gerar_upload("despesa", desp, "a.pdf", "application/pdf", 10, usuario, base())
        assert e.value.status_code == 404


def test_arquivo_invalido():
    for arq in ({"mime": "application/zip"}, {"tamanho": 11 * 1024 * 1024}, {"tamanho": 0}):
        with pytest.raises(HTTPException) as e:
            subir(base(), ADMIN, D_CONT, **arq)
        assert e.value.status_code == 422


def test_nao_registra_caminho_de_outro_lancamento():
    with pytest.raises(HTTPException):
        svc.registrar("despesa", D_CONT, f"t1/despesa/{D_ADMIN}/x.pdf", "x.pdf", "application/pdf", 10,
                      "boleto", ADMIN, base())


def test_excluir_so_o_que_enviou_e_mantem_arquivo_compartilhado():
    db = base()
    meu = subir(db, CONTADOR, D_CONT)
    do_gestor = subir(db, GESTOR, D_CONT)
    with pytest.raises(HTTPException) as e:
        svc.excluir(do_gestor["id"], CONTADOR, db)
    assert e.value.status_code == 403
    # OC aprovada copia o registro: o arquivo só sai quando o último registro sai.
    svc.copiar("despesa", D_CONT, "despesa", D_ADMIN, "t1", db)
    svc.excluir(meu["id"], CONTADOR, db)
    svc.excluir(do_gestor["id"], ADMIN, db)
    assert db.removidos == []
    for copia in list(db.tabelas["anexos"]):
        svc.excluir(copia["id"], ADMIN, db)
    assert len(db.removidos) == 2


def test_contagem_e_lista():
    db = base()
    subir(db, ADMIN, D_CONT)
    subir(db, ADMIN, D_CONT)
    assert svc.contagem("despesa", [D_CONT, D_ADMIN], ADMIN, db) == {D_CONT: 2}
    assert len(svc.listar("despesa", D_CONT, CONTADOR, db)) == 2
    assert "path" not in svc.listar("despesa", D_CONT, CONTADOR, db)[0]
