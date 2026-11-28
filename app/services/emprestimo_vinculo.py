"""Empréstimo: despesa ↔ receita espelhadas e vinculadas (28/11/2026, Gabriel).

Ao lançar uma despesa (ou receita) de categoria Empréstimo, o usuário pode
marcar "Lançar também como receita" (ou "como despesa"). O sistema cria o outro
lado com as mesmas informações e grava o MESMO UUID em `vinculo_emprestimo`
nas duas linhas (migration 0053).

Sincronizados: editar valor, descrição, competência ou vencimento de um lado
atualiza o outro. Banco, centro, categoria e data de pagamento/recebimento são
de cada lado. Excluir pergunta se exclui os dois.

O código tolera a coluna ausente (migration ainda não rodada): ler o vínculo
devolve "sem vínculo"; só CRIAR um espelho exige a coluna.
"""
from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException, status
from supabase import Client

from app.auth import UsuarioAtual
from app.logging_config import get_logger
from app.models.schemas import DespesaCreate, EspelhoEmprestimo, ReceitaOutraCreate

logger = get_logger(__name__)

OUTRA = {"despesas": "receitas_outras", "receitas_outras": "despesas"}
# Campos que acompanham o vínculo (nome na despesa → nome na receita é igual).
SINCRONIZADOS = ("valor", "descricao", "competencia", "data_vencimento")


def _sem_migration(e: Exception) -> bool:
    return "vinculo_emprestimo" in str(e)


async def criar_espelho(
    tabela: str, item, espelho: EspelhoEmprestimo, usuario: UsuarioAtual, db: Client, db_admin: Client,
):
    """Cria o lado espelho de `item` (recém-criado em `tabela`) e vincula os dois.
    Se algo falhar, desfaz o que foi criado — nunca fica um lado só."""
    from app.services import financeiro_service as fs

    outro = OUTRA[tabela]
    pago = getattr(item, "paga_em", None) if tabela == "despesas" else getattr(item, "recebido_em", None)
    centro = espelho.centro_custo or item.centro_custo
    banco = espelho.banco_id or item.banco_id
    criado = None
    try:
        if outro == "receitas_outras":
            criado = await fs.criar_receita_outra(ReceitaOutraCreate(
                tipo_lancamento_id=espelho.tipo_lancamento_id, banco_id=banco, centro_custo=centro,
                descricao=item.descricao, valor=item.valor, competencia=item.competencia,
                data_vencimento=item.data_vencimento, recebido_em=pago,
            ), usuario, db)
        else:
            criado = await fs.criar_despesa(DespesaCreate(
                tipo_lancamento_id=espelho.tipo_lancamento_id, banco_id=banco, centro_custo=centro,
                descricao=item.descricao, subcategoria=item.descricao[:100], valor=item.valor,
                competencia=item.competencia, data_vencimento=item.data_vencimento or item.competencia,
                paga_em=pago,
            ), usuario, db)
        vinculo = str(uuid4())
        for t, i in ((tabela, item.id), (outro, criado.id)):
            db_admin.table(t).update({"vinculo_emprestimo": vinculo}).eq("id", str(i)).execute()
    except Exception as e:
        _desfazer(db_admin, tabela, item.id)
        if criado is not None:
            _desfazer(db_admin, outro, criado.id)
        if isinstance(e, HTTPException):
            raise HTTPException(e.status_code, f"Não foi possível criar o lançamento espelho: {e.detail}") from e
        if _sem_migration(e):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Vínculo de empréstimo indisponível: falta rodar a migration 0053 no Supabase.",
            ) from e
        raise
    return criado


def _desfazer(db_admin: Client, tabela: str, item_id) -> None:
    try:
        db_admin.table(tabela).delete().eq("id", str(item_id)).execute()
    except Exception as e:  # noqa: BLE001
        logger.error("emprestimo_desfazer_%s_erro: %s", tabela, e)


def _linha(db: Client, tabela: str, item_id) -> dict | None:
    try:
        resp = (db.table(tabela).select("id, vinculo_emprestimo, tenant_id")
                .eq("id", str(item_id)).neq("status", "excluida").execute())
    except Exception as e:  # noqa: BLE001 — coluna ausente: sem vínculo
        if not _sem_migration(e):
            logger.warning("emprestimo_ler_%s_erro: %s", tabela, e)
        return None
    return (resp.data or [None])[0]


def vinculado(db: Client, tabela: str, item_id) -> dict | None:
    """O lançamento do outro lado, ou None."""
    linha = _linha(db, tabela, item_id)
    if not linha or not linha.get("vinculo_emprestimo"):
        return None
    outro = OUTRA[tabela]
    col_pago = "paga_em" if outro == "despesas" else "recebido_em"
    try:
        resp = (db.table(outro)
                .select(f"id, descricao, valor, competencia, data_vencimento, {col_pago}, centro_custo, status")
                .eq("vinculo_emprestimo", linha["vinculo_emprestimo"]).neq("status", "excluida")
                .execute())
    except Exception as e:  # noqa: BLE001
        logger.warning("emprestimo_vinculado_%s_erro: %s", outro, e)
        return None
    r = (resp.data or [None])[0]
    if not r:
        return None
    return {
        "tabela": outro,
        "tipo": "despesa" if outro == "despesas" else "receita",
        "id": r["id"],
        "descricao": r.get("descricao"),
        "valor": r.get("valor"),
        "competencia": r.get("competencia"),
        "data_vencimento": r.get("data_vencimento"),
        "pago_em": r.get(col_pago),
        "centro_custo": r.get("centro_custo"),
    }


def propagar(db_admin: Client, tabela: str, item_id, mudancas: dict, tenant_id: str | None) -> bool:
    """Leva ao lado vinculado os campos sincronizados que vieram na edição.
    Devolve True se atualizou o outro lado."""
    dados = {k: v for k, v in mudancas.items() if k in SINCRONIZADOS and v is not None}
    if not dados:
        return False
    alvo = vinculado(db_admin, tabela, item_id)
    if not alvo:
        return False
    from app.services import financeiro_service as fs

    dados = {k: (v.isoformat() if hasattr(v, "isoformat") else str(v) if k == "valor" else v) for k, v in dados.items()}
    if alvo["tabela"] == "despesas":
        if "descricao" in dados:
            dados["subcategoria"] = dados["descricao"][:100]
        # Pagamento por arquivo em andamento trava valor da despesa (CNAB, 0050).
        fs.garantir_sem_pagamento_no_banco(db_admin, alvo["id"], "editar", dados)
    q = db_admin.table(alvo["tabela"]).update(dados).eq("id", alvo["id"])
    if tenant_id:
        q = q.eq("tenant_id", tenant_id)
    q.execute()
    return True


def desvincular_ou_excluir(
    db_admin: Client, tabela: str, item_id, com_vinculado: bool, usuario: UsuarioAtual,
) -> dict | None:
    """Antes de excluir `item_id`: com `com_vinculado`, devolve o outro lado para
    ser excluído também (permissão checada pelo chamador); sem, solta o vínculo
    do outro lado para ele seguir sozinho."""
    alvo = vinculado(db_admin, tabela, item_id)
    if not alvo:
        return None
    if com_vinculado:
        return alvo
    try:
        q = db_admin.table(alvo["tabela"]).update({"vinculo_emprestimo": None}).eq("id", alvo["id"])
        if getattr(usuario, "tenant_id", None):
            q = q.eq("tenant_id", usuario.tenant_id)
        q.execute()
    except Exception as e:  # noqa: BLE001
        logger.warning("emprestimo_desvincular_erro: %s", e)
    return None
