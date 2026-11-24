"""Ordem de Compra com perfil Colaborador e despesa gerada na aprovação (0047)."""
import asyncio
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.auth import UsuarioAtual, rota_liberada_colaborador
from app.models.schemas import OrdemCompraAprovacao, OrdemCompraCreate, OrdemCompraUpdate
from app.services import ordens_compra_service as svc
from tests.fake_supabase import Db, uid

COLAB = UsuarioAtual(user_id=uid(50), email="joao@mx", role="colaborador", tenant_id="t1")
ADMIN = UsuarioAtual(user_id=uid(51), email="a@mx", role="admin", tenant_id="t1")
GASOLINA, SAUDE, GRUPO = uid(60), "saude_vida", "venda_nova"


def banco():
    # Na tabela real, a coluna existe e vem nula; o fake só devolve o que foi gravado.
    return Db(
        {"ordens_compra": {"despesa_id": None, "rejeitado_motivo": None}},
        usuarios=[{"id": uid(50), "nome": "João da Silva"}],
        centros_custo=[
            {"id": uid(70), "codigo": GRUPO, "nome": "Venda Nova", "ativo": True, "parent_id": None, "tenant_id": "t1"},
            {"id": uid(71), "codigo": SAUDE, "nome": "Saúde e Vida", "ativo": True, "parent_id": uid(70), "tenant_id": "t1"},
        ],
        subitens_lancamento=[{"id": GASOLINA, "nome": "Combustível", "natureza": "despesa",
                              "categoria": "veiculos", "custo_tipo": "variavel", "tenant_id": "t1"}],
        ordens_compra=[], despesas=[], anexos=[], fechamentos=[],
    )


@pytest.fixture
def db(monkeypatch):
    b = banco()
    monkeypatch.setattr(svc, "get_supabase_admin", lambda: b)
    return b


def criar(db, **kw):
    dados = {"assunto": "Gasolina viagem SP", "descricao": "Abastecimento ida e volta", "valor": 150,
             "data_prevista": date.today(), **kw}
    return asyncio.run(svc.criar_ordem_compra(OrdemCompraCreate(**dados), COLAB, db))


@pytest.mark.parametrize("metodo,caminho,ok", [
    ("GET", "/usuarios/me", True),
    ("POST", "/ordens-compra", True),
    ("GET", "/ordens-compra", True),
    ("PATCH", f"/ordens-compra/{uid(1)}", True),
    ("PATCH", f"/ordens-compra/{uid(1)}/aprovar", False),
    ("POST", "/anexos/upload-url", True),
    ("GET", "/configuracoes/centros-custo", True),
    ("POST", "/configuracoes/centros-custo", False),
    ("GET", "/lancamentos/despesas", False),
    ("GET", "/dashboard/despesas-dia-mes", False),
    ("GET", "/dre/periodo", False),
    ("GET", "/relatorios/dados", False),
])
def test_colaborador_so_alcanca_a_ordem_de_compra(metodo, caminho, ok):
    assert rota_liberada_colaborador(metodo, caminho) is ok


def test_colaborador_e_sempre_o_solicitante(db):
    item = criar(db, solicitante="Outra Pessoa")
    assert item.solicitante == "João da Silva" and item.status == "pendente"
    assert item.data_prevista == date.today()


def test_ordem_nao_vai_para_grupo(db):
    with pytest.raises(HTTPException) as e:
        criar(db, centro_custo=GRUPO)
    assert e.value.status_code == 422


def aprovar(db, ordem_id, **kw):
    ap = OrdemCompraAprovacao(tipo_lancamento_id=GASOLINA, centro_custo=SAUDE, **kw)
    return asyncio.run(svc.aprovar_ordem_compra(ordem_id, ADMIN, db, ap))


def test_aprovar_gera_despesa_com_anexo_e_uma_vez_so(db):
    ordem = criar(db)
    db.tabelas["anexos"].append({"id": uid(90), "entidade": "ordem_compra", "entidade_id": str(ordem.id),
                                 "path": "t1/ordem_compra/x/nota.jpg", "tenant_id": "t1", "nome_arquivo": "nota.jpg"})
    item = aprovar(db, ordem.id)
    assert item.status == "aprovada" and item.despesa_id
    [d] = db.tabelas["despesas"]
    assert d["criado_por"] == COLAB.user_id and d["status"] == "aprovada" and not d.get("paga_em")
    assert Decimal(d["valor"]) == 150 and d["centro_custo"] == SAUDE and d["categoria"] == "veiculos"
    assert d["competencia"] == date.today().replace(day=1).isoformat()
    assert d["data_vencimento"] == date.today().isoformat()
    assert [a["entidade_id"] for a in db.tabelas["anexos"] if a["entidade"] == "despesa"] == [d["id"]]
    # Aprovar de novo não lança outra despesa.
    aprovar(db, ordem.id)
    assert len(db.tabelas["despesas"]) == 1


def test_aprovar_exige_subitem_e_centro(db):
    ordem = criar(db)
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.aprovar_ordem_compra(ordem.id, ADMIN, db, None))
    assert e.value.status_code == 422
    assert db.tabelas["despesas"] == []


def test_mes_fechado_bloqueia(db):
    ordem = criar(db)
    db.tabelas["fechamentos"].append({"id": uid(80), "competencia": date.today().replace(day=1).isoformat(),
                                      "reaberto_em": None})
    with pytest.raises(HTTPException) as e:
        aprovar(db, ordem.id)
    assert e.value.status_code == 409 and db.tabelas["despesas"] == []


def test_ordem_lancada_nao_muda_mais(db):
    ordem = criar(db)
    aprovar(db, ordem.id)
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.atualizar_ordem_compra(ordem.id, OrdemCompraUpdate(valor=999), db, COLAB))
    assert e.value.status_code == 409
    with pytest.raises(HTTPException):
        asyncio.run(svc.rejeitar_ordem_compra(ordem.id, "não", ADMIN, db))


def test_colaborador_corrige_ordem_rejeitada(db):
    ordem = criar(db)
    asyncio.run(svc.rejeitar_ordem_compra(ordem.id, "Falta a nota", ADMIN, db))
    item = asyncio.run(svc.atualizar_ordem_compra(ordem.id, OrdemCompraUpdate(valor=120), db, COLAB))
    assert item.status == "pendente" and item.valor == 120 and item.rejeitado_motivo is None


# ── 0048: funcionário da ordem e recibo depois da aprovação ──

from app.models.schemas import FuncionarioCreate  # noqa: E402
from app.services import funcionarios_service  # noqa: E402

FUNC = uid(80)


@pytest.fixture
def db48(monkeypatch):
    b = banco()
    b.padroes["ordens_compra"] |= {"recibo_status": None, "funcionario_id": None, "recibo_motivo": None}
    b.tabelas["funcionarios"] = [
        {"id": FUNC, "nome": "Maria Souza", "centro_custo": SAUDE, "ativo": True, "tenant_id": "t1"},
        {"id": uid(81), "nome": "Ex Funcionário", "centro_custo": None, "ativo": False, "tenant_id": "t1"},
        {"id": uid(82), "nome": "De outro tenant", "centro_custo": None, "ativo": True, "tenant_id": "t2"},
    ]
    monkeypatch.setattr(svc, "get_supabase_admin", lambda: b)
    return b


def test_funcionario_define_solicitante_e_centro(db48):
    item = criar(db48, funcionario_id=FUNC)
    assert item.solicitante == "Maria Souza" and item.centro_custo == SAUDE
    assert str(item.funcionario_id) == FUNC


def test_funcionario_inativo_ou_de_outro_tenant_nao_vale(db48):
    for fid, codigo in ((uid(81), 422), (uid(82), 404)):
        with pytest.raises(HTTPException) as e:
            criar(db48, funcionario_id=fid)
        assert e.value.status_code == codigo


def _aprovada_com_recibo(db):
    ordem = criar(db, funcionario_id=FUNC)
    aprovada = aprovar(db, ordem.id)
    assert aprovada.recibo_status == "aguardando"
    db.tabelas["anexos"].append({"id": uid(90), "entidade": "ordem_compra", "entidade_id": str(ordem.id),
                                 "tipo_documento": "comprovante", "path": f"t1/ordem_compra/{ordem.id}/r.jpg",
                                 "tenant_id": "t1", "criado_por": COLAB.user_id})
    return aprovada


def test_recibo_enviado_vai_para_a_despesa_e_e_conferido(db48):
    ordem = _aprovada_com_recibo(db48)
    enviado = asyncio.run(svc.enviar_recibo(ordem.id, uid(90), COLAB))
    assert enviado.recibo_status == "enviado"
    na_despesa = [a for a in db48.tabelas["anexos"] if a["entidade"] == "despesa"]
    assert [a["path"] for a in na_despesa] == [f"t1/ordem_compra/{ordem.id}/r.jpg"]
    # Enviar de novo sem devolução: não está esperando recibo.
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.enviar_recibo(ordem.id, uid(90), COLAB))
    assert e.value.status_code == 409
    ok = asyncio.run(svc.conferir_recibo(ordem.id, True, None, ADMIN))
    assert ok.recibo_status == "aprovado"


def test_recibo_devolvido_volta_com_motivo_e_sai_da_despesa(db48):
    ordem = _aprovada_com_recibo(db48)
    asyncio.run(svc.enviar_recibo(ordem.id, uid(90), COLAB))
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.conferir_recibo(ordem.id, False, "", ADMIN))
    assert e.value.status_code == 422
    dev = asyncio.run(svc.conferir_recibo(ordem.id, False, "Foto ilegível", ADMIN))
    assert dev.recibo_status == "devolvido" and dev.recibo_motivo == "Foto ilegível"
    assert not [a for a in db48.tabelas["anexos"] if a["entidade"] == "despesa"]
    # O funcionário manda outro.
    assert asyncio.run(svc.enviar_recibo(ordem.id, uid(90), COLAB)).recibo_status == "enviado"


def test_recibo_so_depois_da_aprovacao_e_com_foto(db48):
    ordem = criar(db48, funcionario_id=FUNC)
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.enviar_recibo(ordem.id, uid(90), COLAB))
    assert e.value.status_code == 409
    aprovar(db48, ordem.id)
    with pytest.raises(HTTPException) as e:
        asyncio.run(svc.enviar_recibo(ordem.id, uid(99), COLAB))   # anexo que não é desta ordem
    assert e.value.status_code == 422


@pytest.mark.parametrize("metodo,caminho,ok", [
    ("GET", "/configuracoes/funcionarios", True),
    ("POST", "/configuracoes/funcionarios", False),
    ("POST", f"/ordens-compra/{uid(1)}/recibo", True),
    ("POST", f"/ordens-compra/{uid(1)}/recibo/conferir", False),
])
def test_colaborador_rotas_0048(metodo, caminho, ok):
    assert rota_liberada_colaborador(metodo, caminho) is ok


def test_cadastro_de_funcionarios(db48):
    item = funcionarios_service.criar(FuncionarioCreate(nome="  Pedro   Lima ", centro_custo=SAUDE), ADMIN, db48)
    assert item.nome == "Pedro Lima" and item.ativo
    with pytest.raises(HTTPException) as e:
        funcionarios_service.criar(FuncionarioCreate(nome="pedro lima"), ADMIN, db48)
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        funcionarios_service.criar(FuncionarioCreate(nome="Ana Grupo", centro_custo=GRUPO), ADMIN, db48)
    assert e.value.status_code == 422
    nomes = [f.nome for f in funcionarios_service.listar(COLAB, db48, so_ativos=True)]
    assert nomes == ["Maria Souza", "Pedro Lima"]           # sem inativo nem outro tenant
    criar(db48, funcionario_id=FUNC)
    with pytest.raises(HTTPException) as e:
        funcionarios_service.excluir(FUNC, ADMIN, db48)       # tem ordem: desativar
    assert e.value.status_code == 409
    funcionarios_service.excluir(item.id, ADMIN, db48)
