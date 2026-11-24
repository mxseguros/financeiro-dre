"""
MX Seguros — DRE-IA | Serviço de Ordens de Compra.

Espelha o padrão de despesas (financeiro_service): soft-delete via
status='excluida', criado_por/tenant_id injetados pelo backend,
visibilidade por role, aprovar/rejeitar. data_solicitacao é sempre a
data do servidor (o cliente não envia esse campo).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.database import executar_sem_bloquear as _exec, get_supabase_admin
from app.models.schemas import (
    OrdemCompraAprovacao, OrdemCompraCreate, OrdemCompraItem, OrdemCompraUpdate, OrdensCompraResponse,
)

_COLS = (
    "id, solicitante, assunto, descricao, valor, data_solicitacao, status, "
    "criado_por, aprovado_por, aprovado_em, rejeitado_motivo, criado_em"
)
# Colunas da 0047. Sem a migration, a ordem funciona como antes (sem gerar despesa).
_COLS_0047 = _COLS + ", data_prevista, centro_custo, tipo_lancamento_id, despesa_id"
_APROVADORES = ("admin", "gestor")


def _dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal(0)


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _row_para_item(row: dict) -> OrdemCompraItem:
    return OrdemCompraItem(
        id=row["id"],
        solicitante=row["solicitante"],
        assunto=row["assunto"],
        descricao=row["descricao"],
        valor=Decimal(str(row["valor"])) if row.get("valor") is not None else None,
        data_solicitacao=row["data_solicitacao"],
        status=row.get("status", "pendente"),
        criado_por=row.get("criado_por"),
        aprovado_por=row.get("aprovado_por"),
        aprovado_em=row.get("aprovado_em"),
        rejeitado_motivo=row.get("rejeitado_motivo"),
        criado_em=row.get("criado_em"),
        data_prevista=row.get("data_prevista"),
        centro_custo=row.get("centro_custo"),
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        despesa_id=row.get("despesa_id"),
    )


def _selecionar(db: Client, montar):
    """Roda a consulta com as colunas da 0047; sem elas, com as antigas."""
    try:
        return montar(db.table("ordens_compra").select(_COLS_0047)).execute()
    except Exception as e:  # noqa: BLE001
        if "data_prevista" not in str(e) and "despesa_id" not in str(e) and "column" not in str(e).lower():
            raise
        return montar(db.table("ordens_compra").select(_COLS)).execute()


def _carregar(ordem_id: UUID, usuario: UsuarioAtual, db_admin: Client) -> dict:
    def montar(q):
        q = q.eq("id", str(ordem_id)).neq("status", "excluida")
        if getattr(usuario, "tenant_id", None):
            q = q.eq("tenant_id", usuario.tenant_id)
        return q
    linhas = _selecionar(db_admin, montar).data or []
    if not linhas:
        raise _erro(404, "Ordem de compra não encontrada.")
    return linhas[0]


async def buscar_ordens_compra(
    inicio: date,
    fim: date,
    usuario: UsuarioAtual,
    db: Client,
    status_filter: str | None = None,
) -> OrdensCompraResponse:
    def montar(q):
        q = (q.neq("status", "excluida")
             .gte("data_solicitacao", inicio.isoformat())
             .lte("data_solicitacao", fim.isoformat()))
        # Comercial e Colaborador veem só as próprias; admin/gestor/contador, tudo.
        if usuario.role in ("comercial", "colaborador"):
            q = q.eq("criado_por", usuario.user_id)
        if status_filter:
            q = q.eq("status", status_filter)
        return q.order("data_solicitacao", desc=True)

    resp = _selecionar(db, montar)
    items = [_row_para_item(r) for r in (resp.data or [])]
    soma = sum((i.valor for i in items if i.valor is not None), Decimal(0))
    pendentes = sum(1 for i in items if i.status == "pendente")
    return OrdensCompraResponse(
        total=len(items), items=items, soma_total=soma, total_pendentes=pendentes,
    )


def _nome_usuario(usuario: UsuarioAtual) -> str:
    try:
        linhas = (get_supabase_admin().table("usuarios").select("nome")
                  .eq("id", usuario.user_id).limit(1).execute().data or [])
        if linhas and (linhas[0].get("nome") or "").strip():
            return linhas[0]["nome"].strip()
    except Exception:  # noqa: BLE001 — sem o nome, usa o e-mail
        pass
    return usuario.email or "Colaborador"


async def criar_ordem_compra(
    payload: OrdemCompraCreate,
    usuario: UsuarioAtual,
    db: Client,
) -> OrdemCompraItem:
    from app.services.financeiro_service import validar_centro_lancamento

    # O colaborador sempre é o solicitante; os demais podem lançar por alguém.
    solicitante = (payload.solicitante or "").strip()
    if usuario.role == "colaborador" or not solicitante:
        solicitante = _nome_usuario(usuario)
    if payload.centro_custo:
        validar_centro_lancamento(db, payload.centro_custo)
    dados: dict = {
        "solicitante":      solicitante[:200],
        "assunto":          payload.assunto,
        "descricao":        payload.descricao,
        "valor":            str(payload.valor),
        "data_solicitacao": date.today().isoformat(),   # server-controlled
        "status":           "pendente",
        "criado_por":       usuario.user_id,
    }
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id
    extras = {
        "data_prevista":      (payload.data_prevista or date.today()).isoformat(),
        "centro_custo":       payload.centro_custo or None,
        "tipo_lancamento_id": str(payload.tipo_lancamento_id) if payload.tipo_lancamento_id else None,
    }
    try:
        resp = db.table("ordens_compra").insert({**dados, **extras}).execute()
    except Exception as e:  # noqa: BLE001 — sem a 0047, grava como antes
        if "column" not in str(e).lower() and "data_prevista" not in str(e):
            raise
        resp = db.table("ordens_compra").insert(dados).execute()
    return _row_para_item(resp.data[0])


async def atualizar_ordem_compra(
    ordem_id: UUID, payload: OrdemCompraUpdate, db: Client, usuario: UsuarioAtual | None = None,
) -> OrdemCompraItem:
    from app.services.financeiro_service import validar_centro_lancamento

    if usuario is not None:
        atual = _carregar(ordem_id, usuario, get_supabase_admin())
        if atual.get("despesa_id"):
            raise _erro(409, "Esta ordem já virou despesa. Edite a despesa em Lançamentos.")
        if usuario.role not in _APROVADORES and str(atual.get("criado_por")) != str(usuario.user_id):
            raise _erro(404, "Ordem de compra não encontrada.")
        if usuario.role == "colaborador" and atual.get("status") == "aprovada":
            raise _erro(409, "Ordem já aprovada — não pode mais ser alterada.")

    campos: dict = {}
    set_fields = payload.model_fields_set
    if "solicitante" in set_fields and payload.solicitante and (usuario is None or usuario.role != "colaborador"):
        campos["solicitante"] = payload.solicitante
    if "assunto" in set_fields and payload.assunto:
        campos["assunto"] = payload.assunto
    if "descricao" in set_fields and payload.descricao:
        campos["descricao"] = payload.descricao
    if "valor" in set_fields and payload.valor is not None:
        campos["valor"] = str(payload.valor)
    if "data_prevista" in set_fields and payload.data_prevista:
        campos["data_prevista"] = payload.data_prevista.isoformat()
    if "centro_custo" in set_fields:
        if payload.centro_custo:
            validar_centro_lancamento(db, payload.centro_custo)
        campos["centro_custo"] = payload.centro_custo or None
    if "tipo_lancamento_id" in set_fields:
        campos["tipo_lancamento_id"] = str(payload.tipo_lancamento_id) if payload.tipo_lancamento_id else None
    campos["atualizado_em"] = datetime.now(timezone.utc).isoformat()
    # Editou, volta para aprovação — mesma regra de despesas e receitas. Sem
    # isto, uma ordem aprovada podia ter valor e assunto trocados depois da
    # aprovação e continuar constando como aprovada.
    campos["status"] = "pendente"
    campos["rejeitado_motivo"] = None

    resp = (
        db.table("ordens_compra")
        .update(campos)
        .eq("id", str(ordem_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de compra não encontrada.")
    return _row_para_item(resp.data[0])


def _gerar_despesa(
    ordem: dict, aprovacao: OrdemCompraAprovacao, usuario: UsuarioAtual, db_admin: Client, db: Client,
) -> str:
    """Ordem aprovada → despesa a pagar no mês da data prevista, em nome de
    quem pediu, já aprovada (a aprovação foi a da ordem). Devolve o id."""
    from app.models.schemas import CATEGORIAS_DESPESA_VALIDAS
    from app.services import anexos_service, classificacao_service
    from app.services.financeiro_service import (
        _verificar_periodo_aberto, campos_aprovacao, validar_centro_lancamento,
    )

    tenant = getattr(usuario, "tenant_id", None)
    if ordem.get("valor") is None or _dec(ordem["valor"]) <= 0:
        raise _erro(422, "A ordem está sem valor. Edite a ordem e informe o valor antes de aprovar.")
    data = date.fromisoformat(str(ordem.get("data_prevista") or ordem["data_solicitacao"])[:10])
    competencia = date(data.year, data.month, 1)
    _verificar_periodo_aberto(competencia, db)   # client do usuário: fechamentos do tenant
    validar_centro_lancamento(db_admin, aprovacao.centro_custo, tenant_id=tenant)

    q = db_admin.table("subitens_lancamento").select("id, nome, natureza, categoria, custo_tipo") \
        .eq("id", str(aprovacao.tipo_lancamento_id))
    if tenant:
        q = q.eq("tenant_id", tenant)
    subs = q.execute().data or []
    if not subs or subs[0].get("natureza") != "despesa":
        raise _erro(422, "Escolha um subitem de despesa para lançar a ordem.")
    sub = subs[0]
    categoria = (sub.get("categoria") or "").strip() or None
    if categoria and categoria not in CATEGORIAS_DESPESA_VALIDAS:
        raise _erro(422, f"O subitem '{sub['nome']}' tem categoria inválida. Corrija em Configurações.")
    custo_tipo = aprovacao.custo_tipo or sub.get("custo_tipo")
    if aprovacao.custo_tipo:
        classificacao_service.validar(db_admin, aprovacao.custo_tipo)

    descricao = f"OC: {ordem['assunto']} — {ordem['solicitante']}"[:500]
    dados = {
        "descricao":          descricao,
        "subcategoria":       descricao[:100],
        "valor":              str(ordem["valor"]),
        "competencia":        competencia.isoformat(),
        "data_vencimento":    data.isoformat(),
        "centro_custo":       aprovacao.centro_custo,
        "recorrente":         False,
        "tipo_lancamento_id": str(aprovacao.tipo_lancamento_id),
        "criado_por":         ordem.get("criado_por") or usuario.user_id,
        **campos_aprovacao(usuario.user_id),
    }
    if categoria:
        dados["categoria"] = categoria
    if custo_tipo:
        dados["custo_tipo"] = custo_tipo
    if aprovacao.banco_id:
        dados["banco_id"] = str(aprovacao.banco_id)
    if tenant:
        dados["tenant_id"] = tenant
    despesa_id = db_admin.table("despesas").insert(dados).execute().data[0]["id"]
    anexos_service.copiar("ordem_compra", ordem["id"], "despesa", despesa_id, tenant, db_admin)
    return despesa_id


async def aprovar_ordem_compra(
    ordem_id: UUID, usuario: UsuarioAtual, db: Client, aprovacao: OrdemCompraAprovacao | None = None,
) -> OrdemCompraItem:
    db_admin = get_supabase_admin()
    agora = datetime.now(timezone.utc).isoformat()
    ordem = await asyncio.to_thread(_carregar, ordem_id, usuario, db_admin)
    if ordem.get("despesa_id"):
        return _row_para_item(ordem)   # já aprovada e lançada: nada a refazer

    campos = {"status": "aprovada", "aprovado_por": usuario.user_id, "aprovado_em": agora, "atualizado_em": agora}
    tem_0047 = "despesa_id" in ordem
    if tem_0047:
        if aprovacao is None:
            raise _erro(422, "Informe o subitem e o centro de custo para lançar a despesa da ordem.")
        despesa_id = await asyncio.to_thread(_gerar_despesa, ordem, aprovacao, usuario, db_admin, db)
        campos |= {
            "despesa_id": despesa_id,
            "tipo_lancamento_id": str(aprovacao.tipo_lancamento_id),
            "centro_custo": aprovacao.centro_custo,
        }
        # Só grava se ninguém aprovou no meio-tempo; se alguém aprovou, desfaz a
        # despesa recém-criada para não lançar em dobro.
        resp = (db_admin.table("ordens_compra").update(campos)
                .eq("id", str(ordem_id)).is_("despesa_id", "null").execute())
        if not resp.data:
            db_admin.table("despesas").update({"status": "excluida"}).eq("id", despesa_id).execute()
            db_admin.table("anexos").delete().eq("entidade", "despesa").eq("entidade_id", despesa_id).execute()
            return _row_para_item(await asyncio.to_thread(_carregar, ordem_id, usuario, db_admin))
        return _row_para_item(resp.data[0])

    resp = (db.table("ordens_compra").update(campos)
            .eq("id", str(ordem_id)).neq("status", "excluida").execute())
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de compra não encontrada.")
    return _row_para_item(resp.data[0])


async def rejeitar_ordem_compra(
    ordem_id: UUID, motivo: str, usuario: UsuarioAtual, db: Client
) -> OrdemCompraItem:
    atual = await asyncio.to_thread(_carregar, ordem_id, usuario, get_supabase_admin())
    if atual.get("despesa_id"):
        raise _erro(409, "Esta ordem já virou despesa. Para desfazer, exclua a despesa em Lançamentos.")
    resp = (
        db.table("ordens_compra")
        .update({
            "status":           "rejeitada",
            "aprovado_por":     usuario.user_id,
            "rejeitado_motivo": motivo,
            "atualizado_em":    datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", str(ordem_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Ordem de compra não encontrada.")
    return _row_para_item(resp.data[0])


async def deletar_ordem_compra(ordem_id: UUID, db: Client) -> None:
    db.table("ordens_compra").update({"status": "excluida"}).eq("id", str(ordem_id)).execute()


# ── Dashboard: listas dia/mês (mesmo shape de despesas-dia-mes) ─

async def buscar_ordens_dia_mes(inicio: date, fim: date, db: Client):
    from app.models.schemas import LancamentoResumoItem, LancamentosDiaMesResponse
    from app.services.dashboard_service import _janela_hoje_br

    hoje, cri_ini, cri_fim = _janela_hoje_br()
    cols = "id, solicitante, assunto, valor, data_solicitacao, status, criado_em"

    # 3 consultas independentes em paralelo, fora do event loop (ver
    # executar_sem_bloquear em app/database.py).
    resp_hoje, resp_criado_hoje, resp_mes = await asyncio.gather(
        _exec(
            db.table("ordens_compra").select(cols)
            .neq("status", "excluida").eq("data_solicitacao", hoje.isoformat())
        ),
        _exec(
            db.table("ordens_compra").select(cols)
            .neq("status", "excluida")
            .gte("criado_em", cri_ini).lt("criado_em", cri_fim)
            .order("criado_em", desc=True).limit(8)
        ),
        _exec(
            db.table("ordens_compra").select(cols)
            .neq("status", "excluida")
            .gte("data_solicitacao", inicio.isoformat())
            .lte("data_solicitacao", fim.isoformat())
            .order("data_solicitacao", desc=True)
            .limit(8)
        ),
    )

    def _mapear(rows: list[dict]) -> list:
        itens = []
        for row in rows:
            itens.append(LancamentoResumoItem(
                id=row["id"],
                descricao=row.get("assunto", ""),
                tipo_nome=row.get("solicitante"),
                valor=_dec(row.get("valor")),
                data=row.get("data_solicitacao"),
                status=row.get("status"),
            ))
        return itens

    dia = {r["id"]: r for r in (resp_hoje.data or [])}
    for r in (resp_criado_hoje.data or []):
        dia[r["id"]] = r
    return LancamentosDiaMesResponse(dia=_mapear(list(dia.values())), mes=_mapear(resp_mes.data or []))
