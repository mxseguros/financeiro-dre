"""
MX Seguros — DRE-IA | DRE Previsto x Realizado: busca de dados + orçamento.

Só E/S: lê lançamentos, taxonomia e orçamento e entrega ao motor puro
(app/services/dre_calculo.py), onde vivem todas as regras de cálculo.

Decisões (Gabriel, 29/09/2026 — ver migration 0036):
- Plano de contas = taxonomia existente. Grupo DRE de uma conta = dre_grupo
  do subitem, ou, na falta, o da categoria dele.
- Regime de COMPETÊNCIA (mesma data do filtro De/Até de Lançamentos).
  `regime` fica como parâmetro para o caixa entrar depois (plano §3.3).
- Realizado = lançamentos PENDENTES + APROVADOS (fora rejeitados e excluídos);
  a resposta informa quanto ainda aguarda aprovação.
- Tabelas sem subitem entram pela conta marcada com dre_papel, repetindo a
  semântica do DRE antigo (dre_por_periodo): comissões (−estornos) na receita
  de vendas, impostos e repasses a produtores nas despesas variáveis.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from supabase import Client

from app.auth import UsuarioAtual
from app.database import executar_sem_bloquear as _exec
from app.services import dre_calculo

logger = logging.getLogger(__name__)

_PAGINA = 1000
_STATUS_REALIZADO = ["pendente", "aprovada"]


class ItemOrcamento(BaseModel):
    subitem_id: UUID
    mes: int = Field(ge=1, le=12)
    valor: float = Field(ge=-99_999_999_999, le=99_999_999_999)


class SalvarOrcamentoRequest(BaseModel):
    ano: int = Field(ge=2000, le=2100)
    itens: list[ItemOrcamento] = Field(max_length=5000)

    @field_validator("itens")
    @classmethod
    def sem_duplicados(cls, v: list[ItemOrcamento]) -> list[ItemOrcamento]:
        chaves = {(i.subitem_id, i.mes) for i in v}
        if len(chaves) != len(v):
            raise ValueError("Há células repetidas (mesma conta e mês) no lote.")
        return v


async def _todos(montar, opcional: str | None = None) -> list[dict]:
    """Pagina o PostgREST (limite de 1000 linhas por resposta).

    `opcional`: tabela que pode não existir ou não ser legível pelo perfil
    (estornos, repasses, impostos) — erro vira lista vazia, com log.
    """
    out: list[dict] = []
    ini = 0
    try:
        while True:
            lote = (await _exec(montar().range(ini, ini + _PAGINA - 1))).data or []
            out.extend(lote)
            if len(lote) < _PAGINA:
                return out
            ini += _PAGINA
    except Exception as e:  # noqa: BLE001
        if opcional:
            logger.warning("dre_tabela_indisponivel %s: %s", opcional, e)
            return []
        raise


def _meses_da_visao(mes: int, visao: str) -> set[int]:
    if visao == "mes":
        return {mes}
    if visao == "acumulado":
        return set(range(1, mes + 1))
    return set(range(1, 13))


async def _contas(db: Client) -> list[dict]:
    rows = await _todos(lambda: db.table("subitens_lancamento").select(
        "id, nome, natureza, ativo, dre_grupo, dre_papel, categorias_lancamento(dre_grupo)"))
    contas = []
    for s in rows:
        grupo = s.get("dre_grupo") or (s.get("categorias_lancamento") or {}).get("dre_grupo")
        contas.append({"id": s["id"], "nome": s["nome"], "grupo": grupo, "ativo": s.get("ativo", True),
                       "papel": s.get("dre_papel"), "natureza": s.get("natureza")})
    return contas


async def buscar_previsto_realizado(ano: int, mes: int, visao: str, db: Client, regime: str = "competencia") -> dict:
    if regime != "competencia":
        raise HTTPException(status_code=422, detail="Nesta versão a DRE usa regime de competência.")
    ini, fim = f"{ano}-01-01", f"{ano}-12-31"

    (contas, despesas, receitas, comissoes, estornos, repasses, impostos, orcamento) = await asyncio.gather(
        _contas(db),
        _todos(lambda: db.table("despesas").select("tipo_lancamento_id, valor, competencia, status")
               .gte("competencia", ini).lte("competencia", fim).in_("status", _STATUS_REALIZADO)),
        # receitas antigas (pré-0032) podem ter status nulo: contam como realizadas
        _todos(lambda: db.table("receitas_outras").select("tipo_lancamento_id, valor, competencia, status")
               .gte("competencia", ini).lte("competencia", fim)
               .or_("status.in.(pendente,aprovada),status.is.null")),
        _todos(lambda: db.table("comissoes").select("valor, competencia")
               .gte("competencia", ini).lte("competencia", fim), opcional="comissoes"),
        _todos(lambda: db.table("estornos").select("valor, competencia_estorno")
               .gte("competencia_estorno", ini).lte("competencia_estorno", fim), opcional="estornos"),
        _todos(lambda: db.table("repasses").select("valor, competencia, status")
               .gte("competencia", ini).lte("competencia", fim).neq("status", "estornado"), opcional="repasses"),
        _todos(lambda: db.table("impostos").select("valor, competencia")
               .gte("competencia", ini).lte("competencia", fim), opcional="impostos"),
        _todos(lambda: db.table("dre_orcamento").select("subitem_id, mes, valor").eq("ano", ano),
               opcional="dre_orcamento"),
    )

    no_grupo = {c["id"] for c in contas if c["grupo"] in dre_calculo.GRUPOS}
    por_papel = {c["papel"]: c["id"] for c in contas if c.get("papel")}
    meses_visao = _meses_da_visao(mes, visao)

    real: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    meses_com_real: set[int] = set()
    nao_classificado = {"qtd": 0, "valor": 0.0}
    pendentes = {"qtd": 0, "valor": 0.0}

    def lancar(conta_id: str | None, competencia: str, valor, status: str | None = None) -> None:
        m = int(str(competencia)[5:7])
        v = float(valor or 0)
        meses_com_real.add(m)
        na_visao = m in meses_visao
        if status == "pendente" and na_visao:
            pendentes["qtd"] += 1
            pendentes["valor"] += abs(v)
        if conta_id not in no_grupo:
            if na_visao:
                nao_classificado["qtd"] += 1
                nao_classificado["valor"] += abs(v)
            return
        real[conta_id][m] += v

    for r in despesas:
        lancar(r.get("tipo_lancamento_id"), r["competencia"], r["valor"], r.get("status"))
    for r in receitas:
        lancar(r.get("tipo_lancamento_id"), r["competencia"], r["valor"], r.get("status"))
    for r in comissoes:
        lancar(por_papel.get("comissoes"), r["competencia"], r["valor"])
    for r in estornos:  # estorno reduz a receita de comissões
        lancar(por_papel.get("comissoes"), r["competencia_estorno"], -float(r["valor"] or 0))
    for r in repasses:
        lancar(por_papel.get("repasses"), r["competencia"], r["valor"])
    for r in impostos:
        lancar(por_papel.get("impostos"), r["competencia"], r["valor"])

    prev: dict[str, dict[int, float]] = defaultdict(dict)
    for o in orcamento:
        prev[o["subitem_id"]][int(o["mes"])] = float(o["valor"] or 0)

    dre = dre_calculo.montar(contas, real, prev, meses_com_real, mes_ref=mes, visao=visao)
    dre.update({
        "ano": ano,
        "mes": mes,
        "regime": regime,
        "nao_classificado": {"qtd": nao_classificado["qtd"], "valor": round(nao_classificado["valor"], 2)},
        "pendentes": {"qtd": pendentes["qtd"], "valor": round(pendentes["valor"], 2)},
    })
    return dre


async def buscar_orcamento(ano: int, db: Client) -> dict:
    contas, orcamento = await asyncio.gather(
        _contas(db),
        _todos(lambda: db.table("dre_orcamento").select("subitem_id, mes, valor").eq("ano", ano)),
    )
    valores: dict[str, dict[int, float]] = defaultdict(dict)
    for o in orcamento:
        valores[o["subitem_id"]][int(o["mes"])] = float(o["valor"] or 0)

    grupos = []
    for cod, (nome, natureza) in dre_calculo.GRUPOS.items():
        cs = sorted((c for c in contas if c["grupo"] == cod
                     # conta inativa só aparece se já tiver meta cadastrada
                     and (c["ativo"] or c["id"] in valores)),
                    key=lambda c: c["nome"].lower())
        grupos.append({"codigo": cod, "nome": nome, "natureza": natureza,
                       "contas": [{"id": c["id"], "nome": c["nome"].strip(), "ativo": c["ativo"]} for c in cs]})
    return {"ano": ano, "grupos": grupos, "valores": valores}


async def salvar_orcamento(payload: SalvarOrcamentoRequest, usuario: UsuarioAtual, db: Client) -> dict:
    tenant_id = getattr(usuario, "tenant_id", None)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="Usuário sem empresa vinculada — não é possível salvar metas.")
    if not payload.itens:
        return {"salvos": 0}
    agora = datetime.now(timezone.utc).isoformat()
    linhas = [{
        "tenant_id": tenant_id, "subitem_id": str(i.subitem_id), "ano": payload.ano, "mes": i.mes,
        "valor": round(i.valor, 2), "updated_by": usuario.user_id, "updated_at": agora,
    } for i in payload.itens]
    # Com cliente do usuário: a RLS garante que só admin/gestor gravam.
    resp = await _exec(db.table("dre_orcamento").upsert(linhas, on_conflict="tenant_id,subitem_id,ano,mes"))
    return {"salvos": len(resp.data or [])}
