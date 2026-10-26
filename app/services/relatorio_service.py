"""
MX Seguros — DRE-IA | Relatórios dinâmicos (substituem o Monitoramento IA).

A tela monta a tabela dinâmica no navegador; o backend só entrega os
lançamentos do período "planos", com os nomes já resolvidos (categoria,
subitem, classificação, banco, centro de custo, quem criou). Mesmas regras
de Lançamentos: período pela base escolhida, excluídas fora, Comercial e
Contador veem só o que lançaram. Rejeitadas também ficam fora (não são
movimento). Comissões ficam de fora por decisão (tabelas vazias hoje).

Também guarda os relatórios montados (tabela `relatorios`, migration 0043) e
gera o Excel da tabela que está na tela.
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from io import BytesIO
from uuid import UUID

import openpyxl
from fastapi import HTTPException, status
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


def _ve_tudo(usuario: UsuarioAtual) -> bool:
    return usuario.role in ("admin", "gestor")


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
        if not _ve_tudo(usuario):
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


def _linha(row: dict, tipo: str, nomes: dict[str, dict[str, str]], so_dre: set[str]) -> dict:
    sub = row.get("subitens_lancamento") or {}
    cat = sub.get("categorias_lancamento") or {}
    parcela = None
    if (row.get("parcela_total") or 0) > 1:
        parcela = f"{row.get('parcela_atual') or '?'}/{row['parcela_total']}"
    pago_em = row.get("paga_em") if tipo == "Despesa" else row.get("recebido_em")
    centro = row.get("centro_custo")
    custo = row.get("custo_tipo")
    # Datas completas (YYYY-MM-DD): a tela agrupa por dia, semana, mês,
    # trimestre ou ano.
    return {
        "id": row["id"],
        "tipo": tipo,
        "data": row.get("data_ref") or row.get("competencia"),
        "competencia": row.get("competencia"),
        "vencimento": row.get("data_vencimento"),
        "pago_em": pago_em,
        "pago": bool(pago_em),
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


def pode_ler_despesas(usuario: UsuarioAtual) -> bool:
    """Comercial não acessa despesas (mesma regra de GET /lancamentos/despesas)."""
    return usuario.role in ("admin", "gestor", "contador")


async def dados(
    inicio: date, fim: date, fonte: str, base: str, usuario: UsuarioAtual, db: Client,
) -> dict:
    """Lançamentos do período, planos, para a tabela dinâmica da tela."""
    from app.services.somente_dre import ids_somente_dre

    ler_despesas = fonte in ("despesa", "ambos") and pode_ler_despesas(usuario)
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


# ── Um lançamento, para editar a partir do relatório ──────────

async def obter_lancamento(tipo: str, lancamento_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    """Lançamento completo, no mesmo formato de GET /lancamentos/*, para abrir o
    modal de edição de Lançamentos direto do relatório."""
    from app.services.financeiro_service import _row_para_despesa_item
    from app.models.schemas import ReceitaItem

    nao_achou = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lançamento não encontrado.")
    if tipo == "despesa":
        if not pode_ler_despesas(usuario):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seu perfil não acessa despesas.")
        resp = await _exec(db.table("despesas").select("*").eq("id", str(lancamento_id)).neq("status", "excluida").limit(1))
        row = (resp.data or [None])[0]
        if not row or (not _ve_tudo(usuario) and str(row.get("criado_por")) != usuario.user_id):
            raise nao_achou
        return _row_para_despesa_item(row).model_dump(mode="json")

    resp = await _exec(
        db.table("receitas_outras")
        .select("id, descricao, valor, competencia, data_vencimento, recebido_em, centro_custo, criado_em, "
                "atualizado_em, status, observacao, tipo_lancamento_id, banco_id, custo_tipo, criado_por")
        .eq("id", str(lancamento_id)).neq("status", "excluida").limit(1)
    )
    row = (resp.data or [None])[0]
    if not row or (not _ve_tudo(usuario) and str(row.get("criado_por")) != usuario.user_id):
        raise nao_achou
    return ReceitaItem(
        id=row["id"], origem="manual", status=row.get("status"),
        tipo_lancamento_id=row.get("tipo_lancamento_id"), custo_tipo=row.get("custo_tipo"),
        banco_id=row.get("banco_id"), descricao=row["descricao"], valor=Decimal(str(row["valor"])),
        competencia=row["competencia"], data_vencimento=row.get("data_vencimento"),
        recebido_em=row.get("recebido_em"), centro_custo=row.get("centro_custo") or "matriz",
        observacao=row.get("observacao"), criado_em=row.get("criado_em"), atualizado_em=row.get("atualizado_em"),
    ).model_dump(mode="json")


# ── Relatórios salvos (migration 0043) ────────────────────────

_COLS_SALVO = "id, nome, config, dono, compartilhado, criado_em, atualizado_em"

SEM_TABELA = (
    "Salvar relatórios ainda não está disponível: falta rodar a migration "
    "0043_relatorios.sql no Supabase."
)


def _tabela_ausente(e: Exception) -> bool:
    texto = str(e)
    return "relatorios" in texto and any(k in texto for k in ("42P01", "PGRST205", "does not exist", "schema cache"))


def _indisponivel(e: Exception) -> HTTPException:
    if _tabela_ausente(e):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SEM_TABELA)
    logger.exception("relatorios_salvos_erro")
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Erro ao acessar os relatórios salvos.")


def _com_dono(rows: list[dict], usuario: UsuarioAtual, nomes: dict[str, str]) -> list[dict]:
    return [{**r, "meu": str(r["dono"]) == usuario.user_id, "dono_nome": nomes.get(str(r["dono"]))} for r in rows]


async def listar_salvos(usuario: UsuarioAtual, db: Client) -> dict:
    try:
        resp = await _exec(db.table("relatorios").select(_COLS_SALVO).order("nome"))
    except Exception as e:  # noqa: BLE001
        if _tabela_ausente(e):
            return {"disponivel": False, "aviso": SEM_TABELA, "itens": []}
        raise _indisponivel(e) from e
    nomes = await _mapa(db, "usuarios", "id", "nome")
    return {"disponivel": True, "aviso": None, "itens": _com_dono(resp.data or [], usuario, nomes)}


async def criar_salvo(nome: str, config: dict, compartilhado: bool, usuario: UsuarioAtual, db: Client) -> dict:
    dados_ins = {"nome": nome.strip(), "config": config, "compartilhado": compartilhado, "dono": usuario.user_id}
    if usuario.tenant_id:
        dados_ins["tenant_id"] = usuario.tenant_id
    try:
        resp = await _exec(db.table("relatorios").insert(dados_ins))
    except Exception as e:  # noqa: BLE001
        raise _indisponivel(e) from e
    return _com_dono(resp.data or [], usuario, {})[0]


async def atualizar_salvo(relatorio_id: UUID, campos: dict, usuario: UsuarioAtual, db: Client) -> dict:
    if "nome" in campos:
        campos["nome"] = campos["nome"].strip()
    try:
        # O filtro por dono é redundante com a RLS, mas deixa o 404 explícito
        # em vez de depender de "0 linhas atualizadas".
        resp = await _exec(
            db.table("relatorios").update(campos).eq("id", str(relatorio_id)).eq("dono", usuario.user_id)
        )
    except Exception as e:  # noqa: BLE001
        raise _indisponivel(e) from e
    if not resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relatório não encontrado ou não é seu.")
    return _com_dono(resp.data, usuario, {})[0]


async def excluir_salvo(relatorio_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    try:
        resp = await _exec(
            db.table("relatorios").delete().eq("id", str(relatorio_id)).eq("dono", usuario.user_id)
        )
    except Exception as e:  # noqa: BLE001
        raise _indisponivel(e) from e
    if not resp.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relatório não encontrado ou não é seu.")


# ── Exportação ────────────────────────────────────────────────

_NAVY = "071934"
_ZONA = "EEF1F6"
_FMT = {"brl": 'R$ #,##0.00;[Red]-R$ #,##0.00', "pct": '0.0"%"', "int": "#,##0"}

# Aba "Lançamentos": colunas na ordem da planilha → chave enviada pela tela.
COLUNAS_LANCAMENTOS = [
    ("Data", "data"), ("Tipo", "tipo"), ("Descrição", "descricao"), ("Categoria", "categoria"),
    ("Subitem", "subitem"), ("Classificação", "classificacao"), ("Banco", "banco"),
    ("Centro de custo", "centro"), ("Status", "status"), ("Valor", "valor"),
]


def _cabecalho(ws, linha: int, titulos: list[str]) -> None:
    for c in range(1, len(titulos) + 1):
        cel = ws.cell(row=linha, column=c)
        cel.font = Font(bold=True, color="FFFFFF")
        cel.fill = PatternFill("solid", fgColor=_NAVY)
        cel.alignment = Alignment(horizontal="left" if c == 1 else "right", vertical="center")


def gerar_excel(
    titulo: str, subtitulo: str, cabecalho: list[str], linhas: list[dict],
    lancamentos: list[dict] | None = None,
) -> BytesIO:
    """Planilha com a tabela como está na tela e, se vierem, os lançamentos
    que a formam numa segunda aba.

    `linhas`: [{"rotulo", "nivel", "tipo": "item"|"sub"|"tot", "valores": [num|None],
    "formatos": ["brl"|"pct"|"int"]}].
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
    _cabecalho(ws, linha_cab, cabecalho)

    for ln in linhas:
        ws.append([ln.get("rotulo", "")] + list(ln.get("valores") or []))
        r = ws.max_row
        tipo = ln.get("tipo", "item")
        ws.cell(row=r, column=1).alignment = Alignment(indent=int(ln.get("nivel") or 0))
        formatos = ln.get("formatos") or []
        for i in range(len(ln.get("valores") or [])):
            cel = ws.cell(row=r, column=i + 2)
            cel.number_format = _FMT.get(formatos[i] if i < len(formatos) else "brl", _FMT["brl"])
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

    if lancamentos:
        wl = wb.create_sheet("Lançamentos")
        titulos = [t for t, _ in COLUNAS_LANCAMENTOS]
        wl.append(titulos)
        _cabecalho(wl, 1, titulos)
        for item in lancamentos:
            linha = []
            for _, chave in COLUNAS_LANCAMENTOS:
                v = item.get(chave)
                if chave == "data" and isinstance(v, str) and len(v) >= 10:
                    try:
                        v = date.fromisoformat(v[:10])
                    except ValueError:
                        pass
                linha.append(v)
            wl.append(linha)
            r = wl.max_row
            wl.cell(row=r, column=1).number_format = "DD/MM/YYYY"
            wl.cell(row=r, column=len(titulos)).number_format = _FMT["brl"]
        wl.freeze_panes = "A2"
        wl.auto_filter.ref = f"A1:{get_column_letter(len(titulos))}{wl.max_row}"
        for c, w in enumerate([12, 10, 40, 26, 30, 16, 14, 18, 11, 16], start=1):
            wl.column_dimensions[get_column_letter(c)].width = w

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
