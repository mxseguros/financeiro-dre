"""
MX Seguros — DRE-IA | Importação do retorno CNAB (fase 3, 25/11/2026).

O usuário sobe o arquivo de retorno do banco (crítica ou movimento). Cada
registro é casado com o item da remessa pelo "seu número"; as ocorrências
viram a nova situação do pagamento:
- 00 (pago)          → despesa paga (paga_em = data real) e banco da conta;
- BD (agendado)      → agendada;   B1 (Santander) → autorizar no banco;
- devolvido/estorno  → volta para "a pagar" com o motivo;
- demais             → rejeitado, com o motivo legível — volta para "a pagar".
O mesmo arquivo não entra duas vezes (hash SHA-256).
"""
from __future__ import annotations

import hashlib
from datetime import date
from decimal import Decimal

import structlog
from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.cnab import ocorrencias
from app.cnab.retorno import RetornoInvalido, ler
from app.permissions import permissao_pagamentos

logger = structlog.get_logger()
BUCKET = "cnab"
FINAIS = ("paga", "rejeitada", "devolvida", "cancelado")
_ORDEM = {"em_remessa": 0, "bloqueada_banco": 1, "agendada": 2, "rejeitada": 3, "devolvida": 3, "paga": 4}


def _erro(codigo: int, msg) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _q(usuario: UsuarioAtual, q):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def _exigir(usuario: UsuarioAtual) -> None:
    if not permissao_pagamentos(usuario.role, usuario.permissions, "retorno"):
        raise _erro(403, "Sem permissão para importar retorno.")


def _novo_status(atual: str, resultado: str) -> str | None:
    """Nunca rebaixa: pago não volta para agendado por um retorno de crítica
    lido depois. Devolução vale sempre (é posterior ao pagamento)."""
    if resultado == "info":
        return None
    if resultado == "devolvida":
        return "devolvida"
    if atual in ("paga", "devolvida", "cancelado"):
        return None
    if atual == "rejeitada" and resultado != "paga":
        return None
    if _ORDEM.get(resultado, 0) < _ORDEM.get(atual, 0):
        return None
    return resultado if resultado != atual else None


def importar(nome: str, conteudo: bytes, usuario: UsuarioAtual, db: Client) -> dict:
    _exigir(usuario)
    if not conteudo:
        raise _erro(422, "Arquivo vazio.")
    if len(conteudo) > 5 * 1024 * 1024:
        raise _erro(422, "Arquivo grande demais para um retorno (máx. 5 MB).")
    sha = hashlib.sha256(conteudo).hexdigest()
    tenant = _tenant(usuario)
    try:
        repetido = _q(usuario, db.table("retornos").select("id, nome_arquivo, importado_em").eq("sha256", sha)) \
            .execute().data or []
    except Exception as e:  # noqa: BLE001
        raise _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.") from e
    if repetido:
        quando = str(repetido[0].get("importado_em") or "")[:10]
        raise _erro(409, f"Este retorno já foi importado ({repetido[0]['nome_arquivo']}, {quando}).")
    try:
        ret = ler(conteudo.decode("latin-1"))
    except RetornoInvalido as e:
        raise _erro(422, str(e)) from e

    banco = ret.codigo_banco
    seus = list({r.seu_numero for r in ret.registros if r.seu_numero})
    itens = {}
    if seus:
        for i in range(0, len(seus), 200):
            for it in _q(usuario, db.table("remessa_itens").select("*").in_("seu_numero", seus[i:i + 200])).execute().data or []:
                itens[it["seu_numero"]] = it
    remessas_ids = {it["remessa_id"] for it in itens.values()}
    remessas = {r["id"]: r for r in (_q(usuario, db.table("remessas").select("id, conta_id, data_pagamento, status")
                                        .in_("id", list(remessas_ids))).execute().data or [])} if remessas_ids else {}
    contas = {c["id"]: c for c in (_q(usuario, db.table("contas_pagadoras").select("id, banco_id, codigo_banco")
                                      .in_("id", list({r["conta_id"] for r in remessas.values()}))).execute().data or [])} \
        if remessas else {}
    despesas = {str(d["id"]): d for d in (_q(usuario, db.table("despesas").select("id, descricao, remessa_item_id")
                .in_("id", [it["despesa_id"] for it in itens.values()])).execute().data or [])} if itens else {}

    resumo = {"pagos": [], "agendados": [], "bloqueados": [], "rejeitados": [], "devolvidos": [],
              "nao_encontrados": [], "sem_mudanca": 0}
    eventos, arquivos_tocados = [], set()
    for reg in ret.registros:
        codigos = reg.ocorrencias or ret.ocorrencias_lote.get(reg.lote) or ret.ocorrencias_arquivo
        it = itens.get(reg.seu_numero)
        if not it:
            resumo["nao_encontrados"].append({"seu_numero": reg.seu_numero, "ocorrencias": codigos,
                                              "valor": str(reg.valor_real) if reg.valor_real else None})
            continue
        if not codigos:
            resumo["sem_mudanca"] += 1
            continue
        resultado = ocorrencias.classificar(banco, codigos, reg.estorno)
        motivo = ocorrencias.motivo(banco, codigos)
        arquivos_tocados.add(it.get("arquivo_id"))
        novo = _novo_status(it["status"], resultado)
        despesa = despesas.get(str(it["despesa_id"]), {})
        linha = {"despesa_id": it["despesa_id"], "descricao": despesa.get("descricao"), "valor": str(it["valor"]),
                 "ocorrencias": codigos, "motivo": motivo}
        if not novo:
            resumo["sem_mudanca"] += 1
            continue
        campos_item = {"status": novo, "ocorrencias": codigos,
                       "motivo": motivo if novo in ("rejeitada", "devolvida") else None}
        if reg.autenticacao:
            campos_item["autenticacao"] = reg.autenticacao
        db.table("remessa_itens").update(campos_item).eq("id", it["id"]).execute()
        it["status"] = novo

        # A despesa só muda se este item ainda é o pagamento dela.
        if str(despesa.get("remessa_item_id")) == str(it["id"]):
            campos = {"status_pagamento": novo}
            if novo == "paga":
                rem = remessas.get(it["remessa_id"], {})
                campos["paga_em"] = (reg.data_real or date.fromisoformat(str(rem.get("data_pagamento"))[:10])).isoformat()
                banco_id = contas.get(rem.get("conta_id"), {}).get("banco_id")
                if banco_id:
                    campos["banco_id"] = banco_id
            elif novo == "devolvida":
                campos["paga_em"] = None
            _q(usuario, db.table("despesas").update(campos).eq("id", it["despesa_id"])).execute()
        chave = {"paga": "pagos", "agendada": "agendados", "bloqueada_banco": "bloqueados",
                 "rejeitada": "rejeitados", "devolvida": "devolvidos"}[novo]
        resumo[chave].append(linha)
        eventos.append({"tenant_id": tenant, "despesa_id": it["despesa_id"], "item_id": it["id"],
                        "evento": f"retorno_{novo}", "usuario_id": usuario.user_id,
                        "detalhe": {"ocorrencias": codigos, "data_real": reg.data_real.isoformat() if reg.data_real else None,
                                    "valor_real": str(reg.valor_real) if reg.valor_real else None, "arquivo": nome}})

    # Situação das remessas tocadas.
    for rid in {it["remessa_id"] for it in itens.values()}:
        todos = db.table("remessa_itens").select("status").eq("remessa_id", rid).execute().data or []
        status_r = remessas.get(rid, {}).get("status")
        if status_r == "cancelada":
            continue
        novo_r = "processada" if todos and all(t["status"] in FINAIS for t in todos) else "parcial"
        if novo_r != status_r:
            db.table("remessas").update({"status": novo_r}).eq("id", rid).execute()
    for aid in arquivos_tocados - {None}:
        db.table("remessa_arquivos").update({"retorno_ok": True}).eq("id", aid).execute()

    if eventos:
        db.table("despesa_pagamento_eventos").insert(eventos).execute()
    tipo = "movimento" if resumo["pagos"] or resumo["devolvidos"] else "critica"
    path = f"{tenant or 'geral'}/retornos/{sha[:16]}_{nome[-60:]}"
    try:
        db.storage.from_(BUCKET).upload(path, conteudo, {"content-type": "text/plain", "upsert": "true"})
    except Exception as e:  # noqa: BLE001 — guardar o arquivo é conveniência; a baixa já foi feita
        logger.warning("retorno_arquivo_nao_salvo", erro=str(e))
        path = None
    contagem = {k: (len(v) if isinstance(v, list) else v) for k, v in resumo.items()}
    db.table("retornos").insert({
        "tenant_id": tenant, "codigo_banco": banco, "tipo": tipo, "nsa": ret.nsa, "nome_arquivo": nome[:200],
        "path": path, "sha256": sha, "resumo": contagem, "importado_por": usuario.user_id,
    }).execute()
    logger.info("retorno_importado", banco=banco, **contagem)
    return {"banco": banco, "tipo": tipo, "nsa": ret.nsa, "contagem": contagem, **resumo,
            "ocorrencias_lote": {str(k): ocorrencias.motivo(banco, v) for k, v in ret.ocorrencias_lote.items()
                                 if any(c not in ("00", "BD") for c in v)}}


def listar(usuario: UsuarioAtual, db: Client) -> list[dict]:
    if not permissao_pagamentos(usuario.role, usuario.permissions, "visualizar"):
        raise _erro(403, "Sem permissão para Pagamentos.")
    try:
        return _q(usuario, db.table("retornos").select("id, codigo_banco, tipo, nsa, nome_arquivo, resumo, importado_em")
                  .order("importado_em", desc=True).limit(100)).execute().data or []
    except Exception:  # noqa: BLE001
        return []


def baixa_manual(despesa_id: str, data_pagamento: date, usuario: UsuarioAtual, db: Client) -> dict:
    """Pagamento feito fora do arquivo (ou cuja baixa não veio no retorno):
    marca paga_manual + paga_em. O comprovante vai como anexo da despesa."""
    if not permissao_pagamentos(usuario.role, usuario.permissions, "retorno"):
        raise _erro(403, "Sem permissão para dar baixa em pagamentos.")
    from app.services.anexos_service import carregar_entidade
    d = carregar_entidade("despesa", despesa_id, usuario, db)
    if d.get("status") != "aprovada":
        raise _erro(422, "Só despesas aprovadas recebem baixa.")
    if d.get("status_pagamento") in ("em_remessa", "bloqueada_banco"):
        raise _erro(409, "Esta despesa está numa remessa ainda não processada: cancele a remessa ou aguarde o retorno.")
    if data_pagamento > date.today():
        raise _erro(422, "A data do pagamento não pode ser futura.")
    _q(usuario, db.table("despesas").update({"status_pagamento": "paga_manual", "paga_em": data_pagamento.isoformat()})
       .eq("id", str(despesa_id))).execute()
    if d.get("remessa_item_id") and d.get("status_pagamento") == "agendada":
        db.table("remessa_itens").update({"status": "paga", "motivo": "Baixa manual"}).eq("id", d["remessa_item_id"]).execute()
    db.table("despesa_pagamento_eventos").insert({
        "tenant_id": _tenant(usuario), "despesa_id": str(despesa_id), "evento": "baixa_manual",
        "detalhe": {"data": data_pagamento.isoformat()}, "usuario_id": usuario.user_id,
    }).execute()
    return {"ok": True, "despesa_id": str(despesa_id), "paga_em": data_pagamento.isoformat()}


def valor_total(itens: list[dict]) -> Decimal:
    return sum((Decimal(str(i.get("valor") or 0)) for i in itens), Decimal(0))
