"""
MX Seguros — DRE-IA | Sugestão de classificação em lote para importação de extrato.

Preenche o subitem de cada linha do extrato ANTES de o usuário confirmar,
em duas camadas, da mais barata à mais cara:

1. HISTÓRICO — descrição idêntica (normalizada) a um lançamento já
   classificado reusa o subitem dele. Extratos são dominados por
   recorrência (mesmo fornecedor todo mês), então esta camada resolve a
   maioria das linhas com custo zero e acerto por definição: repete o que
   um humano já decidiu.
2. IA EM LOTE — só o resíduo, em UMA chamada para o extrato inteiro,
   ancorada na taxonomia real do tenant com forced tool-use (o modelo
   escolhe entre ids existentes — nunca inventa subitem). O endpoint
   unitário /lancamentos/sugestao tem limite de 20/min, o que inviabiliza
   chamar por linha; daí a variante em lote.

NÃO existe camada de regras determinísticas (etl/categorizacao.py) aqui de
propósito: verificado em 28/08/2026 que o vocabulário daquelas regras
("salario", "plano_saude") não existe na taxonomia deste tenant ("Folha -
Salários + Vale Transp. + Sindicato + Guia Gps") — um de-para na mão
erraria mais do que ajudaria, e a IA já enxerga o catálogo real.

Princípio herdado do copiloto: a IA SUGERE, o humano CONFIRMA. Este
serviço não grava nada — a tela de revisão continua mandando só o que o
usuário aprovou.
"""
from __future__ import annotations

import asyncio
import logging

import anthropic
from pydantic import BaseModel, Field
from supabase import Client

from app.auth import UsuarioAtual
from app.config import cfg
from app.database import executar_sem_bloquear as _exec
from app.services.copiloto_service import MODELO
from app.services.financeiro_service import _sem_acento

logger = logging.getLogger(__name__)

# Extrato mensal típico tem ~80 linhas; o teto protege o prompt e o custo.
MAX_ITENS_LOTE = 200
_MAX_HISTORICO = 1000


class ItemSugestao(BaseModel):
    id: int
    descricao: str
    tipo: str  # 'despesa' | 'receita'


class SugestaoLoteRequest(BaseModel):
    itens: list[ItemSugestao] = Field(max_length=MAX_ITENS_LOTE)


def _chave(descricao: str) -> str:
    return _sem_acento((descricao or "").strip().lower())[:200]


_TOOL_LOTE = {
    "name": "registrar_sugestoes",
    "description": "Registra a classificação sugerida para cada item do extrato.",
    "input_schema": {
        "type": "object",
        "properties": {
            "sugestoes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "item_id": {"type": "integer"},
                        "subitem_id": {
                            "type": "string",
                            "description": (
                                "id EXATO de um subitem do catálogo da mesma natureza "
                                "do item. String vazia se nenhum servir."
                            ),
                        },
                        "confianca": {"type": "string", "enum": ["alta", "media", "baixa"]},
                    },
                    "required": ["item_id", "subitem_id", "confianca"],
                },
            },
        },
        "required": ["sugestoes"],
    },
}


async def sugerir_lote(payload: SugestaoLoteRequest, usuario: UsuarioAtual, db: Client) -> dict:
    itens = [i for i in payload.itens if len((i.descricao or "").strip()) >= 3]
    if not itens:
        return {"sugestoes": {}}

    # ── catálogo + histórico em paralelo ──────────────────────
    resp_sub, resp_desp, resp_rec = await asyncio.gather(
        _exec(
            db.table("subitens_lancamento")
            .select("id, nome, natureza, custo_tipo, categorias_lancamento(nome)")
            .eq("ativo", True)
        ),
        # Só linhas que um humano já classificou servem de precedente. Ordena
        # desc para que o limit corte as antigas, e o setdefault abaixo faz a
        # primeira vista (= mais recente) vencer.
        _exec(
            db.table("despesas")
            .select("descricao, tipo_lancamento_id")
            .not_.is_("tipo_lancamento_id", "null")
            .neq("status", "excluida")
            .order("atualizado_em", desc=True)
            .limit(_MAX_HISTORICO)
        ),
        _exec(
            db.table("receitas_outras")
            .select("descricao, tipo_lancamento_id")
            .not_.is_("tipo_lancamento_id", "null")
            .order("atualizado_em", desc=True)
            .limit(_MAX_HISTORICO)
        ),
    )
    subitens = {s["id"]: s for s in (resp_sub.data or [])}

    historico: dict[tuple[str, str], str] = {}
    for natureza, resp in (("despesa", resp_desp), ("receita", resp_rec)):
        for r in (resp.data or []):
            sid = r.get("tipo_lancamento_id")
            if sid in subitens:
                historico.setdefault((natureza, _chave(r.get("descricao", ""))), sid)

    def _montar(item: ItemSugestao, sid: str, fonte: str, confianca: str | None) -> dict:
        s = subitens[sid]
        return {
            "subitem_id": sid,
            "subitem_nome": s["nome"],
            "categoria_nome": (s.get("categorias_lancamento") or {}).get("nome"),
            "classificacao": s.get("custo_tipo"),
            "fonte": fonte,
            "confianca": confianca,
        }

    sugestoes: dict[int, dict] = {}
    residuo: list[ItemSugestao] = []
    for item in itens:
        sid = historico.get((item.tipo, _chave(item.descricao)))
        if sid:
            sugestoes[item.id] = _montar(item, sid, "historico", "alta")
        else:
            residuo.append(item)

    # ── IA em lote só para o resíduo ──────────────────────────
    if residuo and cfg.anthropic_api_key:
        try:
            resultado = await asyncio.to_thread(_classificar_com_ia, residuo, subitens)
            for item_id, (sid, confianca) in resultado.items():
                item = next((i for i in residuo if i.id == item_id), None)
                # Valida id e natureza: o modelo não pode apontar subitem de
                # receita para uma despesa, nem inventar id.
                if item and sid in subitens and subitens[sid]["natureza"] == item.tipo:
                    sugestoes[item.id] = _montar(item, sid, "ia", confianca)
        except Exception as e:  # noqa: BLE001 — sugestão é acessória; a importação segue sem ela
            logger.error("sugestao_lote_ia_erro: %s", e)

    return {
        "sugestoes": sugestoes,
        "total_historico": sum(1 for s in sugestoes.values() if s["fonte"] == "historico"),
        "total_ia": sum(1 for s in sugestoes.values() if s["fonte"] == "ia"),
        "sem_sugestao": len(itens) - len(sugestoes),
    }


def _classificar_com_ia(
    residuo: list[ItemSugestao], subitens: dict[str, dict]
) -> dict[int, tuple[str, str]]:
    """Uma chamada para o lote inteiro. Roda em thread (client síncrono)."""
    def catalogo(natureza: str) -> str:
        return "\n".join(
            f'- id={s["id"]} | {(s.get("categorias_lancamento") or {}).get("nome", "?")} › {s["nome"]}'
            for s in subitens.values() if s["natureza"] == natureza
        ) or "(vazio)"

    linhas = "\n".join(
        f'- item_id={i.id} | natureza={i.tipo} | "{i.descricao.strip()[:200]}"'
        for i in residuo
    )
    prompt = (
        "Classifique cada linha de extrato bancário abaixo no subitem mais adequado, "
        "usando APENAS o catálogo da MESMA natureza da linha (retorne o id exato). "
        "Se nenhum servir bem, retorne subitem_id vazio para aquela linha. "
        "Responda para TODAS as linhas.\n\n"
        f"LINHAS DO EXTRATO:\n{linhas}\n\n"
        f"CATÁLOGO DESPESAS:\n{catalogo('despesa')}\n\n"
        f"CATÁLOGO RECEITAS:\n{catalogo('receita')}"
    )
    cliente = anthropic.Anthropic(api_key=cfg.anthropic_api_key)
    msg = cliente.messages.create(
        model=MODELO,
        max_tokens=8192,
        tools=[_TOOL_LOTE],
        tool_choice={"type": "tool", "name": "registrar_sugestoes"},
        messages=[{"role": "user", "content": prompt}],
    )
    dados = next((b.input for b in msg.content if b.type == "tool_use"), {}) or {}
    saida: dict[int, tuple[str, str]] = {}
    for s in dados.get("sugestoes", []):
        sid = (s.get("subitem_id") or "").strip()
        if sid:
            saida[s.get("item_id")] = (sid, s.get("confianca", "media"))
    return saida
