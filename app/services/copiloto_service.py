"""
MX Seguros — DRE-IA | Copiloto de apontamento (assistência no ato do lançamento).

Sugere Categoria → Subitem → Classificação a partir da descrição, usando a
taxonomia REAL configurada pelo tenant: o LLM escolhe entre os subitens que já
existem (retorna o id exato) — nunca inventa categoria. Também sinaliza
duplicata provável (mesma descrição + valor no mesmo mês).

Princípio: a IA SUGERE, o humano CONFIRMA. Este serviço não grava nada.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

import anthropic
from supabase import Client

from app.auth import UsuarioAtual
from app.config import cfg

logger = logging.getLogger(__name__)

# Modelo padrão. Para reduzir custo em alto volume, troque por "claude-haiku-4-5"
# (classificação simples) — decisão do usuário.
MODELO = "claude-opus-4-8"
MAX_SUBITENS = 200
DIAS_JANELA_ORDEM = 45   # janela p/ considerar ordem de compra duplicada

_TOOL = {
    "name": "registrar_sugestao",
    "description": "Registra a melhor classificação para a despesa descrita.",
    "input_schema": {
        "type": "object",
        "properties": {
            "subitem_id": {
                "type": "string",
                "description": (
                    "ID do subitem que melhor descreve a despesa, escolhido "
                    "EXCLUSIVAMENTE da lista fornecida. String vazia se nenhum servir."
                ),
            },
            "classificacao": {
                "type": "string",
                "enum": ["fixo", "variavel", "imposto", ""],
                "description": "Classificação da despesa; vazio se incerto.",
            },
            "confianca": {"type": "string", "enum": ["alta", "media", "baixa"]},
            "motivo": {"type": "string", "description": "Justificativa curta (máx. 1 frase)."},
        },
        "required": ["subitem_id", "classificacao", "confianca", "motivo"],
    },
}


async def sugerir_classificacao(
    descricao: str,
    natureza: str,
    usuario: UsuarioAtual,
    db: Client,
    valor: float | None = None,
    competencia: str | None = None,
) -> dict:
    descricao = (descricao or "").strip()
    if len(descricao) < 3:
        return {"disponivel": False, "motivo": "Descrição muito curta para sugerir."}

    # 1) Taxonomia real do tenant (subitens ativos da natureza)
    resp = (
        db.table("subitens_lancamento")
        .select("id, nome, custo_tipo, categoria_id, ativo, categorias_lancamento(nome)")
        .eq("natureza", natureza)
        .eq("ativo", True)
        .limit(MAX_SUBITENS)
        .execute()
    )
    subitens = resp.data or []
    if not subitens:
        return {"disponivel": False, "motivo": "Nenhum subitem configurado para esta natureza."}

    por_id = {s["id"]: s for s in subitens}
    catalogo = "\n".join(
        f'- id={s["id"]} | {(s.get("categorias_lancamento") or {}).get("nome", "?")} › {s["nome"]}'
        for s in subitens
    )

    # 2) Claude com forced tool-use (saída estruturada, portável entre versões do SDK)
    if not cfg.anthropic_api_key:
        return {"disponivel": False, "motivo": "IA não configurada (defina ANTHROPIC_API_KEY)."}
    cliente = anthropic.Anthropic(api_key=cfg.anthropic_api_key)
    prompt = (
        f'Despesa a classificar: "{descricao}"\n\n'
        "Escolha o subitem mais adequado APENAS da lista abaixo (retorne o id exato). "
        "Se nenhum servir bem, retorne subitem_id vazio.\n\n"
        f"SUBITENS DISPONÍVEIS:\n{catalogo}"
    )
    try:
        msg = cliente.messages.create(
            model=MODELO,
            max_tokens=1024,
            tools=[_TOOL],
            tool_choice={"type": "tool", "name": "registrar_sugestao"},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        return {"disponivel": False, "motivo": "Chave de IA inválida."}
    except Exception as e:  # noqa: BLE001 — degrada graciosamente
        logger.error("copiloto_erro: %s", e)
        return {"disponivel": False, "motivo": "Falha ao consultar a IA."}

    dados = next((b.input for b in msg.content if b.type == "tool_use"), {}) or {}
    subitem_id = (dados.get("subitem_id") or "").strip()
    escolhido = por_id.get(subitem_id)

    classificacao = (dados.get("classificacao") or "").strip() or (
        escolhido.get("custo_tipo") if escolhido else None
    )
    sugestao = {
        "disponivel": bool(escolhido),
        "subitem_id": escolhido["id"] if escolhido else None,
        "subitem_nome": escolhido["nome"] if escolhido else None,
        "categoria_id": escolhido.get("categoria_id") if escolhido else None,
        "categoria_nome": (escolhido.get("categorias_lancamento") or {}).get("nome") if escolhido else None,
        "classificacao": classificacao or None,
        "confianca": dados.get("confianca"),
        "motivo": dados.get("motivo"),
        "duplicata": _checar_duplicata(descricao, valor, competencia, usuario, db),
    }
    return sugestao


def _checar_duplicata(
    descricao: str, valor: float | None, competencia: str | None, usuario: UsuarioAtual, db: Client
) -> dict | None:
    """Duplicata provável: mesma descrição + valor na mesma competência (mês)."""
    if valor is None or not competencia:
        return None
    try:
        mes = competencia[:7]
        y, m = int(mes[:4]), int(mes[5:7])
        ini = f"{mes}-01"
        prox = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
        q = (
            db.table("despesas")
            .select("id, descricao, valor")
            .neq("status", "excluida")
            .gte("competencia", ini)
            .lt("competencia", prox)
        )
        # Comercial e Contador só enxergam o que lançaram (mesma regra das listas)
        if usuario.role in ("comercial", "contador"):
            q = q.eq("criado_por", usuario.user_id)
        rows = q.execute().data or []
        alvo = descricao.lower()
        n = sum(
            1
            for r in rows
            if (r.get("descricao") or "").strip().lower() == alvo
            and abs(float(r.get("valor") or 0) - float(valor)) < 0.01
        )
        return {"quantidade": n} if n > 0 else None
    except Exception as e:  # noqa: BLE001
        logger.warning("copiloto_duplicata_erro: %s", e)
        return None


def checar_duplicata_ordem(
    assunto: str, valor: float | None, usuario: UsuarioAtual, db: Client
) -> dict | None:
    """Ordem de compra duplicada: mesmo assunto (+ valor, se informado) nos últimos dias."""
    assunto = (assunto or "").strip()
    if len(assunto) < 3:
        return None
    try:
        desde = (date.today() - timedelta(days=DIAS_JANELA_ORDEM)).isoformat()
        q = (
            db.table("ordens_compra")
            .select("id, assunto, valor")
            .neq("status", "excluida")
            .gte("data_solicitacao", desde)
        )
        if usuario.role in ("comercial", "contador"):
            q = q.eq("criado_por", usuario.user_id)
        rows = q.limit(1000).execute().data or []
        alvo = assunto.lower()

        def bate(r: dict) -> bool:
            if (r.get("assunto") or "").strip().lower() != alvo:
                return False
            if valor is None:
                return True
            return abs(float(r.get("valor") or 0) - float(valor)) < 0.01

        n = sum(1 for r in rows if bate(r))
        return {"quantidade": n} if n > 0 else None
    except Exception as e:  # noqa: BLE001
        logger.warning("copiloto_dup_ordem_erro: %s", e)
        return None
