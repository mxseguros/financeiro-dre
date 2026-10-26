"""
MX Seguros — DRE-IA | Serviço de Lançamentos e Configurações Financeiras.

Gerencia CRUD de despesas manuais, receitas_outras,
bancos, centros de custo e tipos de lançamento.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from supabase import Client

from app.auth import UsuarioAtual
from app.database import executar_sem_bloquear as _exec, get_supabase_admin
from app.services import classificacao_service
from app.models.schemas import (
    BancoCreate, BancoItem, BancoUpdate,
    CategoriaLancamentoCreate, CategoriaLancamentoItem, CategoriaLancamentoUpdate,
    CentroCustoCreate, CentroCustoItem, CentroCustoUpdate,
    DespesaCreate, DespesaItem, DespesasResponse, DespesaUpdate,
    ReceitaItem, ReceitaOutraCreate, ReceitaOutraUpdate, ReceitasResponse,
    TipoLancamentoCreate, TipoLancamentoItem, TipoLancamentoUpdate,
)

logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────

def _dec(v) -> Decimal:
    return Decimal(str(v)) if v is not None else Decimal(0)


# ══════════════════════════════════════════════════════════════
# CONFIGURAÇÕES
# ══════════════════════════════════════════════════════════════

# ── Bancos ────────────────────────────────────────────────────

async def listar_bancos(db: Client) -> list[BancoItem]:
    resp = db.table("bancos").select("id, nome, ativo").order("nome").execute()
    return [BancoItem(**r) for r in (resp.data or [])]


async def criar_banco(payload: BancoCreate, db: Client) -> BancoItem:
    resp = db.table("bancos").insert({"nome": payload.nome}).execute()
    row = resp.data[0]
    return BancoItem(**row)


async def atualizar_banco(banco_id: UUID, payload: BancoUpdate, db: Client) -> BancoItem:
    dados = payload.model_dump(exclude_none=True)
    resp = db.table("bancos").update(dados).eq("id", str(banco_id)).execute()
    row = resp.data[0]
    return BancoItem(**row)


async def excluir_banco(banco_id: UUID, db: Client) -> None:
    db.table("bancos").delete().eq("id", str(banco_id)).execute()


# ── Centros de Custo ──────────────────────────────────────────

async def listar_centros_custo(db: Client) -> list[CentroCustoItem]:
    resp = db.table("centros_custo").select("id, nome, codigo, ativo").order("nome").execute()
    return [CentroCustoItem(**r) for r in (resp.data or [])]


async def criar_centro_custo(payload: CentroCustoCreate, db: Client) -> CentroCustoItem:
    # Trim evita espaços acidentais no código/nome, que quebram o filtro por centro
    resp = db.table("centros_custo").insert({
        "nome":   payload.nome.strip(),
        "codigo": payload.codigo.strip(),
    }).execute()
    row = resp.data[0]
    return CentroCustoItem(**row)


async def atualizar_centro_custo(
    centro_id: UUID, payload: CentroCustoUpdate, db: Client
) -> CentroCustoItem:
    dados = payload.model_dump(exclude_none=True)
    for campo in ("nome", "codigo"):
        if isinstance(dados.get(campo), str):
            dados[campo] = dados[campo].strip()
    resp = db.table("centros_custo").update(dados).eq("id", str(centro_id)).execute()
    row = resp.data[0]
    return CentroCustoItem(**row)


async def excluir_centro_custo(centro_id: UUID, db: Client) -> None:
    db.table("centros_custo").delete().eq("id", str(centro_id)).execute()


# ── Categorias de Lançamento ──────────────────────────────────

async def listar_categorias_lancamento(
    db: Client, natureza: str | None = None
) -> list[CategoriaLancamentoItem]:
    query = db.table("categorias_lancamento").select(
        "id, nome, natureza, ordem, ativo"
    ).order("natureza").order("ordem").order("nome")
    if natureza:
        query = query.eq("natureza", natureza)
    resp = query.execute()
    return [CategoriaLancamentoItem(**r) for r in (resp.data or [])]


async def criar_categoria_lancamento(
    payload: CategoriaLancamentoCreate, usuario: UsuarioAtual, db: Client
) -> CategoriaLancamentoItem:
    dados = {
        "nome":     payload.nome,
        "natureza": payload.natureza,
        "ordem":    payload.ordem,
    }
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id
    resp = db.table("categorias_lancamento").insert(dados).execute()
    row = resp.data[0]
    return CategoriaLancamentoItem(**row)


async def atualizar_categoria_lancamento(
    categoria_id: UUID, payload: CategoriaLancamentoUpdate, db: Client
) -> CategoriaLancamentoItem:
    dados = payload.model_dump(exclude_none=True)
    resp = db.table("categorias_lancamento").update(dados).eq("id", str(categoria_id)).execute()
    row = resp.data[0]
    return CategoriaLancamentoItem(**row)


async def excluir_categoria_lancamento(categoria_id: UUID, db: Client) -> None:
    from fastapi import HTTPException, status as http_status
    tem_subitem = (
        db.table("subitens_lancamento").select("id").eq("categoria_id", str(categoria_id))
        .limit(1).execute()
    )
    if tem_subitem.data or []:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Existem subitens vinculados a esta categoria — exclua ou mova os subitens antes de excluir a categoria.",
        )
    db.table("categorias_lancamento").delete().eq("id", str(categoria_id)).execute()


# ── Subitens de Lançamento (ex-"Tipos de Lançamento") ─────────

async def listar_tipos_lancamento(
    db: Client, natureza: str | None = None
) -> list[TipoLancamentoItem]:
    def _consulta(colunas: str):
        q = db.table("subitens_lancamento").select(colunas).order("natureza").order("nome")
        return q.eq("natureza", natureza) if natureza else q

    base = "id, nome, natureza, categoria, categoria_id, custo_tipo, ativo, categorias_lancamento(nome)"
    # Coluna da migration 0037: sem ela, lista sem o campo.
    for extras in (", somente_dre", ""):
        try:
            resp = _consulta(base + extras).execute()
            break
        except Exception:  # noqa: BLE001 — coluna ainda não criada
            continue
    items = []
    for r in (resp.data or []):
        categoria_nome = (r.get("categorias_lancamento") or {}).get("nome")
        r = {k: v for k, v in r.items() if k != "categorias_lancamento"}
        items.append(TipoLancamentoItem(**r, categoria_nome=categoria_nome))
    return items


async def criar_tipo_lancamento(
    payload: TipoLancamentoCreate, usuario: UsuarioAtual, db: Client
) -> TipoLancamentoItem:
    dados = {
        "nome":         payload.nome,
        "natureza":     payload.natureza,
        "categoria":    payload.categoria,
        "categoria_id": str(payload.categoria_id),
        "custo_tipo":   payload.custo_tipo,
    }
    if payload.somente_dre:
        dados["somente_dre"] = True
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id
    resp = db.table("subitens_lancamento").insert(dados).execute()
    row = resp.data[0]
    return TipoLancamentoItem(**row)


async def atualizar_tipo_lancamento(
    tipo_id: UUID, payload: TipoLancamentoUpdate, db: Client
) -> TipoLancamentoItem:
    dados = payload.model_dump(exclude_none=True)
    if "categoria_id" in dados:
        dados["categoria_id"] = str(dados["categoria_id"])
    resp = db.table("subitens_lancamento").update(dados).eq("id", str(tipo_id)).execute()
    row = resp.data[0]
    return TipoLancamentoItem(**row)


async def excluir_tipo_lancamento(tipo_id: UUID, db: Client) -> None:
    from fastapi import HTTPException, status as http_status
    tem_despesa = (
        db.table("despesas").select("id").eq("tipo_lancamento_id", str(tipo_id))
        .limit(1).execute()
    )
    tem_receita = (
        db.table("receitas_outras").select("id").eq("tipo_lancamento_id", str(tipo_id))
        .limit(1).execute()
    )
    if (tem_despesa.data or []) or (tem_receita.data or []):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Existem lançamentos vinculados a este subitem — desative-o em vez de excluir.",
        )
    db.table("subitens_lancamento").delete().eq("id", str(tipo_id)).execute()


# ══════════════════════════════════════════════════════════════
# LANÇAMENTOS
# ══════════════════════════════════════════════════════════════

# ── Despesas ──────────────────────────────────────────────────

# Ordenação vinda da tela: só estes campos são aceitos. O mapa também serve de
# whitelist — nada que chegue do cliente vai direto para o `.order()`.
_COLUNAS_ORDEM_DESPESA = {
    "competencia":  "competencia",
    "vencimento":   "data_vencimento",
    "pagamento":    "paga_em",
    "valor":        "valor",
    # "registro" ordena por ULTIMA MOVIMENTACAO, nao por criacao: um lancamento
    # editado hoje precisa subir para o topo, porque a edicao o devolveu para a
    # fila de aprovacao (migration 0032). Mantido em criado_em ele afundaria na
    # lista justamente quando exige atencao. A coluna e mantida por trigger
    # (migration 0034), entao vale para qualquer caminho de escrita.
    "registro":     "atualizado_em",
    "criacao":      "criado_em",
}

_COLUNAS_ORDEM_RECEITA = {
    "competencia":  "competencia",
    "vencimento":   "data_vencimento",
    "pagamento":    "recebido_em",
    "valor":        "valor",
    "registro":     "atualizado_em",
    "criacao":      "criado_em",
}


def _termo_busca(q: str | None) -> str | None:
    """Normaliza o termo para casar com a coluna gerada `descricao_busca`.

    A coluna guarda o texto sem acento e em minúsculas (migration 0033), então
    o termo passa pelo mesmo tratamento — é isso que faz "Caminhão" encontrar
    "COMPRA CAMINHAO", que é como o extrato bancário costuma escrever.

    A versão anterior REMOVIA `, ( ) * " \\` do termo. Isso produzia dois bugs:
    digitar uma vírgula que existe no dado gerava um padrão que nunca casava, e
    `%` / `_` passavam intactos — como são curingas do LIKE, buscar `%` devolvia
    a tabela inteira (91 de 91 linhas, medido). Agora os curingas são escapados
    e o valor vai entre aspas no filtro, o que torna vírgula e parêntese
    inofensivos para o parser do PostgREST.
    """
    if not q:
        return None

    limpo = _sem_acento(q.strip().lower())[:100]
    if not limpo:
        return None

    # Ordem importa: a barra invertida primeiro, senão ela escaparia as barras
    # que as linhas seguintes acabaram de inserir.
    for char in ("\\", "%", "_"):
        limpo = limpo.replace(char, "\\" + char)
    # Aspas fechariam o valor citado no filtro antes da hora.
    limpo = limpo.replace('"', '\\"')
    return limpo


def _sem_acento(texto: str) -> str:
    """Remove acentos, espelhando o `imutavel_unaccent` da migration 0033.

    Precisa ser equivalente ao que o banco fez ao gerar a coluna: se os dois
    lados divergirem, a busca deixa de casar exatamente nos termos acentuados
    que a mudança veio resolver.
    """
    import unicodedata
    decomposto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in decomposto if not unicodedata.combining(c))


async def buscar_despesas(
    inicio: date,
    fim: date,
    usuario: UsuarioAtual,
    db: Client,
    centro_custo: str | None = None,
    banco_id: str | None = None,
    status_filter: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    busca: str | None = None,
    ordenar_por: str = "competencia",
    ordem_desc: bool = True,
    base: str = "competencia",
    categoria_id: str | None = None,
    tipo_lancamento_id: str | None = None,
) -> DespesasResponse:
    from app.services.periodo_base import coluna_data, ids_do_tipo
    termo = _termo_busca(busca)
    col = coluna_data("despesas", base)
    ids_tipo = ids_do_tipo(db, categoria_id, tipo_lancamento_id)

    def _aplicar_filtros(q):
        q = (
            q.neq("status", "excluida")
            .gte(col, inicio.isoformat())
            .lte(col, fim.isoformat())
        )
        if ids_tipo is not None:
            q = q.in_("tipo_lancamento_id", ids_tipo)
        # Comercial e Contador só veem o que lançaram; Admin e Gestor veem tudo
        if usuario.role in ("comercial", "contador"):
            q = q.eq("criado_por", usuario.user_id)
        if centro_custo:
            q = q.eq("centro_custo", centro_custo.strip())
        if banco_id:
            q = q.eq("banco_id", banco_id)
        if status_filter:
            q = q.eq("status", status_filter)
        # A busca entra aqui (e não só na query de itens) para que o total e a
        # soma do período reflitam o que a tela está mostrando.
        if termo:
            # Uma coluna só (migration 0033): descricao_busca já concatena
            # descricao + subcategoria, sem acento e em minusculas. Some o OR
            # que comparava duas vezes o mesmo texto — subcategoria e descricao
            # sao identicas em todo o codigo que grava.
            q = q.ilike("descricao_busca", f"%{termo}%")
        return q

    coluna_ordem = _COLUNAS_ORDEM_DESPESA.get(ordenar_por, "competencia")
    query = _aplicar_filtros(
        db.table("despesas").select(
            "id, categoria, subcategoria, descricao, valor, competencia, "
            "data_vencimento, paga_em, centro_custo, recorrente, parcela_atual, parcela_total, "
            "criado_em, atualizado_em, tipo_lancamento_id, banco_id, "
            "status, criado_por, aprovado_por, aprovado_em, rejeitado_motivo, "
            "custo_tipo, subitens_lancamento(nome), bancos(nome)"
        )
    # `nullsfirst=False` mantém a regra que a tela já aplicava: data vazia por
    # último. O desempate por id é o que torna a paginação por offset estável —
    # sem ele, linhas com a mesma competência podem repetir ou sumir entre páginas.
    ).order(coluna_ordem, desc=ordem_desc, nullsfirst=False).order("id", desc=False)
    if limit is not None:
        query = query.range(offset, offset + limit - 1)

    if limit is None:
        resp = await _exec(query)
    else:
        # Itens + 3 agregados (total, pendentes, soma) são independentes:
        # 4 round-trips em paralelo, fora do event loop, em vez de 4 em fila.
        resp, resp_total, resp_pend, resp_soma = await asyncio.gather(
            _exec(query),
            _exec(_aplicar_filtros(db.table("despesas").select("id", count="exact")).limit(1)),
            _exec(
                _aplicar_filtros(db.table("despesas").select("id", count="exact"))
                .eq("status", "pendente").limit(1)
            ),
            _exec(_aplicar_filtros(db.table("despesas").select("valor"))),
        )
    items = []
    for row in (resp.data or []):
        tipo_nome  = (row.get("subitens_lancamento") or {}).get("nome")
        banco_nome = (row.get("bancos") or {}).get("nome")
        items.append(DespesaItem(
            id=row["id"],
            tipo_lancamento_id=row.get("tipo_lancamento_id"),
            custo_tipo=row.get("custo_tipo"),
            tipo_nome=tipo_nome,
            banco_id=row.get("banco_id"),
            banco_nome=banco_nome,
            categoria=row.get("categoria"),
            subcategoria=row.get("subcategoria", ""),
            descricao=row["descricao"],
            valor=_dec(row["valor"]),
            competencia=row["competencia"],
            data_vencimento=row.get("data_vencimento"),
            paga_em=row.get("paga_em"),
            centro_custo=row.get("centro_custo", "matriz"),
            recorrente=bool(row.get("recorrente", False)),
            parcela_atual=row.get("parcela_atual"),
            parcela_total=row.get("parcela_total"),
            criado_em=row.get("criado_em"),
            atualizado_em=row.get("atualizado_em"),
            status=row.get("status", "aprovada"),
            criado_por=row.get("criado_por"),
            aprovado_por=row.get("aprovado_por"),
            aprovado_em=row.get("aprovado_em"),
            rejeitado_motivo=row.get("rejeitado_motivo"),
        ))

    if limit is None:
        soma = sum(i.valor for i in items)
        pendentes = sum(1 for i in items if i.status == "pendente")
        total = len(items)
    else:
        # Paginado: os agregados precisam refletir TODO o período (e a busca),
        # não a página atual — as queries já rodaram em paralelo lá em cima.
        #
        # `total` e `pendentes` saem de counts do PostgREST, que não trazem
        # linha alguma. A soma ainda precisa dos valores: agregados no PostgREST
        # (`valor.sum()`) estão desabilitados nesta instância do Supabase — a
        # resposta é PGRST123 "Use of aggregate functions is not allowed" — então
        # eliminar também essa varredura exigiria uma função no Postgres exposta
        # via RPC, o que é mudança de schema e não cabe aqui.
        total = resp_total.count or 0
        pendentes = resp_pend.count or 0
        soma = sum(_dec(r.get("valor", 0)) for r in (resp_soma.data or []))
    return DespesasResponse(total=total, items=items, soma_total=soma, total_pendentes=pendentes)


def campos_aprovacao(usuario_id: str | None) -> dict:
    """Campos de um lançamento aprovado automaticamente (sem passar pelo Kanban)."""
    from datetime import datetime, timezone
    return {
        "status":       "aprovada",
        "aprovado_por": usuario_id,
        "aprovado_em":  datetime.now(timezone.utc).isoformat(),
    }


def aprovacao_por_pagamento(usuario_id: str | None) -> dict:
    """Campos de uma despesa aprovada pela Data de Pagamento.

    Regra de 19/10/2026 (Gabriel): despesa com Data de Pagamento é considerada
    aprovada — o dinheiro já saiu —, qualquer que seja o perfil de quem lançou
    a data. Vale para criação, edição e importação de extrato.
    """
    return campos_aprovacao(usuario_id)


def _aprovar_pagas(linhas: list[dict], usuario_id: str | None) -> None:
    """Aplica a regra acima às linhas de um INSERT (só as que têm paga_em)."""
    for linha in linhas:
        if linha.get("paga_em"):
            linha.update(aprovacao_por_pagamento(usuario_id))


def _verificar_periodo_aberto(competencia: date, db: Client) -> None:
    """Lança 409 se o mês estiver fechado — impede lançamentos em período congelado."""
    from fastapi import HTTPException, status as http_status
    competencia_mes = date(competencia.year, competencia.month, 1)
    resp = db.table("fechamentos") \
        .select("id") \
        .eq("competencia", competencia_mes.isoformat()) \
        .is_("reaberto_em", "null") \
        .maybe_single() \
        .execute()
    if resp is not None and getattr(resp, "data", None):
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=(
                f"Período {competencia_mes.strftime('%m/%Y')} está fechado. "
                "Reabra o fechamento antes de lançar."
            ),
        )


def _somar_meses(d: date, n: int) -> date:
    """Retorna o dia 1º do mês `n` meses após `d`."""
    total = d.month - 1 + n
    return date(d.year + total // 12, total % 12 + 1, 1)


def _somar_meses_preservando_dia(d: date, n: int) -> date:
    """Como _somar_meses, mas preserva o dia do mês (clampado ao último dia
    do mês destino) — usado para deslocar data_vencimento em parcelamento/
    recorrência, onde o dia do vencimento importa (ex: todo dia 10)."""
    import calendar
    total = d.month - 1 + n
    ano = d.year + total // 12
    mes = total % 12 + 1
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    return date(ano, mes, min(d.day, ultimo_dia))


async def criar_despesa(
    payload: DespesaCreate,
    usuario: UsuarioAtual,
    db: Client,
) -> DespesaItem:
    # Bloqueia escrita em período fechado (Task 3.1)
    _verificar_periodo_aberto(payload.competencia, db)

    # Se tipo_lancamento_id informado, busca categoria para backward compat com DRE
    categoria = payload.categoria
    if payload.tipo_lancamento_id and not categoria:
        resp_tipo = db.table("subitens_lancamento").select("nome, categoria").eq(
            "id", str(payload.tipo_lancamento_id)
        ).single().execute()
        if resp_tipo.data:
            categoria = (resp_tipo.data.get("categoria") or "").strip() or None
            # Categoria herdada fora do ENUM quebraria o INSERT com 500.
            # Retorna 422 claro apontando o tipo a corrigir em Configurações.
            from app.models.schemas import CATEGORIAS_DESPESA_VALIDAS
            if categoria and categoria not in CATEGORIAS_DESPESA_VALIDAS:
                from fastapi import HTTPException, status as http_status
                raise HTTPException(
                    status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"O tipo de lançamento '{resp_tipo.data.get('nome')}' tem categoria "
                        f"inválida ('{categoria}'). Corrija a categoria deste tipo em "
                        "Configurações antes de lançar."
                    ),
                )

    # Auto-aprova apenas quem pode aprovar: role admin/gestor E permissão
    # granular 'aprovacoes.aprovar' (configurável por usuário em Configurações).
    # Quem não pode aprovar cria como pendente — vai para o Kanban de aprovação.
    from app.permissions import tem_permissao
    pode_aprovar = (
        usuario.role in ("admin", "gestor")
        and tem_permissao(usuario.permissions, "aprovacoes", "aprovar")
    )
    status_inicial = "aprovada" if pode_aprovar else "pendente"

    dados = {
        "subcategoria":    payload.subcategoria,
        "descricao":       payload.descricao,
        "valor":           str(payload.valor),
        "competencia":      payload.competencia.isoformat(),
        "data_vencimento": payload.data_vencimento.isoformat(),
        "centro_custo":    payload.centro_custo,
        "recorrente":      payload.recorrente,
        "criado_por":      usuario.user_id,
        "status":          status_inicial,
    }
    # Sprint 4: incluir tenant_id quando disponível
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id
    if categoria:
        dados["categoria"] = categoria
    if payload.tipo_lancamento_id:
        dados["tipo_lancamento_id"] = str(payload.tipo_lancamento_id)
    if payload.custo_tipo:
        classificacao_service.validar(db, payload.custo_tipo)
        dados["custo_tipo"] = payload.custo_tipo
    if payload.banco_id:
        dados["banco_id"] = str(payload.banco_id)
    if payload.paga_em:
        dados["paga_em"] = payload.paga_em.isoformat()
    if payload.parcela_atual:
        dados["parcela_atual"] = payload.parcela_atual
    if payload.parcela_total:
        dados["parcela_total"] = payload.parcela_total

    # Parcelamento atômico: cria N parcelas (uma por mês) em um único INSERT.
    # Todas gravam ou nenhuma grava — sem risco de criação parcial.
    if payload.num_parcelas and payload.num_parcelas > 1:
        # Marcador explícito do grupo (migration 0035). Sem ele, a correlação
        # entre as parcelas seria por descricao+valor+total, que quebra assim
        # que alguém edita a descrição de uma delas.
        grupo = str(uuid4())
        parcelas = []
        for i in range(payload.num_parcelas):
            p = dict(dados)
            p["grupo_parcelamento"] = grupo
            p["competencia"]     = _somar_meses(payload.competencia, i).isoformat()
            p["data_vencimento"] = _somar_meses_preservando_dia(payload.data_vencimento, i).isoformat()
            p["parcela_atual"]   = i + 1
            p["parcela_total"]   = payload.num_parcelas
            p["recorrente"]      = False
            # A data de pagamento informada vale para a 1ª parcela (a única que
            # pode já ter sido paga). As demais ficam em aberto e recebem a
            # própria data quando forem pagas, pela edição do lançamento.
            if i > 0:
                p.pop("paga_em", None)
            parcelas.append(p)
        _aprovar_pagas(parcelas, usuario.user_id)
        resp = db.table("despesas").insert(parcelas).execute()
    elif payload.repetir_ate and payload.repetir_ate >= payload.competencia:
        # Recorrência atômica (espelha receitas_outras.repetir_ate): cria um
        # registro por mês até `repetir_ate` em um único INSERT, limitado a
        # 60 meses. Todos gravam ou nenhum grava.
        n_meses = (
            (payload.repetir_ate.year - payload.competencia.year) * 12
            + (payload.repetir_ate.month - payload.competencia.month) + 1
        )
        if n_meses > 60:
            from fastapi import HTTPException, status as http_status
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Recorrência limitada a 60 meses.",
            )
        ocorrencias = []
        for i in range(n_meses):
            o = dict(dados)
            o["competencia"]     = _somar_meses(payload.competencia, i).isoformat()
            o["data_vencimento"] = _somar_meses_preservando_dia(payload.data_vencimento, i).isoformat()
            # Mesma regra do parcelamento: a data informada vale para a 1ª
            # ocorrência; as demais são pagas (e datadas) mês a mês.
            if i > 0:
                o.pop("paga_em", None)
            ocorrencias.append(o)
        _aprovar_pagas(ocorrencias, usuario.user_id)
        resp = db.table("despesas").insert(ocorrencias).execute()
    else:
        _aprovar_pagas([dados], usuario.user_id)
        resp = db.table("despesas").insert(dados).execute()
    row = resp.data[0]

    tipo_nome  = None
    banco_nome = None
    if payload.tipo_lancamento_id:
        r = db.table("subitens_lancamento").select("nome").eq(
            "id", str(payload.tipo_lancamento_id)
        ).single().execute()
        tipo_nome = (r.data or {}).get("nome")
    if payload.banco_id:
        r = db.table("bancos").select("nome").eq(
            "id", str(payload.banco_id)
        ).single().execute()
        banco_nome = (r.data or {}).get("nome")

    return DespesaItem(
        id=row["id"],
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        custo_tipo=row.get("custo_tipo"),
        tipo_nome=tipo_nome,
        banco_id=row.get("banco_id"),
        banco_nome=banco_nome,
        categoria=row.get("categoria"),
        subcategoria=row.get("subcategoria", ""),
        descricao=row["descricao"],
        valor=_dec(row["valor"]),
        competencia=row["competencia"],
        data_vencimento=row.get("data_vencimento"),
        paga_em=row.get("paga_em"),
        centro_custo=row.get("centro_custo", "matriz"),
        recorrente=bool(row.get("recorrente", False)),
        parcela_atual=row.get("parcela_atual"),
        parcela_total=row.get("parcela_total"),
        criado_em=row.get("criado_em"),
            atualizado_em=row.get("atualizado_em"),
        status=row.get("status", status_inicial),
        criado_por=row.get("criado_por"),
        aprovado_por=row.get("aprovado_por"),
        aprovado_em=row.get("aprovado_em"),
        rejeitado_motivo=row.get("rejeitado_motivo"),
    )


async def aprovar_despesa(despesa_id: UUID, usuario: UsuarioAtual, db: Client) -> DespesaItem:
    from datetime import datetime, timezone
    agora = datetime.now(timezone.utc).isoformat()
    resp = (
        db.table("despesas")
        .update({
            "status":       "aprovada",
            "aprovado_por": usuario.user_id,
            "aprovado_em":  agora,
        })
        .eq("id", str(despesa_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Despesa não encontrada.")
    row = resp.data[0]
    return _row_para_despesa_item(row)


async def rejeitar_despesa(
    despesa_id: UUID,
    motivo: str,
    usuario: UsuarioAtual,
    db: Client,
) -> DespesaItem:
    resp = (
        db.table("despesas")
        .update({
            "status":            "rejeitada",
            "aprovado_por":      usuario.user_id,
            "rejeitado_motivo":  motivo,
        })
        .eq("id", str(despesa_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Despesa não encontrada.")
    row = resp.data[0]
    return _row_para_despesa_item(row)


def _row_para_despesa_item(row: dict) -> DespesaItem:
    return DespesaItem(
        id=row["id"],
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        custo_tipo=row.get("custo_tipo"),
        tipo_nome=None,
        banco_id=row.get("banco_id"),
        banco_nome=None,
        categoria=row.get("categoria"),
        subcategoria=row.get("subcategoria", ""),
        descricao=row["descricao"],
        valor=_dec(row["valor"]),
        competencia=row["competencia"],
        data_vencimento=row.get("data_vencimento"),
        paga_em=row.get("paga_em"),
        centro_custo=row.get("centro_custo", "matriz"),
        recorrente=bool(row.get("recorrente", False)),
        parcela_atual=row.get("parcela_atual"),
        parcela_total=row.get("parcela_total"),
        criado_em=row.get("criado_em"),
            atualizado_em=row.get("atualizado_em"),
        status=row.get("status", "pendente"),
        criado_por=row.get("criado_por"),
        aprovado_por=row.get("aprovado_por"),
        aprovado_em=row.get("aprovado_em"),
        rejeitado_motivo=row.get("rejeitado_motivo"),
    )


def _quantizar(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"))


async def _plano_reparcelamento(
    despesa_id: UUID,
    novo_n: int,
    valor_informado: Decimal | None,
    db: Client,
    preservar_aprovadas: bool = False,
) -> dict | None:
    """Valida um pedido de reparcelamento e devolve o plano a executar.

    Devolve None quando não há nada a fazer (o total já é o pedido).

    O "grupo" refeito depende do lançamento editado:
    - parcelamento: o grupo inteiro, ancorado na 1ª parcela — mesmo que a
      edição tenha partido da parcela 3 de 12 (pedido de 29/09/2026: todos
      os campos editáveis; antes isto devolvia 422);
    - recorrente: esta ocorrência e as seguintes da série. Informar parcelas
      numa recorrência a converte, deste mês em diante, em parcelamento —
      sem remover as futuras, elas duplicariam as parcelas novas;
    - avulso: só ele (caso da despesa importada do extrato).
    """
    from fastapi import HTTPException

    atual = (
        db.table("despesas")
        .select("id, valor, competencia, data_vencimento, parcela_atual, parcela_total, "
                "grupo_parcelamento, paga_em, status, descricao, recorrente, "
                "tipo_lancamento_id, criado_por")
        .eq("id", str(despesa_id))
        .neq("status", "excluida")
        .single()
        .execute()
    )
    linha = atual.data
    grupo = linha.get("grupo_parcelamento")
    total_atual = linha.get("parcela_total") or 1

    if novo_n == total_atual:
        return None

    cols = "id, valor, competencia, data_vencimento, paga_em, parcela_atual, status"
    if grupo:
        irmas = (
            db.table("despesas").select(cols)
            .eq("grupo_parcelamento", grupo)
            .neq("status", "excluida")
            .order("competencia")
            .execute()
        ).data or []
    elif linha.get("recorrente") and not linha.get("parcela_total"):
        # Mesma correlação que deletar_despesa usa para "esta e as futuras":
        # recorrência não tem marcador de grupo.
        q = (
            db.table("despesas").select(cols)
            .eq("descricao", linha["descricao"])
            .eq("recorrente", True)
            .is_("parcela_total", "null")
            .neq("status", "excluida")
            .gt("competencia", linha["competencia"])
        )
        if linha.get("tipo_lancamento_id"):
            q = q.eq("tipo_lancamento_id", str(linha["tipo_lancamento_id"]))
        if linha.get("criado_por"):
            q = q.eq("criado_por", str(linha["criado_por"]))
        irmas = [linha] + ((q.order("competencia").execute()).data or [])
    else:
        irmas = [linha]

    ancora = irmas[0] if irmas else linha
    demais = [r for r in irmas if r["id"] != ancora["id"]]

    # Parcelas já pagas não podem ser descartadas: o dinheiro saiu e o
    # lançamento é o registro disso. A âncora é exceção — ela permanece.
    pagas = [r for r in demais if r.get("paga_em")]
    if pagas:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Este grupo tem {len(pagas)} parcela(s) já paga(s) além da primeira. "
                "Exclua ou ajuste essas parcelas antes de reparcelar."
            ),
        )
    # Quem não aprova não pode, reparcelando, descartar o que já foi aprovado
    # — seria um atalho para contornar a regra de exclusão.
    if preservar_aprovadas:
        aprovadas = [r for r in demais if r.get("status") == "aprovada"]
        if aprovadas:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Este grupo tem {len(aprovadas)} parcela(s) já aprovada(s). "
                    "Só Admin ou Gestor podem refazer o parcelamento."
                ),
            )

    soma_atual = sum((_dec(r["valor"]) for r in irmas), Decimal("0"))
    valor_parcela = (
        _quantizar(valor_informado) if valor_informado is not None
        else _quantizar(soma_atual / novo_n)
    )

    return {
        "novo_n":         novo_n,
        "grupo":          (grupo or str(uuid4())) if novo_n > 1 else None,
        "valor_parcela":  valor_parcela,
        "ancora_id":      ancora["id"],
        "ancora_paga":    bool(ancora.get("paga_em")),
        "ancora_status":  ancora.get("status"),
        "remover":        [r["id"] for r in demais],
    }


def _executar_reparcelamento(plano: dict, ancora: dict, db: Client) -> None:
    """Remove as irmãs antigas e cria as novas, espelhando a âncora já atualizada.

    A âncora (parcela 1) permanece — preserva id, histórico e o `paga_em` da
    cobrança que originou o parcelamento. As demais são recriadas do zero:
    tentar casar linha a linha renderia pouco e complicaria muito, já que o
    número de parcelas mudou justamente porque o desenho anterior estava errado.
    """
    remover = plano["remover"]
    if remover:
        # Soft-delete: o DRE de meses fechados não pode perder o histórico.
        db.table("despesas").update({"status": "excluida"}).in_("id", remover).execute()

    n = plano["novo_n"]
    if n <= 1:
        return

    base = {
        "descricao":          ancora["descricao"],
        "subcategoria":       ancora.get("subcategoria"),
        "categoria":          ancora.get("categoria"),
        "valor":              str(plano["valor_parcela"]),
        "centro_custo":       ancora.get("centro_custo"),
        "tipo_lancamento_id": ancora.get("tipo_lancamento_id"),
        "custo_tipo":         ancora.get("custo_tipo"),
        "banco_id":           ancora.get("banco_id"),
        "criado_por":         ancora.get("criado_por"),
        "tenant_id":          ancora.get("tenant_id"),
        "grupo_parcelamento": plano["grupo"],
        "parcela_total":      n,
        "recorrente":         False,
        # Parcela futura nunca nasce paga nem aprovada — segue a fila normal.
        "status":             "pendente",
    }

    base_comp = date.fromisoformat(ancora["competencia"][:10])
    base_venc = (date.fromisoformat(ancora["data_vencimento"][:10])
                 if ancora.get("data_vencimento") else None)
    novas = []
    for i in range(1, n):
        p = dict(base)
        p["parcela_atual"] = i + 1
        # Base = âncora já atualizada: se a mesma edição mudou a competência,
        # as parcelas seguem a data nova (antes seguiam a antiga).
        p["competencia"]   = _somar_meses(base_comp, i).isoformat()
        if base_venc:
            p["data_vencimento"] = _somar_meses_preservando_dia(base_venc, i).isoformat()
        novas.append(p)

    # Um único INSERT: ou todas as parcelas entram, ou nenhuma entra.
    db.table("despesas").insert(novas).execute()


async def atualizar_despesa(
    despesa_id: UUID, payload: DespesaUpdate, db: Client, preservar_aprovadas: bool = False,
    usuario: UsuarioAtual | None = None,
) -> DespesaItem:
    campos: dict = {}
    set_fields = payload.model_fields_set
    if "descricao" in set_fields and payload.descricao:
        campos["descricao"] = payload.descricao
    if "subcategoria" in set_fields and payload.subcategoria:
        campos["subcategoria"] = payload.subcategoria
    if "valor" in set_fields and payload.valor is not None:
        campos["valor"] = str(payload.valor)
    if "competencia" in set_fields and payload.competencia:
        campos["competencia"] = payload.competencia.isoformat()
    if "data_vencimento" in set_fields:
        campos["data_vencimento"] = payload.data_vencimento.isoformat() if payload.data_vencimento else None
    if "paga_em" in set_fields:
        campos["paga_em"] = payload.paga_em.isoformat() if payload.paga_em else None
    if "centro_custo" in set_fields and payload.centro_custo:
        campos["centro_custo"] = payload.centro_custo
    if "tipo_lancamento_id" in set_fields:
        campos["tipo_lancamento_id"] = str(payload.tipo_lancamento_id) if payload.tipo_lancamento_id else None
    if "custo_tipo" in set_fields:
        if payload.custo_tipo:
            classificacao_service.validar(db, payload.custo_tipo)
        campos["custo_tipo"] = payload.custo_tipo or None
    if "banco_id" in set_fields:
        campos["banco_id"] = str(payload.banco_id) if payload.banco_id else None

    from fastapi import HTTPException

    # Estado anterior: decide se a edição volta para aprovação e distingue
    # "não existe" de "existe mas a RLS barrou" — ver o bloco de erro abaixo.
    atual = (
        db.table("despesas")
        .select("id, paga_em, status")
        .eq("id", str(despesa_id))
        .neq("status", "excluida")
        .execute()
    )
    if not atual.data:
        raise HTTPException(status_code=404, detail="Despesa não encontrada.")

    ja_paga = bool(atual.data[0].get("paga_em"))
    status_atual = atual.data[0].get("status")

    # Reparcelamento: planeja antes de gravar. O plano só é EXECUTADO depois
    # que a âncora é atualizada, para que as parcelas novas herdem as edições
    # feitas nesta mesma requisição (descrição, subitem, centro de custo...).
    plano = None
    alvo_id = despesa_id
    if "num_parcelas" in set_fields and payload.num_parcelas:
        plano = await _plano_reparcelamento(
            despesa_id, payload.num_parcelas, payload.valor, db,
            preservar_aprovadas=preservar_aprovadas,
        )
        if plano:
            alvo_id = UUID(plano["ancora_id"])
            if alvo_id != despesa_id:
                # Editou-se uma parcela do meio: o grupo é refeito a partir da
                # 1ª. Competência/vencimento/pagamento do formulário descrevem
                # a parcela editada, não a 1ª — aplicá-los à âncora deslocaria
                # o grupo inteiro para a data da parcela do meio.
                for k in ("competencia", "data_vencimento", "paga_em"):
                    campos.pop(k, None)
            n = plano["novo_n"]
            campos["parcela_atual"]      = 1 if n > 1 else None
            campos["parcela_total"]      = n if n > 1 else None
            campos["grupo_parcelamento"] = plano["grupo"]
            campos["valor"]              = str(plano["valor_parcela"])
            campos["recorrente"]         = False

    # Status de quem é de fato gravado (a âncora, se o grupo foi refeito):
    # com Data de Pagamento fica aprovada, qualquer que seja o perfil (regra de
    # 19/10/2026); sem ela, editou volta para aprovação. Já aprovada e paga
    # mantém o aprovador original.
    if alvo_id != despesa_id:
        paga_final, status_alvo = plano["ancora_paga"], plano.get("ancora_status")
    else:
        paga_final = campos["paga_em"] if "paga_em" in campos else ja_paga
        status_alvo = status_atual
    if paga_final:
        if status_alvo != "aprovada":
            campos.update(aprovacao_por_pagamento(usuario.user_id if usuario else None))
    else:
        campos["status"] = "pendente"

    resp = (
        db.table("despesas")
        .update(campos)
        .eq("id", str(alvo_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        # A linha existe (o SELECT acima achou) mas o UPDATE afetou 0 linhas:
        # a policy despesas_update barrou. Antes isto virava 404 "não
        # encontrada", mensagem que escondeu por semanas um problema de
        # permissão — quem investigava procurava o registro, não o acesso.
        raise HTTPException(
            status_code=403,
            detail="Seu perfil não tem permissão para editar este lançamento.",
        )

    full = (
        db.table("despesas")
        .select(
            "id, categoria, subcategoria, descricao, valor, competencia, "
            "data_vencimento, paga_em, centro_custo, recorrente, parcela_atual, parcela_total, "
            "criado_em, atualizado_em, tipo_lancamento_id, banco_id, "
            "status, criado_por, aprovado_por, aprovado_em, rejeitado_motivo, "
            "tenant_id, grupo_parcelamento, "
            "custo_tipo, subitens_lancamento(nome), bancos(nome)"
        )
        .eq("id", str(alvo_id))
        .single()
        .execute()
    )
    row = full.data

    if plano:
        _executar_reparcelamento(plano, row, db)
    return DespesaItem(
        id=row["id"],
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        custo_tipo=row.get("custo_tipo"),
        tipo_nome=(row.get("subitens_lancamento") or {}).get("nome"),
        banco_id=row.get("banco_id"),
        banco_nome=(row.get("bancos") or {}).get("nome"),
        categoria=row.get("categoria"),
        subcategoria=row.get("subcategoria", ""),
        descricao=row["descricao"],
        valor=_dec(row["valor"]),
        competencia=row["competencia"],
        data_vencimento=row.get("data_vencimento"),
        paga_em=row.get("paga_em"),
        centro_custo=row.get("centro_custo", "matriz"),
        recorrente=bool(row.get("recorrente", False)),
        parcela_atual=row.get("parcela_atual"),
        parcela_total=row.get("parcela_total"),
        criado_em=row.get("criado_em"),
            atualizado_em=row.get("atualizado_em"),
        status=row.get("status", "pendente"),
        criado_por=row.get("criado_por"),
        aprovado_por=row.get("aprovado_por"),
        aprovado_em=row.get("aprovado_em"),
        rejeitado_motivo=row.get("rejeitado_motivo"),
    )


async def deletar_despesa(
    despesa_id: UUID,
    db: Client,
    excluir_futuras: bool = False,
    preservar_aprovadas: bool = False,
) -> None:
    """Soft-delete (status='excluida'), opcionalmente com as irmãs futuras.

    `preservar_aprovadas` existe para quem NÃO é admin/gestor: essa pessoa
    pode excluir o próprio lançamento enquanto ele não foi aprovado, mas
    "esta e as futuras" não pode levar junto uma parcela que já passou pela
    aprovação — aprovada, só admin/gestor remove (ver deletar_despesa no
    router).
    """
    def _irmas(q):
        q = q.neq("status", "excluida")
        return q.neq("status", "aprovada") if preservar_aprovadas else q

    # Busca a despesa antes de excluir para identificar parcelas/ocorrências irmãs
    if excluir_futuras:
        resp = db.table("despesas").select(
            "tipo_lancamento_id, descricao, valor, parcela_total, recorrente, competencia, "
            "criado_por, grupo_parcelamento"
        ).eq("id", str(despesa_id)).neq("status", "excluida").maybe_single().execute()

        if resp and getattr(resp, "data", None):
            row = resp.data

            # Caminho preferencial (migration 0035): o grupo é explícito, então
            # a exclusão não depende de os campos continuarem iguais entre as
            # irmãs. A heurística abaixo fica só para grupos anteriores ao
            # backfill e para recorrências, que não têm marcador.
            if row.get("grupo_parcelamento"):
                _irmas(
                    db.table("despesas").update({"status": "excluida"})
                    .eq("grupo_parcelamento", row["grupo_parcelamento"])
                    .gt("competencia", row["competencia"])
                ).execute()
                db.table("despesas").update({"status": "excluida"}).eq("id", str(despesa_id)).execute()
                return

            eh_parcelamento = bool(row.get("parcela_total") and row["parcela_total"] > 1)
            # Grupo de recorrência (repetir_ate): recorrente=true e sem parcela_total,
            # já que parcelamento e recorrência são mutuamente exclusivos na criação.
            eh_recorrencia = bool(row.get("recorrente")) and not eh_parcelamento

            if eh_parcelamento or eh_recorrencia:
                # Exclui todas as parcelas/ocorrências futuras do mesmo grupo
                q = _irmas(
                    db.table("despesas").update({"status": "excluida"})
                    .eq("descricao", row["descricao"])
                    .gt("competencia", row["competencia"])
                )
                if eh_parcelamento:
                    q = q.eq("parcela_total", row["parcela_total"])
                else:
                    q = q.eq("recorrente", True).is_("parcela_total", "null")
                if row.get("tipo_lancamento_id"):
                    q = q.eq("tipo_lancamento_id", str(row["tipo_lancamento_id"]))
                if row.get("criado_por"):
                    q = q.eq("criado_por", str(row["criado_por"]))
                q.execute()

    db.table("despesas").update({"status": "excluida"}).eq("id", str(despesa_id)).execute()


# ── Receitas (comissões + manuais) ────────────────────────────

async def buscar_receitas(
    inicio: date,
    fim: date,
    usuario: UsuarioAtual,
    db: Client,
    centro_custo: str | None = None,
    banco_id: str | None = None,
    busca: str | None = None,
    ordenar_por: str = "competencia",
    ordem_desc: bool = True,
    status_filter: str | None = None,
    base: str = "competencia",
    categoria_id: str | None = None,
    tipo_lancamento_id: str | None = None,
) -> ReceitasResponse:
    from app.services.periodo_base import coluna_data, ids_do_tipo
    ids_tipo = ids_do_tipo(db, categoria_id, tipo_lancamento_id)
    items: list[ReceitaItem] = []
    soma_comissoes = Decimal(0)
    soma_manuais   = Decimal(0)
    termo = _termo_busca(busca)
    termo_lower = termo.lower() if termo else None

    # Regra de visibilidade:
    # Admin/Gestor: veem tudo (comissões + todas as receitas manuais)
    # Contador/Comercial: veem apenas receitas manuais que eles próprios criaram
    ver_tudo = usuario.role in ("admin", "gestor")

    # 1. Comissões (ETL / automáticas) — apenas Admin e Gestor
    q_com = (
        db.table("comissoes")
        .select("id, valor, competencia, recebida_em, tipo, apolice_id")
        .gte(coluna_data("comissoes", base), inicio.isoformat())
        .lte(coluna_data("comissoes", base), fim.isoformat())
        .order("competencia", desc=True)
    )
    # Comissões não têm status (nem banco/centro): com qualquer desses filtros
    # ativos, saem da lista em vez de aparecer como se atendessem ao filtro.
    incluir_comissoes = ver_tudo and not banco_id and not centro_custo and not status_filter and ids_tipo is None

    # 2. Receitas manuais — a query é construída ANTES de executar as duas
    # fontes, para que comissões e manuais rodem em paralelo (gather abaixo)
    q_rec = (
        db.table("receitas_outras")
        .select(
            "id, descricao, valor, competencia, data_vencimento, recebido_em, centro_custo, atualizado_em, status, "
            "observacao, tipo_lancamento_id, banco_id, criado_por, criado_em, "
            "custo_tipo, subitens_lancamento(nome), bancos(nome)"
        )
        .gte(coluna_data("receitas_outras", base), inicio.isoformat())
        .lte(coluna_data("receitas_outras", base), fim.isoformat())
        .order("competencia", desc=True)
    )
    if ids_tipo is not None:
        q_rec = q_rec.in_("tipo_lancamento_id", ids_tipo)
    # Contador e Comercial veem apenas as próprias receitas manuais
    if not ver_tudo:
        q_rec = q_rec.eq("criado_por", usuario.user_id)
    if centro_custo:
        q_rec = q_rec.eq("centro_custo", centro_custo.strip())
    if banco_id:
        q_rec = q_rec.eq("banco_id", banco_id)
    if status_filter:
        q_rec = q_rec.eq("status", status_filter)
    if termo:
        q_rec = q_rec.ilike("descricao_busca", f"%{termo}%")

    if incluir_comissoes:
        resp_com, resp_rec = await asyncio.gather(_exec(q_com), _exec(q_rec))
    else:
        resp_com = None
        resp_rec = await _exec(q_rec)

    # 1. Comissões (ETL / automáticas) — apenas Admin e Gestor
    if resp_com is not None:
        for row in (resp_com.data or []):
            # A descrição da comissão é montada aqui, não existe como coluna —
            # por isso a busca nela é filtrada em memória, e não no banco.
            if termo_lower and termo_lower not in f"comissão — {row.get('tipo', 'padrão')}".lower():
                continue
            v = _dec(row["valor"])
            soma_comissoes += v
            items.append(ReceitaItem(
                id=row["id"],
                origem="comissao",
                tipo_nome=row.get("tipo"),
                descricao=f"Comissão — {row.get('tipo', 'padrão')}",
                valor=v,
                competencia=row["competencia"],
                recebido_em=row.get("recebida_em"),
                centro_custo="matriz",
            ))

    # Subitens "Constar apenas na DRE": a receita aparece na lista, com
    # etiqueta, mas fica fora dos totais (regra de 22/10/2026).
    from app.services.somente_dre import ids_somente_dre
    so_dre = await ids_somente_dre(db)

    for row in (resp_rec.data or []):
        v = _dec(row["valor"])
        apenas_dre = row.get("tipo_lancamento_id") in so_dre
        if not apenas_dre:
            soma_manuais += v
        tipo_nome  = (row.get("subitens_lancamento") or {}).get("nome")
        banco_nome = (row.get("bancos") or {}).get("nome")
        items.append(ReceitaItem(
            id=row["id"],
            origem="manual",
            status=row.get("status"),
            tipo_lancamento_id=row.get("tipo_lancamento_id"),
            custo_tipo=row.get("custo_tipo"),
            tipo_nome=tipo_nome,
            banco_id=row.get("banco_id"),
            banco_nome=banco_nome,
            descricao=row["descricao"],
            valor=v,
            competencia=row["competencia"],
            data_vencimento=row.get("data_vencimento"),
            recebido_em=row.get("recebido_em"),
            centro_custo=row.get("centro_custo", "matriz"),
            observacao=row.get("observacao"),
            criado_em=row.get("criado_em"),
            atualizado_em=row.get("atualizado_em"),
            somente_dre=apenas_dre,
        ))

    # A lista é a união de duas fontes (comissões + manuais), então a ordenação
    # acontece aqui em memória e não no banco.
    campo = _COLUNAS_ORDEM_RECEITA.get(ordenar_por, "competencia")
    com_valor = [i for i in items if getattr(i, campo, None) is not None]
    sem_valor = [i for i in items if getattr(i, campo, None) is None]
    if campo == "valor":
        com_valor.sort(key=lambda x: _dec(getattr(x, campo)), reverse=ordem_desc)
    else:
        com_valor.sort(key=lambda x: str(getattr(x, campo)), reverse=ordem_desc)
    # Ausentes sempre no fim, independentemente da direção — mesma regra que a
    # tela aplicava quando ordenava em memória.
    items = com_valor + sem_valor

    return ReceitasResponse(
        total=len(items),
        items=items,
        soma_comissoes=soma_comissoes,
        soma_manuais=soma_manuais,
        soma_total=soma_comissoes + soma_manuais,
    )


async def criar_receita_outra(
    payload: ReceitaOutraCreate,
    usuario: UsuarioAtual,
    db: Client,
) -> ReceitaItem:
    _verificar_periodo_aberto(payload.competencia, db)

    db_admin = get_supabase_admin()

    # Recorrência: meses a criar (1º dia de cada mês, de competencia até repetir_ate)
    meses_recorrencia: list[date] = [date(payload.competencia.year, payload.competencia.month, 1)]
    if payload.repetir_ate and payload.repetir_ate >= payload.competencia:
        n_meses = (
            (payload.repetir_ate.year - payload.competencia.year) * 12
            + (payload.repetir_ate.month - payload.competencia.month) + 1
        )
        if n_meses > 60:
            from fastapi import HTTPException, status as http_status
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Recorrência limitada a 60 meses.",
            )
        meses_recorrencia = [_somar_meses(payload.competencia, i) for i in range(n_meses)]

    dados: dict = {
        "descricao":    payload.descricao,
        "valor":        str(payload.valor),
        "competencia":  payload.competencia.isoformat(),
        "centro_custo": payload.centro_custo,
        "criado_por":   usuario.user_id,
    }
    if getattr(usuario, "tenant_id", None):
        dados["tenant_id"] = usuario.tenant_id
    if payload.tipo_lancamento_id:
        dados["tipo_lancamento_id"] = str(payload.tipo_lancamento_id)
    if payload.custo_tipo:
        classificacao_service.validar(db, payload.custo_tipo)
        dados["custo_tipo"] = payload.custo_tipo
    if payload.banco_id:
        dados["banco_id"] = str(payload.banco_id)
    if payload.data_vencimento:
        dados["data_vencimento"] = payload.data_vencimento.isoformat()
    if payload.recebido_em:
        dados["recebido_em"] = payload.recebido_em.isoformat()
    if payload.observacao:
        dados["observacao"] = payload.observacao
    # Receita não passa por aprovação (decisão de 22/10/2026): toda receita
    # lançada já nasce aprovada, em qualquer perfil e em toda ocorrência.
    dados.update(campos_aprovacao(usuario.user_id))

    # Recorrência atômica: um registro por mês em um único INSERT.
    # Todos gravam ou nenhum grava — sem risco de criação parcial.
    if len(meses_recorrencia) > 1:
        registros = []
        for i, mes in enumerate(meses_recorrencia):
            r = dict(dados)
            r["competencia"] = mes.isoformat()
            if payload.data_vencimento:
                r["data_vencimento"] = _somar_meses_preservando_dia(payload.data_vencimento, i).isoformat()
            # A data informada vale para a 1ª ocorrência; as demais são
            # recebidas (e datadas) mês a mês, pela edição do lançamento.
            if i > 0:
                r.pop("recebido_em", None)
            registros.append(r)
        resp = db_admin.table("receitas_outras").insert(registros).execute()
    else:
        resp = db_admin.table("receitas_outras").insert(dados).execute()
    row = resp.data[0]

    tipo_nome  = None
    banco_nome = None
    if payload.tipo_lancamento_id:
        r = db.table("subitens_lancamento").select("nome").eq(
            "id", str(payload.tipo_lancamento_id)
        ).single().execute()
        tipo_nome = (r.data or {}).get("nome")
    if payload.banco_id:
        r = db.table("bancos").select("nome").eq(
            "id", str(payload.banco_id)
        ).single().execute()
        banco_nome = (r.data or {}).get("nome")

    return ReceitaItem(
        id=row["id"],
        origem="manual",
        status=row.get("status"),
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        custo_tipo=row.get("custo_tipo"),
        tipo_nome=tipo_nome,
        banco_id=row.get("banco_id"),
        banco_nome=banco_nome,
        descricao=row["descricao"],
        valor=_dec(row["valor"]),
        competencia=row["competencia"],
        data_vencimento=row.get("data_vencimento"),
        recebido_em=row.get("recebido_em"),
        centro_custo=row.get("centro_custo", "matriz"),
        observacao=row.get("observacao"),
    )


async def _obter_receita_item(receita_id: UUID, db_admin) -> ReceitaItem:
    """Le a receita completa e monta o ReceitaItem.

    Extraido de atualizar_receita_outra, que montava isto inline — as tres
    funcoes (atualizar, aprovar, rejeitar) precisam do mesmo retorno.
    """
    full = (
        db_admin.table("receitas_outras")
        .select("id, descricao, valor, competencia, data_vencimento, recebido_em, centro_custo, atualizado_em, status, "
                "observacao, tipo_lancamento_id, banco_id, custo_tipo, subitens_lancamento(nome), bancos(nome)")
        .eq("id", str(receita_id))
        .single()
        .execute()
    )
    row = full.data
    return ReceitaItem(
        id=row["id"],
        origem="manual",
        status=row.get("status"),
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        custo_tipo=row.get("custo_tipo"),
        tipo_nome=(row.get("subitens_lancamento") or {}).get("nome"),
        banco_id=row.get("banco_id"),
        banco_nome=(row.get("bancos") or {}).get("nome"),
        descricao=row["descricao"],
        valor=_dec(row["valor"]),
        competencia=row["competencia"],
        data_vencimento=row.get("data_vencimento"),
        recebido_em=row.get("recebido_em"),
        centro_custo=row.get("centro_custo", "matriz"),
        observacao=row.get("observacao"),
    )


async def aprovar_receita_outra(receita_id: UUID, usuario: UsuarioAtual, db: Client) -> ReceitaItem:
    """Espelha aprovar_despesa. A coluna status em receitas_outras nasceu na
    migration 0032 — antes disso receita nao passava por aprovacao nenhuma."""
    from datetime import datetime, timezone

    from fastapi import HTTPException

    db_admin = get_supabase_admin()
    resp = (
        db_admin.table("receitas_outras")
        .update({
            "status":       "aprovada",
            "aprovado_por": usuario.user_id,
            "aprovado_em":  datetime.now(timezone.utc).isoformat(),
        })
        .eq("id", str(receita_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Receita nao encontrada.")
    return await _obter_receita_item(receita_id, db_admin)


async def rejeitar_receita_outra(
    receita_id: UUID,
    motivo: str,
    usuario: UsuarioAtual,
    db: Client,
) -> ReceitaItem:
    from fastapi import HTTPException

    db_admin = get_supabase_admin()
    resp = (
        db_admin.table("receitas_outras")
        .update({
            "status":           "rejeitada",
            "aprovado_por":     usuario.user_id,
            "rejeitado_motivo": motivo,
        })
        .eq("id", str(receita_id))
        .neq("status", "excluida")
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Receita nao encontrada.")
    return await _obter_receita_item(receita_id, db_admin)


async def atualizar_receita_outra(
    receita_id: UUID, payload: ReceitaOutraUpdate, db: Client, usuario: UsuarioAtual | None = None,
) -> ReceitaItem:
    db_admin = get_supabase_admin()
    campos: dict = {}
    set_fields = payload.model_fields_set
    if "descricao" in set_fields and payload.descricao:
        campos["descricao"] = payload.descricao
    if "valor" in set_fields and payload.valor is not None:
        campos["valor"] = str(payload.valor)
    if "competencia" in set_fields and payload.competencia:
        campos["competencia"] = payload.competencia.isoformat()
    if "data_vencimento" in set_fields:
        campos["data_vencimento"] = payload.data_vencimento.isoformat() if payload.data_vencimento else None
    if "recebido_em" in set_fields:
        campos["recebido_em"] = payload.recebido_em.isoformat() if payload.recebido_em else None
    if "centro_custo" in set_fields and payload.centro_custo:
        campos["centro_custo"] = payload.centro_custo
    if "observacao" in set_fields:
        campos["observacao"] = payload.observacao
    if "tipo_lancamento_id" in set_fields:
        campos["tipo_lancamento_id"] = str(payload.tipo_lancamento_id) if payload.tipo_lancamento_id else None
    if "custo_tipo" in set_fields:
        if payload.custo_tipo:
            classificacao_service.validar(db, payload.custo_tipo)
        campos["custo_tipo"] = payload.custo_tipo or None
    if "banco_id" in set_fields:
        campos["banco_id"] = str(payload.banco_id) if payload.banco_id else None

    from fastapi import HTTPException

    atual = (
        db_admin.table("receitas_outras")
        .select("id, recebido_em, status")
        .eq("id", str(receita_id))
        .neq("status", "excluida")
        .execute()
    )
    if not atual.data:
        raise HTTPException(status_code=404, detail="Receita não encontrada.")

    # Receita não passa por aprovação (22/10/2026): editar não a devolve para
    # pendente. Resíduo pendente/rejeitada vira aprovada; já aprovada mantém o
    # aprovador original.
    if atual.data[0].get("status") != "aprovada":
        campos.update(campos_aprovacao(usuario.user_id if usuario else None))

    resp = db_admin.table("receitas_outras").update(campos).eq("id", str(receita_id)).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Receita não encontrada.")

    full = (
        db_admin.table("receitas_outras")
        .select("id, descricao, valor, competencia, data_vencimento, recebido_em, centro_custo, atualizado_em, status, "
                "observacao, tipo_lancamento_id, banco_id, custo_tipo, subitens_lancamento(nome), bancos(nome)")
        .eq("id", str(receita_id))
        .single()
        .execute()
    )
    row = full.data
    return ReceitaItem(
        id=row["id"],
        origem="manual",
        status=row.get("status"),
        tipo_lancamento_id=row.get("tipo_lancamento_id"),
        custo_tipo=row.get("custo_tipo"),
        tipo_nome=(row.get("subitens_lancamento") or {}).get("nome"),
        banco_id=row.get("banco_id"),
        banco_nome=(row.get("bancos") or {}).get("nome"),
        descricao=row["descricao"],
        valor=_dec(row["valor"]),
        competencia=row["competencia"],
        data_vencimento=row.get("data_vencimento"),
        recebido_em=row.get("recebido_em"),
        centro_custo=row.get("centro_custo", "matriz"),
        observacao=row.get("observacao"),
    )


async def deletar_receita_outra(receita_id: UUID, db: Client, excluir_futuras: bool = False) -> None:
    # Espelha o comportamento de despesas: receitas recorrentes (repetir_ate)
    # criam N linhas irmãs sem marcador de grupo — a correlação é por
    # descricao + tipo_lancamento_id + criado_por + competencia futura.
    if excluir_futuras:
        resp = db.table("receitas_outras").select(
            "descricao, tipo_lancamento_id, criado_por, competencia"
        ).eq("id", str(receita_id)).maybe_single().execute()

        if resp and getattr(resp, "data", None):
            row = resp.data
            q = db.table("receitas_outras").delete() \
                .eq("descricao", row["descricao"]) \
                .gt("competencia", row["competencia"])
            if row.get("tipo_lancamento_id"):
                q = q.eq("tipo_lancamento_id", str(row["tipo_lancamento_id"]))
            else:
                q = q.is_("tipo_lancamento_id", "null")
            if row.get("criado_por"):
                q = q.eq("criado_por", str(row["criado_por"]))
            q.execute()

    db.table("receitas_outras").delete().eq("id", str(receita_id)).execute()
