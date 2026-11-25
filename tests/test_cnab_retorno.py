"""Retorno CNAB (fase 3) — leitura, baixa, devolução, duplicidade."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.cnab import ocorrencias as oc
from app.cnab.retorno import RetornoInvalido, ler
from app.services import remessa_service as rs
from app.services import retorno_service as rt
from tests.test_cnab_remessa import ADMIN, COMERCIAL, CONTA, D1, D2, D4, DIA, GESTOR, ITAU, banco


def _retorno(texto_remessa: str, codigos: dict[str, str], data_real: str = "") -> bytes:
    """Transforma a remessa em retorno: header com código 2 e ocorrências por seu número."""
    saida = []
    for l in texto_remessa.splitlines():
        if l[7] == "0":
            l = l[:142] + "2" + l[143:]
        elif l[7] == "3" and l[13] in "AJON" and not (l[13] == "J" and l[17:19] == "52"):
            for seu, cod in codigos.items():
                if seu in l:
                    l = l[:230] + cod.ljust(10) + l[240:]
                    if data_real and l[13] == "A":
                        l = l[:154] + data_real + l[162:]
        saida.append(l)
    return ("\r\n".join(saida) + "\r\n").encode("latin-1")


def _gerar(db, ids, conta=CONTA, usuario=ADMIN):
    r = rs.gerar(conta, DIA, ids, usuario, db)
    itens = {i["despesa_id"]: i["seu_numero"] for i in db.tabelas["remessa_itens"] if i["remessa_id"] == r["id"]}
    return r, itens


def _desp(db, i):
    return next(d for d in db.tabelas["despesas"] if d["id"] == i)


def test_classificacao_ocorrencias():
    assert oc.classificar("033", ["00"]) == "paga"
    assert oc.classificar("033", ["BD"]) == "agendada"
    assert oc.classificar("033", ["B1"]) == "bloqueada_banco"
    assert oc.classificar("033", ["ZA", "Z8"]) == "devolvida"
    assert oc.classificar("033", ["AT"]) == "rejeitada"
    assert oc.classificar("033", ["BD"], estorno=True) == "devolvida"
    assert oc.classificar("341", ["NA"]) == "rejeitada"
    assert oc.classificar("341", ["DV"]) == "devolvida"
    assert oc.classificar("341", ["AE"]) == "info"
    assert oc.separar("BDZA      ") == ["BD", "ZA"]


def test_parser_recusa_remessa_e_lixo():
    with pytest.raises(RetornoInvalido):
        ler("abc\n")
    db = banco()
    _gerar(db, [D1])
    with pytest.raises(RetornoInvalido):
        ler(next(iter(db.arquivos.values())).decode())


def test_fluxo_critica_depois_movimento():
    db = banco()
    r, seus = _gerar(db, [D1, D2, D4])
    remessa_txt = next(iter(db.arquivos.values())).decode()
    # 1) crítica: D1 e D4 agendados (B1 = autorizar), D2 rejeitado (AT)
    critica = _retorno(remessa_txt, {seus[D1]: "BD", seus[D2]: "AT", seus[D4]: "B1"})
    res = rt.importar("critica.ret", critica, GESTOR, db)
    assert res["tipo"] == "critica" and res["contagem"]["agendados"] == 1 and res["contagem"]["rejeitados"] == 1
    assert _desp(db, D1)["status_pagamento"] == "agendada"
    assert _desp(db, D4)["status_pagamento"] == "bloqueada_banco"
    assert _desp(db, D2)["status_pagamento"] == "rejeitada" and "AT" in res["rejeitados"][0]["motivo"]
    # rejeitada volta para "a pagar" e pode entrar noutra remessa
    assert D2 in {i["id"] for i in rs.a_pagar(GESTOR, db)["itens"]}
    # 2) o mesmo arquivo de novo é recusado
    with pytest.raises(HTTPException) as e:
        rt.importar("critica.ret", critica, GESTOR, db)
    assert e.value.status_code == 409
    # 3) movimento: D1 e D4 pagos com data real
    movimento = _retorno(remessa_txt, {seus[D1]: "00", seus[D4]: "00"}, data_real="02122026")
    res = rt.importar("mov.ret", movimento, GESTOR, db)
    assert res["tipo"] == "movimento" and res["contagem"]["pagos"] == 2
    assert _desp(db, D1)["status_pagamento"] == "paga" and _desp(db, D1)["paga_em"] == "2026-12-02"
    assert db.tabelas["remessas"][0]["status"] == "processada"
    eventos = [e["evento"] for e in db.tabelas["despesa_pagamento_eventos"] if e["despesa_id"] == D1]
    assert eventos == ["incluida_remessa", "retorno_agendada", "retorno_paga"]
    # 4) uma crítica tardia não rebaixa o pago
    tardia = _retorno(remessa_txt, {seus[D1]: "BD"}).replace(b"\r\n", b"\n")
    rt.importar("tardia.ret", tardia, GESTOR, db)
    assert _desp(db, D1)["status_pagamento"] == "paga"


def test_devolucao_depois_de_pago():
    db = banco()
    r, seus = _gerar(db, [D1])
    txt = next(iter(db.arquivos.values())).decode()
    rt.importar("a.ret", _retorno(txt, {seus[D1]: "00"}), ADMIN, db)
    res = rt.importar("b.ret", _retorno(txt, {seus[D1]: "ZAZ8"}), ADMIN, db)
    d = _desp(db, D1)
    assert res["contagem"]["devolvidos"] == 1 and d["status_pagamento"] == "devolvida" and d["paga_em"] is None
    assert "Divergência na titularidade" in res["devolvidos"][0]["motivo"]


def test_lote_rejeitado_inteiro_e_nao_encontrado():
    db = banco()
    r, seus = _gerar(db, [D1, D2])
    txt = next(iter(db.arquivos.values())).decode()
    linhas = []
    for l in _retorno(txt, {}).decode().splitlines():
        if l[7] == "5":
            l = l[:230] + "TA".ljust(10)
        linhas.append(l)
    linhas.insert(2, linhas[2][:73] + "MX999999999999999".ljust(20) + linhas[2][93:230] + "00".ljust(10))
    res = rt.importar("lote.ret", ("\r\n".join(linhas) + "\r\n").encode(), ADMIN, db)
    assert res["contagem"]["rejeitados"] == 2 and res["contagem"]["nao_encontrados"] == 1
    assert "1" in res["ocorrencias_lote"]


def test_retorno_itau():
    db = banco()
    r, seus = _gerar(db, [D1], conta=ITAU)
    txt = next(iter(db.arquivos.values())).decode()
    res = rt.importar("itau.ret", _retorno(txt, {seus[D1]: "00"}, data_real="03122026"), ADMIN, db)
    assert res["banco"] == "341" and res["contagem"]["pagos"] == 1
    assert _desp(db, D1)["paga_em"] == "2026-12-03"


def test_permissoes_e_baixa_manual():
    db = banco()
    with pytest.raises(HTTPException):
        rt.importar("x.ret", b"x", COMERCIAL, db)
    ontem = date.today() - timedelta(days=1)
    out = rt.baixa_manual(D2, ontem, GESTOR, db)
    assert out["ok"] and _desp(db, D2)["status_pagamento"] == "paga_manual" and _desp(db, D2)["paga_em"] == ontem.isoformat()
    with pytest.raises(HTTPException):
        rt.baixa_manual(D1, date.today() + timedelta(days=2), GESTOR, db)
    _gerar(db, [D1])
    with pytest.raises(HTTPException) as e:
        rt.baixa_manual(D1, ontem, GESTOR, db)
    assert e.value.status_code == 409
