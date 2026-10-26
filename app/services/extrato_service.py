"""
MX Seguros — DRE-IA | Importador de extrato bancário (preview → confirmar).

Fluxo:
1. POST /importacao/extrato  → upload → detecta banco/formato, normaliza,
   marca direção (crédito→receita / débito→despesa) e sinaliza DUPLICATAS.
2. POST /importacao/extrato/confirmar → grava em lote só os itens que o
   usuário revisou/aprovou (com a direção que ele confirmou).

A IA sugere a direção; o humano confirma item a item na tela.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from pydantic import BaseModel
from supabase import Client

from app.auth import UsuarioAtual
from app.logging_config import get_logger
from app.services.financeiro_service import aprovacao_por_pagamento, campos_aprovacao

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from etl.extrato_parser import parsear  # noqa: E402

logger = get_logger(__name__)


class ExtratoItemConfirm(BaseModel):
    data: str                       # YYYY-MM-DD
    descricao: str
    valor: float                    # valor absoluto (positivo)
    tipo: str                       # 'despesa' | 'receita'
    tipo_lancamento_id: str | None = None


class ConfirmarExtratoRequest(BaseModel):
    banco_id: str | None = None
    centro_custo: str = "matriz"
    itens: list[ExtratoItemConfirm]


# ── Preview ────────────────────────────────────────────────────

def gerar_preview(conteudo: bytes, filename: str, usuario: UsuarioAtual, db: Client) -> dict:
    parse = parsear(conteudo, filename)

    reais = [t for t in parse.transacoes if not t.ignorar]
    ignorados = [t for t in parse.transacoes if t.ignorar]

    # Chaves já existentes (para deduplicação) no intervalo de meses do extrato
    existentes = _chaves_existentes(reais, usuario, db)

    itens = []
    for idx, t in enumerate(reais):
        valor_abs = abs(t.valor)
        tipo = "receita" if t.valor >= 0 else "despesa"
        chave = (t.descricao.strip().lower(), round(valor_abs, 2), (t.data or "")[:7])
        itens.append({
            "id": idx,
            "data": t.data,
            "descricao": t.descricao,
            "valor": round(valor_abs, 2),
            "tipo": tipo,
            "documento": t.documento,
            "duplicata": chave in existentes,
        })

    resumo = {
        "total": len(itens),
        "despesas": sum(1 for i in itens if i["tipo"] == "despesa"),
        "receitas": sum(1 for i in itens if i["tipo"] == "receita"),
        "duplicatas": sum(1 for i in itens if i["duplicata"]),
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


def _chaves_existentes(transacoes, usuario: UsuarioAtual, db: Client) -> set[tuple]:
    meses = sorted({(t.data or "")[:7] for t in transacoes if t.data})
    if not meses:
        return set()
    ini = f"{meses[0]}-01"
    # fim = primeiro dia do mês seguinte ao último
    y, m = int(meses[-1][:4]), int(meses[-1][5:7])
    fim = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
    so_proprios = usuario.role in ("comercial", "contador")

    chaves: set[tuple] = set()
    # despesas têm coluna 'status' (soft-delete); receitas_outras não têm
    for tabela, tem_status in (("despesas", True), ("receitas_outras", False)):
        try:
            q = db.table(tabela).select("descricao, valor, competencia").gte("competencia", ini).lt("competencia", fim)
            if tem_status:
                q = q.neq("status", "excluida")
                if so_proprios:
                    q = q.eq("criado_por", usuario.user_id)
            for r in (q.execute().data or []):
                chaves.add((
                    (r.get("descricao") or "").strip().lower(),
                    round(float(r.get("valor") or 0), 2),
                    (r.get("competencia") or "")[:7],
                ))
        except Exception as e:  # noqa: BLE001
            logger.warning("dedup_extrato_%s_erro: %s", tabela, e)
    return chaves


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
                    "centro_custo":       payload.centro_custo,
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
                    "centro_custo":       payload.centro_custo,
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

    return {
        "total_importado": len(despesas) + len(receitas),
        "despesas": len(despesas),
        "receitas": len(receitas),
        "erros": erros,
    }
