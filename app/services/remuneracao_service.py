"""
MX Seguros — DRE-IA | Remuneração do funcionário (0052, 26/11/2026).

Substitui a Folha CLT (0049): sem cálculo de INSS/IRRF. O Admin informa, por
funcionário, os valores de cada item (salário, 13º, 1/3 de férias, abono de
férias, FGTS, vale-refeição, odonto, plano de saúde, seguro de vida e
rescisão). Os dados de pagamento (Pix/conta) ficam em `fornecedores`
(favorecido do funcionário, 0050).

Salário é confidencial (decisão de 24/11/2026): tudo aqui é só Admin, e a
tabela não tem policy — o acesso é só por este serviço, com o client admin e o
tenant sempre no filtro.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual

# Ordem da tela (lista do Gabriel, 26/11/2026).
ITENS: dict[str, str] = {
    "salario":         "Salário",
    "decimo_terceiro": "13º Salário",
    "terco_ferias":    "1/3 Férias",
    "abono_ferias":    "Abono de Férias",
    "fgts":            "FGTS",
    "vale_refeicao":   "Vale Refeição",
    "odonto":          "Odonto",
    "plano_saude":     "Plano de Saúde",
    "seguro_vida":     "Seguro de Vida",
    "rescisao":        "Rescisão",
}
# Entram no custo mensal; 13º, férias, abono e rescisão são eventuais.
MENSAIS = ("salario", "fgts", "vale_refeicao", "odonto", "plano_saude", "seguro_vida")
TABELA = "funcionarios_contrato"


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def exigir_admin(usuario: UsuarioAtual) -> None:
    if usuario.role not in ("admin", "super_admin"):
        raise _erro(403, "Salários e remuneração são visíveis só para o Admin.")


def _sem_tabela(e: Exception) -> bool:
    s = str(e).lower()
    return "does not exist" in s or "schema cache" in s or "42p01" in s or "42703" in s


def _indisponivel() -> HTTPException:
    return _erro(503, "Remuneração indisponível: rode a migration 0052 no Supabase.")


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _com_tenant(q, usuario: UsuarioAtual):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def normalizar(valores: dict | None) -> dict[str, float]:
    """Só os itens conhecidos, em reais com 2 casas, sem negativos."""
    saida: dict[str, float] = {}
    for k in ITENS:
        bruto = (valores or {}).get(k)
        try:
            v = Decimal(str(bruto)) if bruto not in (None, "") else Decimal(0)
        except (InvalidOperation, ValueError):
            raise _erro(422, f"Valor inválido em {ITENS[k]}.") from None
        if v < 0 or v > Decimal("9999999"):
            raise _erro(422, f"Valor fora do limite em {ITENS[k]}.")
        saida[k] = float(v.quantize(Decimal("0.01")))
    return saida


def custo_mensal(valores: dict[str, float]) -> float:
    return round(sum(valores.get(k, 0.0) for k in MENSAIS), 2)


def _funcionario(funcionario_id, usuario: UsuarioAtual, db: Client) -> dict:
    from app.services import funcionarios_service
    return funcionarios_service.obter(funcionario_id, usuario, db)


def _ler(usuario: UsuarioAtual, db: Client, ids: list[str] | None = None) -> dict[str, dict]:
    try:
        q = _com_tenant(db.table(TABELA).select("funcionario_id, valores, banco_pagamento"), usuario)
        if ids is not None:
            q = q.in_("funcionario_id", ids)
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return {}
        raise
    return {r["funcionario_id"]: r for r in linhas}


def obter(funcionario_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    _funcionario(funcionario_id, usuario, db)
    linha = _ler(usuario, db, [str(funcionario_id)]).get(str(funcionario_id))
    valores = normalizar((linha or {}).get("valores"))
    return {"funcionario_id": str(funcionario_id), "cadastrado": linha is not None, "valores": valores,
            "custo_mensal": custo_mensal(valores), "banco_pagamento": (linha or {}).get("banco_pagamento")}


def salvar(funcionario_id: UUID, valores: dict, usuario: UsuarioAtual, db: Client) -> dict:
    exigir_admin(usuario)
    _funcionario(funcionario_id, usuario, db)
    linha = {"funcionario_id": str(funcionario_id), "valores": normalizar(valores),
             "atualizado_em": datetime.now(timezone.utc).isoformat()}
    if _tenant(usuario):
        linha["tenant_id"] = _tenant(usuario)
    try:
        if _ler(usuario, db, [str(funcionario_id)]):
            _com_tenant(db.table(TABELA).update(linha).eq("funcionario_id", str(funcionario_id)), usuario).execute()
        else:
            db.table(TABELA).insert(linha).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    return obter(funcionario_id, usuario, db)


def custos(usuario: UsuarioAtual, db: Client) -> dict:
    """Custo mensal (salário + FGTS + benefícios) por funcionário ativo e por centro."""
    exigir_admin(usuario)
    from app.services import funcionarios_service
    funcs = {str(f.id): f for f in funcionarios_service.listar(usuario, db)}
    por_func: dict[str, dict] = {}
    por_centro: dict[str, dict] = {}
    for fid, linha in _ler(usuario, db).items():
        f = funcs.get(fid)
        if not f or not f.ativo:
            continue
        valores = normalizar(linha.get("valores"))
        custo = custo_mensal(valores)
        if not custo:
            continue
        por_func[fid] = {"salario": valores["salario"], "custo_mensal": custo}
        acc = por_centro.setdefault(f.centro_custo or "sem_centro", {"pessoas": 0, "custo_mensal": 0.0})
        acc["pessoas"] += 1
        acc["custo_mensal"] = round(acc["custo_mensal"] + custo, 2)
    return {"por_funcionario": por_func, "por_centro": por_centro,
            "total_mes": round(sum(v["custo_mensal"] for v in por_func.values()), 2)}
