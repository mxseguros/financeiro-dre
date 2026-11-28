"""
MX Seguros — DRE-IA | Importador de extrato bancário (preview → confirmar).

Fluxo:
1. POST /importacao/extrato  → upload → detecta banco/formato, normaliza,
   marca direção (crédito→receita / débito→despesa) e sinaliza DUPLICATAS.
2. POST /importacao/extrato/confirmar → grava em lote só os itens que o
   usuário revisou/aprovou (com a direção que ele confirmou).

A IA sugere a direção; o humano confirma item a item na tela.

28/11/2026 (Gabriel):
- Centro de custo por linha, com sugestão pelo histórico (mesma descrição →
  centro do lançamento mais recente). Sem IA.
- De x Para de duplicidade: mesmo VALOR + mesmo LADO (despesa/receita) + mesmo
  MÊS, qualquer descrição — contra o sistema (`similares_sistema`) e dentro do
  próprio arquivo (`grupo_arquivo`). Na conferência o usuário escolhe manter o
  do sistema, importar e excluir o do sistema (`substituir`) ou manter os dois.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from typing import Literal

from fastapi import HTTPException, status
from pydantic import BaseModel
from supabase import Client

from app.auth import UsuarioAtual
from app.logging_config import get_logger
from app.regras_lancamento import garantir_exclusao_propria, pode_excluir_qualquer
from app.services.financeiro_service import (
    _ler_centros, aprovacao_por_pagamento, campos_aprovacao, garantir_sem_pagamento_no_banco,
    validar_centro_lancamento,
)
from app.services.sugestao_extrato_service import _chave

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from etl.extrato_parser import parsear  # noqa: E402

logger = get_logger(__name__)


class Substituir(BaseModel):
    """Lançamento do sistema que a linha do extrato substitui (é excluído)."""
    tabela: Literal["despesas", "receitas_outras"]
    id: str


class ExtratoItemConfirm(BaseModel):
    data: str                       # YYYY-MM-DD
    descricao: str
    valor: float                    # valor absoluto (positivo)
    tipo: str                       # 'despesa' | 'receita'
    tipo_lancamento_id: str | None = None
    centro_custo: str | None = None  # vazio: o do cabeçalho
    substituir: Substituir | None = None


class ConfirmarExtratoRequest(BaseModel):
    banco_id: str | None = None
    centro_custo: str | None = None   # padrão das linhas sem centro próprio
    itens: list[ExtratoItemConfirm]


# ── Preview ────────────────────────────────────────────────────

_MAX_HISTORICO = 1000


def _cents(valor) -> int:
    return int(round(abs(float(valor or 0)) * 100))


def gerar_preview(conteudo: bytes, filename: str, usuario: UsuarioAtual, db: Client) -> dict:
    parse = parsear(conteudo, filename)

    reais = [t for t in parse.transacoes if not t.ignorar]
    ignorados = [t for t in parse.transacoes if t.ignorar]

    # Lançamentos do sistema nos meses do extrato, por (lado, valor, mês).
    existentes = _lancamentos_existentes(reais, usuario, db)
    centros_hist = _centros_por_historico(db, getattr(usuario, "tenant_id", None))

    itens = []
    for idx, t in enumerate(reais):
        valor_abs = abs(t.valor)
        tipo = "receita" if t.valor >= 0 else "despesa"
        chave = (tipo, _cents(valor_abs), (t.data or "")[:7])
        similares = existentes.get(chave, [])
        centro = centros_hist.get((tipo, _chave(t.descricao)))
        itens.append({
            "id": idx,
            "data": t.data,
            "descricao": t.descricao,
            "valor": round(valor_abs, 2),
            "tipo": tipo,
            "documento": t.documento,
            "duplicata": bool(similares),
            "similares_sistema": similares,
            "grupo_arquivo": None,
            "centro_sugerido": centro,
            "fonte_centro": "historico" if centro else None,
        })

    # Mesmo valor + lado + mês dentro do próprio arquivo.
    grupos: dict[tuple, list[dict]] = {}
    for it in itens:
        grupos.setdefault((it["tipo"], _cents(it["valor"]), (it["data"] or "")[:7]), []).append(it)
    n_grupos = 0
    for membros in grupos.values():
        if len(membros) > 1:
            n_grupos += 1
            for it in membros:
                it["grupo_arquivo"] = f"g{n_grupos}"

    resumo = {
        "total": len(itens),
        "despesas": sum(1 for i in itens if i["tipo"] == "despesa"),
        "receitas": sum(1 for i in itens if i["tipo"] == "receita"),
        "duplicatas": sum(1 for i in itens if i["duplicata"]),
        "grupos_arquivo": n_grupos,
        "ignorados": len(ignorados),
    }
    return {
        "banco": parse.banco,
        "banco_confirmado": parse.banco_confirmado,
        "formato": parse.formato,
        "conta": parse.conta,
        "avisos": parse.avisos,
        "resumo": resumo,
        "itens": itens,
    }


def _intervalo(transacoes) -> tuple[str, str] | None:
    meses = sorted({(t.data or "")[:7] for t in transacoes if t.data})
    if not meses:
        return None
    ini = f"{meses[0]}-01"
    # fim = primeiro dia do mês seguinte ao último
    y, m = int(meses[-1][:4]), int(meses[-1][5:7])
    fim = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
    return ini, fim


def _ddmm(d) -> str:
    d = str(d or "")[:10]
    return f"{d[8:10]}/{d[5:7]}" if len(d) == 10 else ""


def _lancamentos_existentes(transacoes, usuario: UsuarioAtual, db: Client) -> dict[tuple, list[dict]]:
    """Lançamentos do sistema nos meses do extrato, indexados por (lado, valor
    em centavos, mês de competência). Cada um já diz se o usuário pode excluí-lo
    (para a opção "Importar e excluir o do sistema")."""
    intervalo = _intervalo(transacoes)
    if not intervalo:
        return {}
    ini, fim = intervalo
    so_proprios = usuario.role in ("comercial", "contador")
    exclui_qualquer = pode_excluir_qualquer(usuario)

    saida: dict[tuple, list[dict]] = {}
    for tabela, lado, col_pago in (("despesas", "despesa", "paga_em"), ("receitas_outras", "receita", "recebido_em")):
        try:
            q = (
                db.table(tabela)
                .select(f"id, descricao, valor, competencia, data_vencimento, {col_pago}, status, "
                        "centro_custo, criado_por, bancos(nome)")
                .gte("competencia", ini).lt("competencia", fim)
                .neq("status", "excluida")
            )
            if so_proprios and tabela == "despesas":
                q = q.eq("criado_por", usuario.user_id)
            for r in (q.execute().data or []):
                pago = r.get(col_pago)
                if pago:
                    situacao = f"{'Paga' if lado == 'despesa' else 'Recebida'} {_ddmm(pago)}"
                elif r.get("status") == "pendente" and lado == "despesa":
                    situacao = "Aguardando aprovação"
                else:
                    situacao = "A pagar" if lado == "despesa" else "A receber"
                if lado == "receita":
                    pode = True   # receita manual: quem lê exclui (regra do DELETE /receitas)
                else:
                    pode = exclui_qualquer or (
                        r.get("criado_por") == usuario.user_id and r.get("status") != "aprovada")
                saida.setdefault((lado, _cents(r.get("valor")), (r.get("competencia") or "")[:7]), []).append({
                    "id": r["id"],
                    "tabela": tabela,
                    "descricao": r.get("descricao") or "",
                    "valor": round(abs(float(r.get("valor") or 0)), 2),
                    "data": str(pago or r.get("data_vencimento") or r.get("competencia") or "")[:10],
                    "situacao": situacao,
                    "centro_custo": r.get("centro_custo"),
                    "banco": (r.get("bancos") or {}).get("nome"),
                    "pode_excluir": pode,
                })
        except Exception as e:  # noqa: BLE001
            logger.warning("dedup_extrato_%s_erro: %s", tabela, e)
    return saida


def _centros_por_historico(db: Client, tenant_id: str | None) -> dict[tuple[str, str], str]:
    """(lado, descrição normalizada) → centro do lançamento mais recente com a
    mesma descrição. Só centros ativos que aceitam lançamento (sem subgrupos)."""
    try:
        centros = _ler_centros(db, tenant_id)
    except Exception as e:  # noqa: BLE001
        logger.warning("centros_extrato_erro: %s", e)
        return {}
    com_filhos = {c.get("parent_id") for c in centros if c.get("parent_id")}
    validos = {c["codigo"] for c in centros if c.get("ativo", True) and c.get("id") not in com_filhos}
    saida: dict[tuple[str, str], str] = {}
    for tabela, lado in (("despesas", "despesa"), ("receitas_outras", "receita")):
        try:
            resp = (
                db.table(tabela).select("descricao, centro_custo")
                .neq("status", "excluida")
                .order("atualizado_em", desc=True)
                .limit(_MAX_HISTORICO)
                .execute()
            )
            for r in (resp.data or []):
                cc = r.get("centro_custo")
                if cc in validos:
                    saida.setdefault((lado, _chave(r.get("descricao") or "")), cc)
        except Exception as e:  # noqa: BLE001
            logger.warning("historico_centro_%s_erro: %s", tabela, e)
    return saida


# ── Confirmar ──────────────────────────────────────────────────

async def confirmar(payload: ConfirmarExtratoRequest, usuario: UsuarioAtual, db_admin: Client) -> dict:
    despesas: list[dict] = []
    receitas: list[dict] = []
    erros: list[str] = []

    # Sem tenant_id a linha fica órfã: as policies de UPDATE começam com
    # _tenant_ok(tenant_id), e _tenant_ok(NULL) é falso — o lançamento nasce
    # imutável para TODOS os papéis, inclusive admin. Foi o que deixou 80 de 91
    # despesas ineditáveis até a migration 0032. Como aqui se usa service_role
    # (que ignora a RLS na escrita), o insert passa e o problema só aparece na
    # primeira tentativa de edição.
    tenant_id = getattr(usuario, "tenant_id", None)
    if any(not (it.centro_custo or payload.centro_custo) for it in payload.itens):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Escolha o centro de custo de todas as linhas.")
    for cc in {payload.centro_custo} | {it.centro_custo for it in payload.itens}:
        if cc:
            validar_centro_lancamento(db_admin, cc, tenant_id=tenant_id)

    # Substituições (De x Para): checa TODAS antes de gravar qualquer coisa.
    substituir = [it.substituir for it in payload.itens if it.substituir]
    if len({(s.tabela, s.id) for s in substituir}) != len(substituir):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "O mesmo lançamento foi escolhido para ser substituído duas vezes.")
    for sub in substituir:
        # service_role ignora a RLS: o lançamento tem de existir no tenant de quem importa.
        q = db_admin.table(sub.tabela).select("id").eq("id", sub.id).neq("status", "excluida")
        if tenant_id:
            q = q.eq("tenant_id", tenant_id)
        if not (q.execute().data or []):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Lançamento a substituir não encontrado.")
        if sub.tabela == "despesas":
            if not pode_excluir_qualquer(usuario):
                garantir_exclusao_propria("despesas", sub.id, usuario, db_admin)
            garantir_sem_pagamento_no_banco(db_admin, sub.id, "excluir")

    for it in payload.itens:
        try:
            data = (it.data or date.today().isoformat())[:10]
            competencia = data[:7] + "-01"
            valor = str(round(abs(float(it.valor)), 2))
            if it.tipo == "despesa":
                despesas.append({
                    "descricao":          it.descricao[:500],
                    "subcategoria":       it.descricao[:500],
                    "valor":              valor,
                    "competencia":        competencia,
                    "data_vencimento":    data,
                    "paga_em":            data,
                    "centro_custo":       it.centro_custo or payload.centro_custo,
                    "banco_id":           payload.banco_id,
                    "tipo_lancamento_id": it.tipo_lancamento_id,
                    "criado_por":         usuario.user_id,
                    "tenant_id":          tenant_id,
                    # Linha de extrato é pagamento consumado: tem paga_em, então
                    # nasce aprovada (regra de 19/10/2026 — Data de Pagamento
                    # aprova, qualquer perfil). Antes nascia "pendente" de
                    # propósito; a decisão foi revista pelo Gabriel.
                    **aprovacao_por_pagamento(usuario.user_id),
                })
            else:
                receitas.append({
                    "descricao":          it.descricao[:500],
                    "valor":              valor,
                    "competencia":        competencia,
                    "centro_custo":       it.centro_custo or payload.centro_custo,
                    "banco_id":           payload.banco_id,
                    "recebido_em":        data,
                    "tipo_lancamento_id": it.tipo_lancamento_id,
                    "tenant_id":          tenant_id,
                    # Receita não passa por aprovação (22/10/2026).
                    **campos_aprovacao(usuario.user_id),
                })
        except Exception as e:  # noqa: BLE001
            erros.append(f"{it.descricao[:40]}: {e}")

    if despesas:
        db_admin.table("despesas").insert(despesas).execute()
    if receitas:
        db_admin.table("receitas_outras").insert(receitas).execute()

    # Exclui os substituídos só depois de gravar as linhas novas: se o insert
    # falhar, nada some do sistema. Mesmo caminho do DELETE de Lançamentos.
    from app.services.financeiro_service import deletar_despesa, deletar_receita_outra
    substituidos = 0
    for sub in substituir:
        try:
            if sub.tabela == "despesas":
                await deletar_despesa(sub.id, db_admin, preservar_aprovadas=not pode_excluir_qualquer(usuario))
            else:
                await deletar_receita_outra(sub.id, db_admin)
            substituidos += 1
        except HTTPException as e:
            erros.append(f"Não foi possível excluir o lançamento substituído: {e.detail}")
        except Exception as e:  # noqa: BLE001
            erros.append(f"Não foi possível excluir o lançamento substituído: {e}")

    return {
        "total_importado": len(despesas) + len(receitas),
        "despesas": len(despesas),
        "receitas": len(receitas),
        "substituidos": substituidos,
        "erros": erros,
    }
