"""
MX Seguros — DRE-IA | Serviço de Lançamentos e Configurações Financeiras.

Gerencia CRUD de despesas manuais, receitas_outras,
bancos, centros de custo e tipos de lançamento.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
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

# Hierarquia (0044): grupo (parent_id NULL) › subgrupo. O lançamento guarda o
# CODIGO do centro; grupo com subgrupos não recebe lançamento, e filtrar por
# um grupo traz os lançamentos dos seus subgrupos (ver expandir_centro).

_COLS_CENTRO = "id, nome, codigo, ativo"
_COLS_CENTRO_HIER = _COLS_CENTRO + ", parent_id, numero, ordem"


def _erro_centro(codigo: int, msg: str):
    from fastapi import HTTPException
    return HTTPException(status_code=codigo, detail=msg)


def _ler_centros(db: Client, tenant_id: str | None = None) -> list[dict]:
    """Centros visíveis (com o client admin, passe o tenant: ele ignora a RLS).
    Sem a migration 0044, vêm sem as colunas novas."""
    for cols in (_COLS_CENTRO_HIER, _COLS_CENTRO):
        try:
            q = db.table("centros_custo").select(cols)
            if tenant_id:
                q = q.eq("tenant_id", tenant_id)
            return q.execute().data or []
        except Exception:  # noqa: BLE001 — coluna ainda não criada
            continue
    return []


def _slug(texto: str) -> str:
    import re
    s = _sem_acento(texto).lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:40] or "centro"


def _chave_ordem(c: dict):
    # "1.21" antes de "1.3": ordena número por partes numéricas; sem número, pelo nome.
    num = (c.get("numero") or "").strip()
    partes = []
    for p in num.replace("-", ".").split("."):
        partes.append((0, int(p), "") if p.isdigit() else (1, 0, p))
    return (0 if num else 1, partes, c.get("ordem") or 0, (c.get("nome") or "").lower())


def numero_sub(grupo_numero: str | None, k: int) -> str | None:
    """Número do k-ésimo subgrupo (k a partir de 1).

    Regra de 28/11/2026 (substitui a de 24/11): uma só sequência dentro de cada
    número de grupo, começando em 11 — grupo "1" → 1.11, 1.12, 1.13…; grupo
    "2" → 2.11, 2.12… (1.19 → 1.20, sem pular para o grupo seguinte).
    Grupo com número decimal (legado, ex. "1.10") soma k na última casa:
    1.11 … 1.19, 1.20…
    Grupo sem número (ou com número fora do padrão): None."""
    import re
    from decimal import Decimal
    g = (grupo_numero or "").strip()
    if re.fullmatch(r"\d+", g):
        return f"{int(g)}.{10 + k}"
    if not re.fullmatch(r"\d+\.\d+", g):
        return None
    casas = len(g.partition(".")[2])
    return f"{Decimal(g) + Decimal(k).scaleb(-casas):.{casas}f}"


def _garantir_numero_livre(numero: str | None, centros: list[dict], proprio_id: str | None = None) -> None:
    if numero and any((c.get("numero") or "").strip() == numero and c.get("id") != proprio_id for c in centros):
        raise _erro_centro(409, f"O número {numero} já está em uso por outro centro.")


def renumerar_grupo(
    db: Client, grupo_id: str | None, tenant_id: str | None, ordem_ids: list[str] | None = None,
) -> None:
    """Renumera os subgrupos de um grupo em sequência (1.11, 1.12…), na ordem
    atual — ou em `ordem_ids`, quando vem de "mover". Excluiu o 1.18, o 1.19 vira
    1.18; criou, entra no fim. Lançamentos guardam o CODIGO, não o número: nada
    muda neles. Grupo sem número não é renumerado."""
    if not grupo_id:
        return
    centros = _ler_centros(db, tenant_id)
    grupo = next((c for c in centros if c.get("id") == str(grupo_id)), None)
    if not grupo or numero_sub(grupo.get("numero"), 1) is None:
        return
    subs = sorted((c for c in centros if c.get("parent_id") == str(grupo_id)), key=_chave_ordem)
    if ordem_ids:
        pos = {i: n for n, i in enumerate(ordem_ids)}
        subs.sort(key=lambda c: pos.get(c["id"], len(pos)))
    ids = {c["id"] for c in subs}
    fora = {(c.get("numero") or "").strip(): c for c in centros if c.get("id") not in ids}
    novos = [(c, numero_sub(grupo["numero"], k)) for k, c in enumerate(subs, start=1)]
    for c, num in novos:
        if num in fora:
            raise _erro_centro(
                409,
                f"O número {num} já é de '{fora[num]['nome']}'. Mude o número de um dos grupos "
                "para os subgrupos caberem.",
            )
    for c, num in novos:
        if (c.get("numero") or "").strip() != num:
            q = db.table("centros_custo").update({"numero": num}).eq("id", c["id"])
            if tenant_id:
                q = q.eq("tenant_id", tenant_id)
            q.execute()


async def renumerar_todos(usuario: UsuarioAtual, db: Client) -> list[CentroCustoItem]:
    """Reorganiza a numeração de TODOS os grupos numerados pela regra vigente
    (botão "Reorganizar numeração" em Configurações). Idempotente."""
    tenant = getattr(usuario, "tenant_id", None)
    centros = _ler_centros(db, tenant)
    grupos = sorted(
        (c for c in centros if not c.get("parent_id") and any(f.get("parent_id") == c["id"] for f in centros)),
        key=_chave_ordem,
    )
    for g in grupos:
        renumerar_grupo(db, g["id"], tenant)
    return await listar_centros_custo(db)


def _centro_atual(db: Client, centro_id: str, tenant_id: str | None) -> CentroCustoItem:
    linha = next((c for c in _ler_centros(db, tenant_id) if c.get("id") == str(centro_id)), None)
    if not linha:
        raise _erro_centro(404, "Centro de custo não encontrado.")
    return CentroCustoItem(**linha)


async def listar_centros_custo(db: Client) -> list[CentroCustoItem]:
    linhas = sorted(_ler_centros(db), key=_chave_ordem)
    return [CentroCustoItem(**r) for r in linhas]


def _validar_pai(
    db: Client, parent_id: UUID | None, tenant_id: str | None, proprio_id: UUID | None = None,
) -> None:
    """Só dois níveis: o pai tem de existir, ser raiz e não ser o próprio centro."""
    if not parent_id:
        return
    if proprio_id and str(parent_id) == str(proprio_id):
        raise _erro_centro(422, "Um centro não pode ser grupo de si mesmo.")
    centros = _ler_centros(db, tenant_id)
    pai = next((c for c in centros if c["id"] == str(parent_id)), None)
    if not pai:
        raise _erro_centro(422, "Grupo não encontrado.")
    if pai.get("parent_id"):
        raise _erro_centro(422, "Só há dois níveis: escolha um grupo principal, não um subgrupo.")
    if proprio_id and any(c.get("parent_id") == str(proprio_id) for c in centros):
        raise _erro_centro(422, "Este centro já tem subgrupos — ele não pode virar subgrupo de outro.")


async def criar_centro_custo(
    payload: CentroCustoCreate, usuario: UsuarioAtual, db: Client
) -> CentroCustoItem:
    tenant = getattr(usuario, "tenant_id", None)
    _validar_pai(db, payload.parent_id, tenant)
    centros = _ler_centros(db, tenant)
    existentes = {c["codigo"] for c in centros}
    numero = (payload.numero or "").strip() or None
    if payload.parent_id:
        # Subgrupo é numerado pelo grupo (renumerar_grupo, abaixo). Um número
        # informado só serve de posição: "1.15" entra depois do 1.14.
        pai = next((c for c in centros if c["id"] == str(payload.parent_id)), {})
        if numero_sub(pai.get("numero"), 1) is not None:
            numero = numero if numero and numero not in {(c.get("numero") or "") for c in centros} else None
        else:
            _garantir_numero_livre(numero, centros)
    else:
        _garantir_numero_livre(numero, centros)
    # Trim evita espaços acidentais no código/nome, que quebram o filtro por centro
    codigo = (payload.codigo or "").strip() or _slug(payload.nome)
    if codigo in existentes:
        if payload.codigo:
            raise _erro_centro(409, f"Já existe um centro com o código '{codigo}'.")
        base, n = codigo, 2
        while f"{base}_{n}" in existentes:
            n += 1
        codigo = f"{base}_{n}"
    dados: dict = {"nome": payload.nome.strip(), "codigo": codigo}
    # Sem tenant_id a RLS esconde o centro de todos os usuários (bug até 0044).
    if tenant:
        dados["tenant_id"] = tenant
    extras = {
        "parent_id": str(payload.parent_id) if payload.parent_id else None,
        "numero":    numero,
        "ordem":     payload.ordem,
    }
    try:
        resp = db.table("centros_custo").insert({**dados, **extras}).execute()
    except Exception:  # noqa: BLE001 — sem a 0044, grava sem hierarquia
        if payload.parent_id:
            raise
        resp = db.table("centros_custo").insert(dados).execute()
    if not payload.parent_id:
        return CentroCustoItem(**resp.data[0])
    renumerar_grupo(db, str(payload.parent_id), tenant)
    return _centro_atual(db, resp.data[0]["id"], tenant)


async def atualizar_centro_custo(
    centro_id: UUID, payload: CentroCustoUpdate, usuario: UsuarioAtual, db: Client
) -> CentroCustoItem:
    dados = payload.model_dump(exclude_none=True, exclude={"sem_grupo", "parent_id"})
    if isinstance(dados.get("nome"), str):
        dados["nome"] = dados["nome"].strip()
    if "numero" in dados:
        dados["numero"] = dados["numero"].strip() or None
    tenant = getattr(usuario, "tenant_id", None)
    centros = _ler_centros(db, tenant)
    atual = next((c for c in centros if c["id"] == str(centro_id)), {})
    pai_antigo = atual.get("parent_id")
    if payload.sem_grupo:
        dados["parent_id"] = None
    elif payload.parent_id:
        _validar_pai(db, payload.parent_id, tenant, centro_id)
        dados["parent_id"] = str(payload.parent_id)
    pai_novo = dados["parent_id"] if "parent_id" in dados else pai_antigo
    trocou_grupo = pai_novo != pai_antigo
    grupo_novo = next((c for c in centros if c["id"] == pai_novo), {}) if pai_novo else {}
    if pai_novo and numero_sub(grupo_novo.get("numero"), 1) is not None:
        # Subgrupo de grupo numerado: o número é automático. Mudou de grupo,
        # entra no fim do novo; senão, mantém o que tem (a ordem é por "mover").
        if trocou_grupo:
            dados["numero"] = None
        else:
            dados.pop("numero", None)
    elif "numero" in dados:
        _garantir_numero_livre(dados["numero"], centros, str(centro_id))
    q = db.table("centros_custo").update(dados).eq("id", str(centro_id))
    if getattr(usuario, "tenant_id", None):
        q = q.eq("tenant_id", usuario.tenant_id)
    resp = q.execute()
    if not resp.data:
        raise _erro_centro(404, "Centro de custo não encontrado.")
    if trocou_grupo:
        renumerar_grupo(db, pai_antigo, tenant)
        renumerar_grupo(db, pai_novo, tenant)
    elif not pai_novo and "numero" in dados and dados["numero"] != atual.get("numero"):
        renumerar_grupo(db, str(centro_id), tenant)   # grupo mudou de número: os filhos seguem
    elif pai_novo and atual.get("numero") is None:
        renumerar_grupo(db, pai_novo, tenant)
    return _centro_atual(db, str(centro_id), tenant)


async def mover_centro(centro_id: UUID, direcao: str, usuario: UsuarioAtual, db: Client) -> CentroCustoItem:
    """Sobe/desce o subgrupo uma posição dentro do grupo e renumera."""
    tenant = getattr(usuario, "tenant_id", None)
    centros = _ler_centros(db, tenant)
    alvo = next((c for c in centros if c.get("id") == str(centro_id)), None)
    if not alvo:
        raise _erro_centro(404, "Centro de custo não encontrado.")
    if not alvo.get("parent_id"):
        raise _erro_centro(422, "Só subgrupos mudam de posição; o grupo é ordenado pelo número.")
    irmaos = sorted((c for c in centros if c.get("parent_id") == alvo["parent_id"]), key=_chave_ordem)
    ids = [c["id"] for c in irmaos]
    i = ids.index(alvo["id"])
    j = i - 1 if direcao == "cima" else i + 1
    if 0 <= j < len(ids):
        ids[i], ids[j] = ids[j], ids[i]
        renumerar_grupo(db, alvo["parent_id"], tenant, ordem_ids=ids)
    return _centro_atual(db, str(centro_id), tenant)


async def excluir_centro_custo(centro_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    tenant = getattr(usuario, "tenant_id", None)
    centros = _ler_centros(db, tenant)
    alvo = next((c for c in centros if c["id"] == str(centro_id)), None)
    if not alvo:
        raise _erro_centro(404, "Centro de custo não encontrado.")
    if any(c.get("parent_id") == alvo["id"] for c in centros):
        raise _erro_centro(409, "Este grupo tem subgrupos — exclua ou mova os subgrupos antes.")
    for tabela in ("despesas", "receitas_outras"):
        q = db.table(tabela).select("id").eq("centro_custo", alvo["codigo"]).limit(1)
        if tenant:
            q = q.eq("tenant_id", tenant)
        if q.execute().data:
            raise _erro_centro(
                409, "Há lançamentos neste centro — desative-o em vez de excluir, para manter o histórico.",
            )
    q = db.table("centros_custo").delete().eq("id", alvo["id"])
    if tenant:
        q = q.eq("tenant_id", tenant)
    q.execute()
    # Excluiu o 1.8: o 1.9 vira 1.8, e assim por diante.
    renumerar_grupo(db, alvo.get("parent_id"), tenant)


def expandir_centro(db: Client, codigo: str) -> list[str]:
    """Códigos que um filtro por centro deve trazer: o próprio e, se for grupo,
    os seus subgrupos (lançamentos antigos podem estar no próprio grupo)."""
    codigo = (codigo or "").strip()
    centros = _ler_centros(db)
    alvo = next((c for c in centros if c.get("codigo") == codigo), None)
    if not alvo or not alvo.get("id"):
        return [codigo]
    return [codigo] + [c["codigo"] for c in centros if c.get("parent_id") == alvo["id"]]


def validar_centro_lancamento(
    db: Client, codigo: str | None, atual: str | None = None, tenant_id: str | None = None,
) -> None:
    """Lançamento só vai para centro sem subgrupos. Manter o centro que o
    lançamento já tinha é sempre aceito (dado antigo em centro que virou grupo)."""
    codigo = (codigo or "").strip()
    if not codigo or codigo == (atual or "").strip():
        return
    centros = _ler_centros(db, tenant_id)
    alvo = next((c for c in centros if c.get("codigo") == codigo), None)
    if alvo and alvo.get("id") and any(c.get("parent_id") == alvo["id"] for c in centros):
        raise _erro_centro(
            422, f"'{alvo['nome']}' é um grupo — escolha um dos subgrupos dele como centro de custo.",
        )


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
    # Colunas das migrations 0037/0046: sem elas, lista sem os campos.
    for extras in (", somente_dre, confidencial", ", somente_dre", ""):
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


def hoje_brasil() -> date:
    """Data de hoje no horário de Brasília (o servidor roda em UTC: depois das
    21h, `date.today()` já seria amanhã). Sem base de fusos, cai no UTC."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    except Exception:  # noqa: BLE001
        return date.today()


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
    situacao: str | None = None,
) -> DespesasResponse:
    from app.services.periodo_base import coluna_data, ids_do_tipo
    from app.services import confidencial as conf
    from app.services import situacao_filtro as sf
    hoje = hoje_brasil().isoformat()
    termo = _termo_busca(busca)
    col = coluna_data("despesas", base)
    ids_tipo = ids_do_tipo(db, categoria_id, tipo_lancamento_id)
    # Salários confidenciais (0046): quem não é Admin vê uma linha de total.
    ocultos = conf.ids_ocultos(usuario, db)

    def _aplicar_filtros(q, linhas_ocultas: bool = False, com_situacao: bool = True):
        """linhas_ocultas=True: os filtros da tela, sem a busca e sem a situação
        (aplicada depois de agregar), para somar as linhas confidenciais; False:
        a lista normal, sem elas. com_situacao=False: base das contagens dos
        chips de Situação, que não mudam ao escolher um deles."""
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
            # Grupo de centros traz também os subgrupos (0044)
            q = q.in_("centro_custo", expandir_centro(db, centro_custo))
        if banco_id:
            q = q.eq("banco_id", banco_id)
        if status_filter:
            q = q.eq("status", status_filter)
        if linhas_ocultas:
            return q
        if com_situacao:
            q = sf.filtrar_despesas(q, situacao, hoje)
        if ocultos:
            q = conf.sem_confidenciais(q, ocultos)
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

    # Base das contagens dos chips de Situação: os mesmos filtros, sem a
    # situação. Sem situação escolhida, sai das próprias linhas (sem query extra).
    async def _base_contagem():
        if not situacao:
            return None
        return await _exec(_aplicar_filtros(
            db.table("despesas").select("paga_em, status, data_vencimento"), com_situacao=False,
        ))

    if limit is None:
        resp, resp_base = await asyncio.gather(_exec(query), _base_contagem())
    else:
        # Itens + 3 agregados (total, pendentes, soma) são independentes:
        # 4 round-trips em paralelo, fora do event loop, em vez de 4 em fila.
        resp, resp_total, resp_pend, resp_soma, resp_base = await asyncio.gather(
            _exec(query),
            _exec(_aplicar_filtros(db.table("despesas").select("id", count="exact")).limit(1)),
            _exec(
                _aplicar_filtros(db.table("despesas").select("id", count="exact"))
                .eq("status", "pendente").limit(1)
            ),
            _exec(_aplicar_filtros(db.table("despesas").select("valor, paga_em, data_vencimento, status"))),
            _base_contagem(),
        )
    def _item(row: dict) -> DespesaItem:
        tipo_nome  = (row.get("subitens_lancamento") or {}).get("nome")
        banco_nome = (row.get("bancos") or {}).get("nome")
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
            status=row.get("status", "aprovada"),
            criado_por=row.get("criado_por"),
            aprovado_por=row.get("aprovado_por"),
            aprovado_em=row.get("aprovado_em"),
            rejeitado_motivo=row.get("rejeitado_motivo"),
            agregado=bool(row.get("agregado")),
            quantidade=row.get("quantidade"),
        )

    items = [_item(row) for row in (resp.data or [])]

    # Linhas "Total Salários Funcionários". Com busca, não entram: buscar um
    # nome não pode revelar o valor de ninguém.
    agregados: list[DespesaItem] = []
    alvo = ocultos if ids_tipo is None else ocultos & {str(i) for i in ids_tipo}
    if alvo and not termo:
        linhas = await asyncio.to_thread(
            conf.ler_ocultas, lambda q: _aplicar_filtros(q, linhas_ocultas=True),
            alvo, usuario, get_supabase_admin(),
        )
        agregados = [_item(r) for r in conf.agregar(linhas, getattr(usuario, "tenant_id", None))]

    def _sit(paga_em, status, vencimento) -> str:
        return sf.situacao_despesa(paga_em, status, vencimento, hoje)

    # Chips de Situação: contagem sobre os filtros da tela sem a situação.
    if resp_base is not None:
        chaves = [_sit(r.get("paga_em"), r.get("status"), r.get("data_vencimento")) for r in (resp_base.data or [])]
    elif limit is None:
        chaves = [_sit(i.paga_em, i.status, i.data_vencimento) for i in items]
    else:
        chaves = [_sit(r.get("paga_em"), r.get("status"), r.get("data_vencimento")) for r in (resp_soma.data or [])]
    chaves += [_sit(a.paga_em, a.status, a.data_vencimento) for a in agregados]
    contagem = sf.contar(chaves, sf.SITUACOES_DESPESA)
    # Linhas de salário agregadas seguem a situação escolhida depois de somadas.
    if situacao:
        agregados = [a for a in agregados if _sit(a.paga_em, a.status, a.data_vencimento) == situacao]

    resumo = {"paga": [Decimal(0), 0], "a_pagar": [Decimal(0), 0], "vencida": [Decimal(0), 0]}

    def _contar(valor, paga_em, vencimento) -> None:
        chave = "paga" if paga_em else ("vencida" if vencimento and str(vencimento)[:10] < hoje else "a_pagar")
        resumo[chave][0] += _dec(valor or 0)
        resumo[chave][1] += 1

    if limit is None:
        soma = sum(i.valor for i in items)
        pendentes = sum(1 for i in items if i.status == "pendente")
        total = len(items)
        for i in items:
            _contar(i.valor, i.paga_em, i.data_vencimento)
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
        for r in (resp_soma.data or []):
            _contar(r.get("valor"), r.get("paga_em"), r.get("data_vencimento"))
    if agregados:
        # Entram no topo da 1ª página; total e soma contam em todas.
        total += len(agregados)
        soma += sum(a.valor for a in agregados)
        for a in agregados:
            _contar(a.valor, a.paga_em, a.data_vencimento)
        if not offset:
            items = agregados + items
    return DespesasResponse(
        total=total, items=items, soma_total=soma, total_pendentes=pendentes,
        soma_paga=resumo["paga"][0], soma_a_pagar=resumo["a_pagar"][0], soma_vencida=resumo["vencida"][0],
        qtd_paga=resumo["paga"][1], qtd_a_pagar=resumo["a_pagar"][1], qtd_vencida=resumo["vencida"][1],
        contagem_situacao=contagem,
    )


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


def _inserir_serie(db: Client, tabela: str, linhas: list[dict]):
    """INSERT de uma série recorrente; sem a migration 0048, grava sem as
    colunas novas (grupo_recorrencia, e recorrente em receitas)."""
    try:
        return db.table(tabela).insert(linhas).execute()
    except Exception as e:  # noqa: BLE001
        if "grupo_recorrencia" not in str(e) and "recorrente" not in str(e) and "column" not in str(e).lower():
            raise
        for linha in linhas:
            linha.pop("grupo_recorrencia", None)
            if tabela == "receitas_outras":
                linha.pop("recorrente", None)
        return db.table(tabela).insert(linhas).execute()


async def criar_despesa(
    payload: DespesaCreate,
    usuario: UsuarioAtual,
    db: Client,
) -> DespesaItem:
    # Bloqueia escrita em período fechado (Task 3.1)
    _verificar_periodo_aberto(payload.competencia, db)
    validar_centro_lancamento(db, payload.centro_custo)

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
        grupo_rec = str(uuid4())   # marca a série (0048): a edição acha as irmãs por ele
        for i in range(n_meses):
            o = dict(dados)
            o["grupo_recorrencia"] = grupo_rec
            o["competencia"]     = _somar_meses(payload.competencia, i).isoformat()
            o["data_vencimento"] = _somar_meses_preservando_dia(payload.data_vencimento, i).isoformat()
            # Mesma regra do parcelamento: a data informada vale para a 1ª
            # ocorrência; as demais são pagas (e datadas) mês a mês.
            if i > 0:
                o.pop("paga_em", None)
            ocorrencias.append(o)
        _aprovar_pagas(ocorrencias, usuario.user_id)
        resp = _inserir_serie(db, "despesas", ocorrencias)
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



_PAGAMENTO_COM_BANCO = ("em_remessa", "agendada", "bloqueada_banco")


def garantir_sem_pagamento_no_banco(db: Client, despesa_id: UUID | str, acao: str,
                                    mudancas: dict | None = None) -> None:
    """Pagamento por CNAB (0050) em andamento: a despesa não pode mudar de valor,
    ser rejeitada nem excluída até o retorno do banco ou o cancelamento da remessa.
    Com `mudancas`, só barra se algum desses campos realmente mudar."""
    try:
        linhas = db.table("despesas").select("status_pagamento, valor, paga_em, parcela_total, recorrente")             .eq("id", str(despesa_id)).execute().data or []
    except Exception:  # noqa: BLE001 — sem a 0050, não há pagamento por arquivo
        return
    if mudancas is not None and linhas:
        atual = linhas[0]
        def _igual(campo, novo):
            velho = atual.get(campo)
            if campo == "valor":
                from decimal import Decimal
                return novo is None or Decimal(str(velho or 0)) == Decimal(str(novo))
            if campo == "parcela_total":
                return (velho or 1) == (novo or 1)
            return (velho or None) == (novo or None)
        if all(_igual(c, v) for c, v in mudancas.items()):
            return
    if linhas and linhas[0].get("status_pagamento") in _PAGAMENTO_COM_BANCO:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=409,
            detail=f"Esta despesa está numa remessa de pagamento: não dá para {acao} agora. "
                   "Cancele a remessa em Pagamentos ou aguarde o retorno do banco.",
        )


async def rejeitar_despesa(
    despesa_id: UUID,
    motivo: str,
    usuario: UsuarioAtual,
    db: Client,
) -> DespesaItem:
    garantir_sem_pagamento_no_banco(db, despesa_id, "rejeitar")
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
        atual = db.table("despesas").select("centro_custo").eq("id", str(despesa_id)).execute().data
        validar_centro_lancamento(db, payload.centro_custo, atual[0]["centro_custo"] if atual else None)
        campos["centro_custo"] = payload.centro_custo
    if "tipo_lancamento_id" in set_fields:
        campos["tipo_lancamento_id"] = str(payload.tipo_lancamento_id) if payload.tipo_lancamento_id else None
    if "custo_tipo" in set_fields:
        if payload.custo_tipo:
            classificacao_service.validar(db, payload.custo_tipo)
        campos["custo_tipo"] = payload.custo_tipo or None
    if "banco_id" in set_fields:
        campos["banco_id"] = str(payload.banco_id) if payload.banco_id else None
    if set_fields & {"valor", "paga_em", "num_parcelas", "recorrente"}:
        mud: dict = {}
        if "valor" in set_fields:
            mud["valor"] = payload.valor
        if "paga_em" in set_fields:
            mud["paga_em"] = payload.paga_em.isoformat() if payload.paga_em else None
        if "num_parcelas" in set_fields:
            mud["parcela_total"] = payload.num_parcelas
        if "recorrente" in set_fields and payload.recorrente is not None:
            mud["recorrente"] = payload.recorrente
        garantir_sem_pagamento_no_banco(db, despesa_id, "mudar valor, data de pagamento ou parcelas", mud)

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
    if "recorrente" in set_fields and payload.recorrente is not None and usuario is not None:
        from app.services import recorrencia_service
        recorrencia_service.aplicar(
            "despesas", str(alvo_id), payload.recorrente, payload.repetir_ate, usuario, db,
            preservar_aprovadas=preservar_aprovadas,
        )
        row["recorrente"] = payload.recorrente
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
    garantir_sem_pagamento_no_banco(db, despesa_id, "excluir")

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
    situacao: str | None = None,
) -> ReceitasResponse:
    from app.services.periodo_base import coluna_data, ids_do_tipo
    from app.services import situacao_filtro as sf
    hoje = hoje_brasil().isoformat()
    chaves_situacao: list[str] = []

    def _passa(recebido_em, status, vencimento) -> bool:
        """Conta a situação (chips) e diz se a linha entra no filtro escolhido."""
        chave = sf.situacao_receita(recebido_em, status, vencimento, hoje)
        chaves_situacao.append(chave)
        return not situacao or chave == situacao

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
            "observacao, recebido_de, forma_recebimento, tipo_lancamento_id, banco_id, criado_por, criado_em, "
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
        q_rec = q_rec.in_("centro_custo", expandir_centro(db, centro_custo))
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
            if not _passa(row.get("recebida_em"), None, None):
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
        if not _passa(row.get("recebido_em"), row.get("status"), row.get("data_vencimento")):
            continue
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
            recebido_de=row.get("recebido_de"),
            forma_recebimento=row.get("forma_recebimento"),
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
        contagem_situacao=sf.contar(chaves_situacao, sf.SITUACOES_RECEITA),
    )


async def criar_receita_outra(
    payload: ReceitaOutraCreate,
    usuario: UsuarioAtual,
    db: Client,
) -> ReceitaItem:
    _verificar_periodo_aberto(payload.competencia, db)
    validar_centro_lancamento(db, payload.centro_custo)

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
    # Bloco Recebimento (0054).
    if payload.recebido_de and payload.recebido_de.strip():
        dados["recebido_de"] = payload.recebido_de.strip()
    if payload.forma_recebimento:
        dados["forma_recebimento"] = payload.forma_recebimento
    # Receita não passa por aprovação (decisão de 22/10/2026): toda receita
    # lançada já nasce aprovada, em qualquer perfil e em toda ocorrência.
    dados.update(campos_aprovacao(usuario.user_id))

    # Recorrência atômica: um registro por mês em um único INSERT.
    # Todos gravam ou nenhum grava — sem risco de criação parcial.
    if len(meses_recorrencia) > 1:
        registros = []
        grupo_rec = str(uuid4())   # marca a série (0048): a edição acha as irmãs por ele
        for i, mes in enumerate(meses_recorrencia):
            r = dict(dados)
            r["recorrente"] = True
            r["grupo_recorrencia"] = grupo_rec
            r["competencia"] = mes.isoformat()
            if payload.data_vencimento:
                r["data_vencimento"] = _somar_meses_preservando_dia(payload.data_vencimento, i).isoformat()
            # A data informada vale para a 1ª ocorrência; as demais são
            # recebidas (e datadas) mês a mês, pela edição do lançamento.
            if i > 0:
                r.pop("recebido_em", None)
            registros.append(r)
        resp = _inserir_serie(db_admin, "receitas_outras", registros)
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
        recebido_de=row.get("recebido_de"),
        forma_recebimento=row.get("forma_recebimento"),
    )


async def _obter_receita_item(receita_id: UUID, db_admin) -> ReceitaItem:
    """Le a receita completa e monta o ReceitaItem.

    Extraido de atualizar_receita_outra, que montava isto inline — as tres
    funcoes (atualizar, aprovar, rejeitar) precisam do mesmo retorno.
    """
    full = (
        db_admin.table("receitas_outras")
        .select("id, descricao, valor, competencia, data_vencimento, recebido_em, centro_custo, atualizado_em, status, "
                "observacao, recebido_de, forma_recebimento, "
                "tipo_lancamento_id, banco_id, custo_tipo, subitens_lancamento(nome), bancos(nome)")
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
        recebido_de=row.get("recebido_de"),
        forma_recebimento=row.get("forma_recebimento"),
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
        atual = db_admin.table("receitas_outras").select("centro_custo").eq("id", str(receita_id)).execute().data
        validar_centro_lancamento(db, payload.centro_custo, atual[0]["centro_custo"] if atual else None)
        campos["centro_custo"] = payload.centro_custo
    if "observacao" in set_fields:
        campos["observacao"] = payload.observacao
    if "recebido_de" in set_fields:
        campos["recebido_de"] = (payload.recebido_de or "").strip() or None
    if "forma_recebimento" in set_fields:
        campos["forma_recebimento"] = payload.forma_recebimento or None
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
    if "recorrente" in set_fields and payload.recorrente is not None and usuario is not None:
        from app.services import recorrencia_service
        recorrencia_service.aplicar(
            "receitas_outras", str(receita_id), payload.recorrente, payload.repetir_ate, usuario, db_admin,
        )

    full = (
        db_admin.table("receitas_outras")
        .select("id, descricao, valor, competencia, data_vencimento, recebido_em, centro_custo, atualizado_em, status, "
                "observacao, recebido_de, forma_recebimento, "
                "tipo_lancamento_id, banco_id, custo_tipo, subitens_lancamento(nome), bancos(nome)")
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
        recebido_de=row.get("recebido_de"),
        forma_recebimento=row.get("forma_recebimento"),
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
