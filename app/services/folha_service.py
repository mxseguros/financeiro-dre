"""
MX Seguros — DRE-IA | Folha CLT — contrato, parâmetros e custo (25/11/2026).

Fase 1: o Admin cadastra o contrato de cada funcionário (salário, adicionais,
dependentes, benefícios) e vê o cálculo do mês — INSS, IRRF, líquido, FGTS e
o custo total para a empresa. A geração da folha do mês vem na fase 2.

Salário é confidencial (decisão de 24/11/2026): tudo aqui é só Admin, e as
tabelas da 0049 não têm policy — o acesso é só por este serviço, com o client
admin e o tenant sempre no filtro.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.services import folha_calculo as fc

CAMPOS_CONTRATO = (
    "tipo_contrato", "cargo", "data_admissao", "data_desligamento", "salario_base", "adicionais",
    "dependentes_ir", "filhos_salario_familia", "pensao_alimenticia", "vt_custo_mensal", "vt_descontar",
    "va_valor", "plano_saude_empresa", "plano_saude_desconto", "seguro_vida", "outros_beneficios",
    "sindical", "banco_pagamento",
)
CONTRATO_VAZIO: dict = {
    "tipo_contrato": "clt", "cargo": None, "data_admissao": None, "data_desligamento": None,
    "salario_base": 0, "adicionais": {}, "dependentes_ir": 0, "filhos_salario_familia": 0,
    "pensao_alimenticia": 0, "vt_custo_mensal": 0, "vt_descontar": True, "va_valor": 0,
    "plano_saude_empresa": 0, "plano_saude_desconto": 0, "seguro_vida": 0, "outros_beneficios": [],
    "sindical": {}, "banco_pagamento": None,
}
# Rubrica da folha → subitem da despesa (Configurações → Folha).
RUBRICAS = {
    "salario_liquido": "Salário líquido (por funcionário)",
    "variaveis":       "Horas extras / adicionais variáveis",
    "premio":          "Prêmios e comissões",
    "fgts":            "Guia FGTS",
    "inss":            "Guia INSS retido",
    "irrf":            "DARF IRRF",
    "vt":              "Vale-transporte",
    "va":              "Vale-alimentação / refeição",
    "plano_saude":     "Plano de saúde (parte da empresa)",
    "seguro_vida":     "Seguro de vida",
    "decimo_terceiro": "13º salário",
    "ferias":          "Férias",
}


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def exigir_admin(usuario: UsuarioAtual) -> None:
    if usuario.role not in ("admin", "super_admin"):
        raise _erro(403, "Salários e folha são visíveis só para o Admin.")


def _sem_tabela(e: Exception) -> bool:
    s = str(e).lower()
    return "does not exist" in s or "schema cache" in s or "42p01" in s


def _indisponivel() -> HTTPException:
    return _erro(503, "Folha indisponível: rode a migration 0049 no Supabase.")


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _com_tenant(q, usuario: UsuarioAtual):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def _json(v):
    """Decimal/date → tipos de JSON (o cálculo vai para jsonb e para a API)."""
    from decimal import Decimal
    if isinstance(v, dict):
        return {k: _json(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_json(x) for x in v]
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


# ── Parâmetros (tabelas por ano) ─────────────────────────────

def parametros(ano: int, usuario: UsuarioAtual, db: Client) -> dict:
    """Parâmetros vigentes no ano: o último cadastrado até ele; sem nenhum,
    os de partida (a conferir)."""
    try:
        linhas = _com_tenant(db.table("folha_parametros").select("ano, dados, conferido")
                             .lte("ano", ano), usuario).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            linhas = []
        else:
            raise
    if not linhas:
        return {**fc.PARAMETROS_PADRAO, "ano_vigente": None}
    linha = max(linhas, key=lambda r: r["ano"])
    return {**fc.PARAMETROS_PADRAO, **(linha.get("dados") or {}), "ano": linha["ano"],
            "conferido": bool(linha.get("conferido")), "ano_vigente": linha["ano"]}


def salvar_parametros(ano: int, dados: dict, conferido: bool, usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    permitidos = {k: v for k, v in dados.items() if k in fc.PARAMETROS_PADRAO and k not in ("ano", "conferido")}
    linha = {"ano": ano, "dados": permitidos, "conferido": conferido,
             "atualizado_por": usuario.user_id, "atualizado_em": datetime.now(timezone.utc).isoformat()}
    if _tenant(usuario):
        linha["tenant_id"] = _tenant(usuario)
    try:
        existe = _com_tenant(db.table("folha_parametros").select("id").eq("ano", ano), usuario).execute().data
        if existe:
            db.table("folha_parametros").update(linha).eq("id", existe[0]["id"]).execute()
        else:
            db.table("folha_parametros").insert(linha).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    return parametros(ano, usuario, db)


# ── Rubrica → subitem ────────────────────────────────────────

def rubricas(usuario: UsuarioAtual, db: Client) -> list[dict]:
    try:
        linhas = _com_tenant(db.table("folha_rubrica_subitem").select("rubrica, subitem_id"), usuario).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            linhas = []
        else:
            raise
    mapa = {r["rubrica"]: r.get("subitem_id") for r in linhas}
    return [{"rubrica": k, "nome": nome, "subitem_id": mapa.get(k)} for k, nome in RUBRICAS.items()]


def salvar_rubricas(mapa: dict[str, str | None], usuario: UsuarioAtual, db: Client) -> list[dict]:
    exigir_admin(usuario)
    desconhecidas = set(mapa) - set(RUBRICAS)
    if desconhecidas:
        raise _erro(422, f"Rubrica desconhecida: {', '.join(sorted(desconhecidas))}.")
    ids = [v for v in mapa.values() if v]
    if ids:
        q = db.table("subitens_lancamento").select("id, natureza").in_("id", [str(i) for i in ids])
        subs = {r["id"]: r for r in _com_tenant(q, usuario).execute().data or []}
        ruins = [str(i) for i in ids if str(i) not in subs or subs[str(i)].get("natureza") != "despesa"]
        if ruins:
            raise _erro(422, "Escolha subitens de despesa.")
    try:
        for rubrica, subitem in mapa.items():
            linha = {"rubrica": rubrica, "subitem_id": str(subitem) if subitem else None}
            if _tenant(usuario):
                linha["tenant_id"] = _tenant(usuario)
            q = _com_tenant(db.table("folha_rubrica_subitem").select("rubrica").eq("rubrica", rubrica), usuario)
            if q.execute().data:
                _com_tenant(db.table("folha_rubrica_subitem").update(linha).eq("rubrica", rubrica), usuario).execute()
            else:
                db.table("folha_rubrica_subitem").insert(linha).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    return rubricas(usuario, db)


# ── Contrato do funcionário ──────────────────────────────────

def _funcionario(funcionario_id, usuario: UsuarioAtual, db: Client) -> dict:
    from app.services import funcionarios_service
    return funcionarios_service.obter(funcionario_id, usuario, db)


def _ler_contratos(usuario: UsuarioAtual, db: Client, ids: list[str] | None = None) -> dict[str, dict]:
    try:
        q = _com_tenant(db.table("funcionarios_contrato").select("*"), usuario)
        if ids is not None:
            q = q.in_("funcionario_id", ids)
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return {}
        raise
    return {r["funcionario_id"]: r for r in linhas}


def _normalizar(dados: dict) -> dict:
    c = {**CONTRATO_VAZIO, **{k: v for k, v in dados.items() if k in CAMPOS_CONTRATO}}
    for k in ("data_admissao", "data_desligamento"):
        if isinstance(c.get(k), (date, datetime)):
            c[k] = c[k].isoformat()
    return _json(c)


def simular(contrato: dict, usuario: UsuarioAtual, db: Client, ano: int | None = None,
            variaveis: dict | None = None) -> dict:
    """Cálculo do mês para um contrato (salvo ou ainda no formulário)."""
    exigir_admin(usuario)
    p = parametros(ano or date.today().year, usuario, db)
    r = fc.calcular_item(_normalizar(contrato), p, variaveis)
    return {**_json(r), "parametros_conferidos": bool(p.get("conferido")), "parametros_ano": p.get("ano_vigente")}


def obter_contrato(funcionario_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    _funcionario(funcionario_id, usuario, db)
    contrato = _ler_contratos(usuario, db, [str(funcionario_id)]).get(str(funcionario_id))
    dados = _normalizar(contrato or {})
    return {"funcionario_id": str(funcionario_id), "cadastrado": contrato is not None, **dados,
            "calculo": simular(dados, usuario, db)}


def salvar_contrato(funcionario_id: UUID, dados: dict, usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    _funcionario(funcionario_id, usuario, db)
    linha = {**_normalizar(dados), "funcionario_id": str(funcionario_id),
             "atualizado_em": datetime.now(timezone.utc).isoformat()}
    if _tenant(usuario):
        linha["tenant_id"] = _tenant(usuario)
    try:
        existe = _ler_contratos(usuario, db, [str(funcionario_id)])
        if existe:
            _com_tenant(db.table("funcionarios_contrato").update(linha)
                        .eq("funcionario_id", str(funcionario_id)), usuario).execute()
        else:
            db.table("funcionarios_contrato").insert(linha).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    return obter_contrato(funcionario_id, usuario, db)


def custos(usuario: UsuarioAtual, db: Client) -> dict:
    """Custo do mês por funcionário e por centro (só quem tem contrato)."""
    exigir_admin(usuario)
    from app.services import funcionarios_service
    funcs = {str(f.id): f for f in funcionarios_service.listar(usuario, db)}
    contratos = _ler_contratos(usuario, db)
    p = parametros(date.today().year, usuario, db)
    por_func, por_centro = {}, {}
    for fid, ct in contratos.items():
        f = funcs.get(fid)
        if not f or not f.ativo or ct.get("data_desligamento"):
            continue
        r = fc.calcular_item(_normalizar(ct), p)
        por_func[fid] = _json({"salario_base": r["proventos"]["salario"], "liquido": r["liquido"],
                               "custo_mes": r["custo_mes"], "custo_com_provisoes": r["custo_com_provisoes"]})
        centro = f.centro_custo or "sem_centro"
        acc = por_centro.setdefault(centro, {"pessoas": 0, "custo_mes": 0.0, "custo_com_provisoes": 0.0})
        acc["pessoas"] += 1
        acc["custo_mes"] = round(acc["custo_mes"] + float(r["custo_mes"]), 2)
        acc["custo_com_provisoes"] = round(acc["custo_com_provisoes"] + float(r["custo_com_provisoes"]), 2)
    total = round(sum(v["custo_mes"] for v in por_func.values()), 2)
    return {"por_funcionario": por_func, "por_centro": por_centro, "total_mes": total,
            "parametros_conferidos": bool(p.get("conferido")), "parametros_ano": p.get("ano_vigente")}
