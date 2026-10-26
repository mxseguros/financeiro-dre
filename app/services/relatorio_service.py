"""
MX Seguros — DRE-IA | Relatórios dinâmicos (substituem o Monitoramento IA).

A tela monta a tabela dinâmica no navegador; o backend só entrega os
lançamentos do período "planos", com os nomes já resolvidos (categoria,
subitem, classificação, banco, centro de custo, quem criou). Mesmas regras
de Lançamentos: período pela base escolhida, excluídas fora, Comercial e
Contador veem só o que lançaram. Rejeitadas também ficam fora (não são
movimento). Comissões ficam de fora por decisão (tabelas vazias hoje).
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from io import BytesIO

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from supabase import Client

from app.auth import UsuarioAtual
from app.database import executar_sem_bloquear as _exec
from app.services.periodo_base import coluna_data

logger = logging.getLogger(__name__)

# O PostgREST corta em 1000 linhas por resposta; um ano de lançamentos passa
# disso, então a leitura é feita em páginas.
_PAGINA = 1000

_COLUNAS = {
    "despesas": (
        "id, descricao, valor, competencia, data_vencimento, paga_em, data_ref, centro_custo, "
        "status, criado_por, parcela_atual, parcela_total, custo_tipo, tipo_lancamento_id, "
        "subitens_lancamento(nome, categorias_lancamento(nome)), bancos(nome)"
    ),
    "receitas_outras": (
        "id, descricao, valor, competencia, data_vencimento, recebido_em, data_ref, centro_custo, "
        "status, criado_por, custo_tipo, tipo_lancamento_id, "
        "subitens_lancamento(nome, categorias_lancamento(nome)), bancos(nome)"
    ),
}

_STATUS = {"pendente": "Pendente", "aprovada": "Aprovada"}


async def _ler_tudo(montar) -> list[dict]:
    linhas: list[dict] = []
    inicio = 0
    while True:
        resp = await _exec(montar().range(inicio, inicio + _PAGINA - 1))
        lote = resp.data or []
        linhas.extend(lote)
        if len(lote) < _PAGINA:
            return linhas
        inicio += _PAGINA


async def _ler_lancamentos(
    tabela: str, inicio: date, fim: date, base: str, usuario: UsuarioAtual, db: Client,
) -> list[dict]:
    col = coluna_data(tabela, base)

    def montar():
        q = (
            db.table(tabela).select(_COLUNAS[tabela])
            .gte(col, inicio.isoformat())
            .lte(col, fim.isoformat())
            .not_.in_("status", ["excluida", "rejeitada"])
            .order(col).order("id")
        )
        # Mesma visibilidade de Lançamentos: despesas próprias para Comercial e
        # Contador; receitas próprias para quem não é Admin/Gestor.
        if usuario.role not in ("admin", "gestor"):
            q = q.eq("criado_por", usuario.user_id)
        return q

    return await _ler_tudo(montar)


async def _mapa(db: Client, tabela: str, chave: str, valor: str) -> dict[str, str]:
    try:
        resp = await _exec(db.table(tabela).select(f"{chave}, {valor}"))
        return {str(r[chave]): _nome(r[valor]) for r in (resp.data or []) if r.get(chave) is not None}
    except Exception as e:  # noqa: BLE001 — cadastro indisponível: mostra o código
        logger.warning("relatorio_mapa_indisponivel %s: %s", tabela, e)
        return {}


def _nome(v: str | None) -> str | None:
    """Cadastros têm nomes com espaço sobrando ("Empréstimo "), que viravam
    grupos separados na tabela dinâmica."""
    return v.strip() or None if isinstance(v, str) else v


def _mes(d: str | None) -> str | None:
    return d[:7] if d else None


def _linha(row: dict, tipo: str, nomes: dict[str, dict[str, str]], so_dre: set[str]) -> dict:
    sub = row.get("subitens_lancamento") or {}
    cat = sub.get("categorias_lancamento") or {}
    parcela = None
    if (row.get("parcela_total") or 0) > 1:
        parcela = f"{row.get('parcela_atual') or '?'}/{row['parcela_total']}"
    pago = row.get("paga_em") if tipo == "Despesa" else row.get("recebido_em")
    centro = row.get("centro_custo")
    custo = row.get("custo_tipo")
    return {
        "id": row["id"],
        "tipo": tipo,
        "data": row.get("data_ref") or row.get("competencia"),
        "mes": _mes(row.get("data_ref") or row.get("competencia")),
        "competencia": _mes(row.get("competencia")),
        "vencimento": _mes(row.get("data_vencimento")),
        "pago": bool(pago),
        "categoria": _nome(cat.get("nome")),
        "subitem": _nome(sub.get("nome")),
        "classificacao": nomes["classificacao"].get(custo, custo) if custo else None,
        "banco": _nome((row.get("bancos") or {}).get("nome")),
        "centro": nomes["centro"].get(centro, centro) if centro else None,
        "status": _STATUS.get(row.get("status") or "", row.get("status")),
        "descricao": _nome(row.get("descricao")),
        "parcela": parcela,
        "criado_por": nomes["usuario"].get(str(row.get("criado_por"))),
        "so_dre": row.get("tipo_lancamento_id") in so_dre,
        "valor": float(Decimal(str(row.get("valor") or 0))),
    }


async def dados(
    inicio: date, fim: date, fonte: str, base: str, usuario: UsuarioAtual, db: Client,
) -> dict:
    """Lançamentos do período, planos, para a tabela dinâmica da tela."""
    from app.services.somente_dre import ids_somente_dre

    # Despesas: Comercial não acessa (mesma regra de GET /lancamentos/despesas).
    ler_despesas = fonte in ("despesa", "ambos") and usuario.role in ("admin", "gestor", "contador")
    ler_receitas = fonte in ("receita", "ambos")

    # Tudo em sequência, de propósito. O client do supabase-py fala HTTP/2, e
    # usá-lo de várias threads ao mesmo tempo (gather + to_thread) corrompe a
    # compressão de cabeçalhos da conexão: ConnectionTerminated error_code 9 e,
    # nas consultas seguintes, 400 do Cloudflare (medido em 26/10/2026).
    desp = await _ler_lancamentos("despesas", inicio, fim, base, usuario, db) if ler_despesas else []
    rec = await _ler_lancamentos("receitas_outras", inicio, fim, base, usuario, db) if ler_receitas else []
    classif = await _mapa(db, "classificacoes", "codigo", "nome")
    centros = await _mapa(db, "centros_custo", "codigo", "nome")
    usuarios = await _mapa(db, "usuarios", "id", "nome")
    so_dre = await ids_somente_dre(db)
    nomes = {"classificacao": classif, "centro": centros, "usuario": usuarios}
    itens = [_linha(r, "Despesa", nomes, so_dre) for r in desp]
    itens += [_linha(r, "Receita", nomes, so_dre) for r in rec]
    return {
        "inicio": inicio.isoformat(),
        "fim": fim.isoformat(),
        "base": base,
        "fonte": fonte,
        "despesas_ocultas": fonte in ("despesa", "ambos") and not ler_despesas,
        "total": len(itens),
        "itens": itens,
    }


# ── Exportação ────────────────────────────────────────────────

_NAVY = "071934"
_ZONA = "EEF1F6"


def gerar_excel(titulo: str, subtitulo: str, cabecalho: list[str], linhas: list[dict]) -> BytesIO:
    """Planilha com a tabela como está na tela.

    `linhas`: [{"rotulo", "nivel", "tipo": "item"|"sub"|"tot", "valores": [num|None],
    "formatos": ["brl"|"pct"|"int"]}] — o formato vem por coluna em `formatos`
    da própria linha (o mesmo para todas, mas é mais simples de montar no front).
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Relatório"

    ws.append([titulo])
    ws["A1"].font = Font(bold=True, size=14, color=_NAVY)
    ws.append([subtitulo])
    ws["A2"].font = Font(size=10, color="5E6B7D")
    ws.append([])

    ws.append(cabecalho)
    linha_cab = ws.max_row
    for c in range(1, len(cabecalho) + 1):
        cel = ws.cell(row=linha_cab, column=c)
        cel.font = Font(bold=True, color="FFFFFF")
        cel.fill = PatternFill("solid", fgColor=_NAVY)
        cel.alignment = Alignment(horizontal="left" if c == 1 else "right", vertical="center")

    fmt = {"brl": 'R$ #,##0.00;[Red]-R$ #,##0.00', "pct": '0.0"%"', "int": "#,##0"}
    for ln in linhas:
        ws.append([ln.get("rotulo", "")] + list(ln.get("valores") or []))
        r = ws.max_row
        tipo = ln.get("tipo", "item")
        ws.cell(row=r, column=1).alignment = Alignment(indent=int(ln.get("nivel") or 0))
        formatos = ln.get("formatos") or []
        for i in range(len(ln.get("valores") or [])):
            cel = ws.cell(row=r, column=i + 2)
            cel.number_format = fmt.get(formatos[i] if i < len(formatos) else "brl", fmt["brl"])
        if tipo in ("sub", "tot"):
            for c in range(1, len(cabecalho) + 1):
                cel = ws.cell(row=r, column=c)
                cel.font = Font(bold=True)
                if tipo == "sub":
                    cel.fill = PatternFill("solid", fgColor=_ZONA)

    ws.freeze_panes = ws.cell(row=linha_cab + 1, column=2)
    largura = max([18] + [len(str(ln.get("rotulo", ""))) + 2 * int(ln.get("nivel") or 0) for ln in linhas])
    ws.column_dimensions["A"].width = min(60, largura + 2)
    for c in range(2, len(cabecalho) + 1):
        ws.column_dimensions[get_column_letter(c)].width = max(16, min(40, len(cabecalho[c - 1]) + 4))

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
