"""
MX Seguros — DRE-IA | Contas a pagar e remessa CNAB 240 (fase 2, 25/11/2026).

Fluxo: despesa aprovada e não paga → "a pagar". O usuário escolhe conta,
data e despesas; o sistema valida item a item, reserva o NSA, gera o arquivo
(bucket privado `cnab`) e marca as despesas "em remessa". O usuário importa e
autoriza o arquivo no banco; o retorno (fase 3) dá a baixa.

Regras:
- só quem tem pagamentos.remessa gera/cancela; salário confidencial só o Admin;
- uma despesa só entra se estiver livre (sem pagamento em andamento): a marcação
  "em remessa" é um UPDATE condicional, então duas remessas simultâneas não
  levam a mesma despesa;
- o arquivo fica gravado: baixar de novo devolve o mesmo arquivo (mesmo NSA).
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import structlog
from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.cnab import dias_uteis
from app.cnab.barcode import mod10
from app.cnab.builders import itau, santander
from app.cnab.modelo import Empresa, Favorecido, ItemPagamento
from app.permissions import permissao_pagamentos
from app.services import contas_pagadoras_service
from app.services.confidencial import ids_confidenciais

logger = structlog.get_logger()

BUCKET = "cnab"
BUILDERS = {"033": santander, "341": itau}
LIVRES = (None, "rejeitada", "devolvida")          # podem entrar numa remessa
EM_ANDAMENTO = ("em_remessa", "agendada", "bloqueada_banco")
_COLS_DESPESA = ("id, tenant_id, status, paga_em, valor, descricao, data_vencimento, competencia, "
                 "centro_custo, tipo_lancamento_id, fornecedor_id, forma_pagamento, valor_pagamento, "
                 "codigo_barras, linha_digitavel, vencimento_boleto, cedente_cpf_cnpj, cedente_nome, "
                 "pix_copia_cola, tributo, status_pagamento, remessa_item_id")


def _erro(codigo: int, msg) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _q(usuario: UsuarioAtual, q):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def _exigir(usuario: UsuarioAtual, acao: str) -> None:
    if not permissao_pagamentos(usuario.role, usuario.permissions, acao):
        raise _erro(403, "Sem permissão para Pagamentos.")


def _sem_estrutura(e: Exception) -> bool:
    s = str(e).lower()
    return "schema cache" in s or "does not exist" in s or "42p01" in s or "42703" in s or "pgrst204" in s


def _indisponivel() -> HTTPException:
    return _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.")


def _ve_salario(usuario: UsuarioAtual) -> bool:
    return usuario.role in ("admin", "super_admin")


def _valor(d: dict) -> Decimal:
    return Decimal(str(d.get("valor_pagamento") if d.get("valor_pagamento") is not None else d.get("valor") or 0))


# ── Montagem do item neutro ───────────────────────────────────
def _favorecido(f: dict | None) -> Favorecido | None:
    if not f:
        return None
    return Favorecido(
        nome=f.get("nome") or "", cpf_cnpj=f.get("cpf_cnpj"), banco_codigo=f.get("banco_codigo"), ispb=f.get("ispb"),
        agencia=f.get("agencia"), agencia_dv=f.get("agencia_dv"), conta=f.get("conta"), conta_dv=f.get("conta_dv"),
        tipo_conta=f.get("tipo_conta"), pix_tipo_chave=f.get("pix_tipo_chave"), pix_chave=f.get("pix_chave"),
        funcionario=bool(f.get("funcionario_id")),
    )


def _item(d: dict, forn: dict | None, data_pag: date, seu_numero: str, confidenciais: set[str]) -> ItemPagamento:
    venc = d.get("vencimento_boleto") or d.get("data_vencimento")
    return ItemPagamento(
        ref=str(d["id"]), seu_numero=seu_numero, forma=d.get("forma_pagamento") or "", valor=_valor(d),
        data_pagamento=data_pag, descricao=d.get("descricao") or "", favorecido=_favorecido(forn),
        codigo_barras=d.get("codigo_barras"), vencimento=date.fromisoformat(str(venc)[:10]) if venc else None,
        cedente_doc=d.get("cedente_cpf_cnpj") or (forn or {}).get("cpf_cnpj"),
        cedente_nome=d.get("cedente_nome") or (forn or {}).get("nome"),
        pix_copia_cola=d.get("pix_copia_cola"), tributo=d.get("tributo"),
        salario=bool((forn or {}).get("funcionario_id")) or str(d.get("tipo_lancamento_id")) in confidenciais,
    )


def _empresa(conta: dict) -> Empresa:
    return Empresa(cnpj=conta["cnpj_empresa"], razao_social=conta["razao_social"], agencia=conta["agencia"],
                   conta=conta["conta"], agencia_dv=conta.get("agencia_dv"), conta_dv=conta.get("conta_dv"),
                   convenio=conta.get("codigo_convenio"), endereco=conta.get("endereco") or {},
                   opcoes={"enviar_bloqueado": True, **(conta.get("opcoes") or {})})


def seu_numero(codigo_banco: str, nsa: int, seq: int) -> str:
    base = f"{codigo_banco}{nsa:06d}{seq:06d}"
    return f"MX{base}{mod10(base)}"


def _fornecedores(ids: set[str], usuario: UsuarioAtual, db: Client) -> dict[str, dict]:
    if not ids:
        return {}
    linhas = _q(usuario, db.table("fornecedores").select("*").in_("id", list(ids))).execute().data or []
    return {str(r["id"]): r for r in linhas}


def _despesas(ids: list[str], usuario: UsuarioAtual, db: Client) -> list[dict]:
    try:
        return _q(usuario, db.table("despesas").select(_COLS_DESPESA).in_("id", ids)).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_estrutura(e):
            raise _indisponivel() from e
        raise


# ── Contas a pagar ────────────────────────────────────────────
def a_pagar(usuario: UsuarioAtual, db: Client, situacao: str = "a_pagar",
            inicio: date | None = None, fim: date | None = None) -> dict:
    """Despesas aprovadas não pagas (situacao=a_pagar), com pagamento em
    andamento (em_andamento) ou as duas (todas)."""
    _exigir(usuario, "visualizar")
    try:
        q = _q(usuario, db.table("despesas").select(_COLS_DESPESA).eq("status", "aprovada").is_("paga_em", "null"))
        if inicio:
            q = q.gte("data_vencimento", inicio.isoformat())
        if fim:
            q = q.lte("data_vencimento", fim.isoformat())
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_estrutura(e):
            return {"habilitado": False, "itens": [], "ocultos": 0, "totais": {}}
        raise
    confid = ids_confidenciais(db)
    ocultos = 0
    if not _ve_salario(usuario):
        visiveis = [d for d in linhas if str(d.get("tipo_lancamento_id")) not in confid]
        ocultos, linhas = len(linhas) - len(visiveis), visiveis

    totais = {"a_pagar": Decimal(0), "em_remessa": Decimal(0), "agendado": Decimal(0), "rejeitado": Decimal(0)}
    for d in linhas:
        s = d.get("status_pagamento")
        chave = {"em_remessa": "em_remessa", "bloqueada_banco": "em_remessa", "agendada": "agendado",
                 "rejeitada": "rejeitado", "devolvida": "rejeitado"}.get(s, "a_pagar")
        totais[chave] += _valor(d)

    if situacao == "a_pagar":
        linhas = [d for d in linhas if d.get("status_pagamento") in LIVRES]
    elif situacao == "em_andamento":
        linhas = [d for d in linhas if d.get("status_pagamento") in EM_ANDAMENTO]

    forns = _fornecedores({str(d["fornecedor_id"]) for d in linhas if d.get("fornecedor_id")}, usuario, db)
    ids_item = [str(d["remessa_item_id"]) for d in linhas
                if d.get("remessa_item_id") and d.get("status_pagamento") in ("rejeitada", "devolvida")]
    motivos = {str(r["id"]): r.get("motivo") for r in (db.table("remessa_itens").select("id, motivo")
               .in_("id", ids_item).execute().data or [])} if ids_item else {}
    hoje = date.today()
    itens = []
    for d in linhas:
        f = forns.get(str(d.get("fornecedor_id")))
        pend = santander.validar(_item(d, f, hoje, "MX", confid)) if d.get("forma_pagamento") else \
            ["Sem forma de pagamento: abra a despesa e preencha o bloco Pagamento."]
        itens.append({
            "id": d["id"], "descricao": d.get("descricao"), "valor": str(d.get("valor")), "valor_pagar": str(_valor(d)),
            "data_vencimento": d.get("data_vencimento"), "vencimento_documento": d.get("vencimento_boleto"),
            "competencia": d.get("competencia"), "centro_custo": d.get("centro_custo"),
            "forma_pagamento": d.get("forma_pagamento"), "status_pagamento": d.get("status_pagamento"),
            "favorecido": ({"id": f["id"], "nome": f.get("nome"), "funcionario": bool(f.get("funcionario_id"))} if f else None),
            "salario": str(d.get("tipo_lancamento_id")) in confid,
            "motivo": motivos.get(str(d.get("remessa_item_id"))),
            "pendencias": pend,
        })
    itens.sort(key=lambda i: (str(i.get("vencimento_documento") or i.get("data_vencimento") or ""), i["descricao"] or ""))
    return {"habilitado": True, "itens": itens, "ocultos": ocultos, "totais": {k: str(v) for k, v in totais.items()}}


# ── Validação e geração ───────────────────────────────────────
def _preparar(conta_id: str, data_pagamento: date, despesa_ids: list[str], usuario: UsuarioAtual, db: Client):
    _exigir(usuario, "remessa")
    if not despesa_ids:
        raise _erro(422, "Escolha ao menos uma despesa.")
    if len(despesa_ids) > 500:
        raise _erro(422, "No máximo 500 pagamentos por remessa.")
    conta = contas_pagadoras_service.ler(conta_id, usuario, db)
    if not conta.get("ativa", True):
        raise _erro(422, "Esta conta pagadora está desativada.")
    builder = BUILDERS.get(conta["codigo_banco"])
    if not builder:
        raise _erro(422, "Banco sem leiaute de remessa.")
    despesas = {str(d["id"]): d for d in _despesas(despesa_ids, usuario, db)}
    forns = _fornecedores({str(d["fornecedor_id"]) for d in despesas.values() if d.get("fornecedor_id")}, usuario, db)
    return conta, builder, despesas, forns


def _checar_item(d: dict | None, usuario: UsuarioAtual, confid: set[str]) -> list[str]:
    if not d:
        return ["Despesa não encontrada."]
    erros = []
    if d.get("status") != "aprovada":
        erros.append("A despesa ainda não foi aprovada.")
    if d.get("paga_em"):
        erros.append("A despesa já tem data de pagamento.")
    if d.get("status_pagamento") not in LIVRES:
        erros.append("O pagamento já está em outra remessa ou foi pago.")
    if str(d.get("tipo_lancamento_id")) in confid and not _ve_salario(usuario):
        erros.append("Salário: só o Admin inclui em remessa.")
    if not d.get("forma_pagamento"):
        erros.append("Sem forma de pagamento: preencha o bloco Pagamento da despesa.")
    return erros


def _duplicados(despesas: list[dict], data_pag: date, usuario: UsuarioAtual, db: Client) -> dict[str, str]:
    """Aviso: mesmo favorecido e mesmo valor já pago/em andamento em ±5 dias."""
    forn_ids = list({str(d["fornecedor_id"]) for d in despesas if d.get("fornecedor_id")})
    if not forn_ids:
        return {}
    outras = _q(usuario, db.table("despesas").select(
        "id, fornecedor_id, valor, valor_pagamento, data_vencimento, paga_em, status_pagamento")
        .in_("fornecedor_id", forn_ids)).execute().data or []
    proprias = {str(d["id"]) for d in despesas}
    avisos = {}
    for d in despesas:
        for o in outras:
            if str(o["id"]) in proprias or str(o.get("fornecedor_id")) != str(d.get("fornecedor_id")):
                continue
            if not (o.get("status_pagamento") in (*EM_ANDAMENTO, "paga", "paga_manual") or o.get("paga_em")):
                continue
            if _valor(o) != _valor(d):
                continue
            quando = o.get("paga_em") or o.get("data_vencimento")
            if quando and abs((date.fromisoformat(str(quando)[:10]) - data_pag).days) <= 5:
                avisos[str(d["id"])] = "Já existe pagamento do mesmo valor para este favorecido em até 5 dias."
                break
    return avisos


def validar(conta_id: str, data_pagamento: date, despesa_ids: list[str], usuario: UsuarioAtual, db: Client) -> dict:
    conta, builder, despesas, forns = _preparar(conta_id, data_pagamento, despesa_ids, usuario, db)
    confid = ids_confidenciais(db)
    hoje = date.today()
    resultado, lotes = [], {}
    total = Decimal(0)
    for did in despesa_ids:
        d = despesas.get(str(did))
        erros = _checar_item(d, usuario, confid)
        item = None
        if d and not erros:
            item = _item(d, forns.get(str(d.get("fornecedor_id"))), data_pagamento, "MX", confid)
            erros = builder.validar(item, hoje)
        lote = None
        if item and not erros:
            forma, servico = builder.classificar(item)
            lote = f"{forma}/{servico}"
            g = lotes.setdefault(lote, {"forma_lancamento": forma, "tipo_servico": servico, "qtd": 0, "valor": Decimal(0)})
            g["qtd"] += 1
            g["valor"] += item.valor
            total += item.valor
        resultado.append({"despesa_id": str(did), "descricao": (d or {}).get("descricao"),
                          "valor": str(_valor(d)) if d else None, "forma_pagamento": (d or {}).get("forma_pagamento"),
                          "ok": not erros, "erros": erros, "lote": lote})
    validos = [r for r in resultado if r["ok"]]
    for did, msg in _duplicados([despesas[r["despesa_id"]] for r in validos], data_pagamento, usuario, db).items():
        next(r for r in resultado if r["despesa_id"] == did).setdefault("avisos", []).append(msg)

    avisos = []
    formas_validas = {despesas[r["despesa_id"]].get("forma_pagamento") for r in validos}
    if hasattr(builder, "separar") and formas_validas & {"pix", "pix_qr"} and formas_validas - {"pix", "pix_qr"}:
        avisos.append("O Itaú exige os Pix num arquivo separado: serão gerados 2 arquivos, importe os dois.")
    so_pix = all((despesas[r["despesa_id"]].get("forma_pagamento") in ("pix", "pix_qr")) for r in validos) if validos else False
    sugerida = data_pagamento
    if data_pagamento < hoje:
        avisos.append("A data de pagamento já passou.")
    elif not so_pix and not dias_uteis.eh_dia_util(data_pagamento):
        sugerida = dias_uteis.proximo_dia_util(data_pagamento)
        avisos.append(f"{data_pagamento:%d/%m/%Y} não é dia útil: o banco paga no próximo dia útil ({sugerida:%d/%m/%Y}). "
                      "Pix pode ser em dia não útil.")
    opcoes = conta.get("opcoes") or {}
    if conta.get("ambiente") == "homologacao":
        if opcoes.get("sequencial_teste") and conta.get("proximo_nsa", 1) <= 10:
            avisos.append(f"Conta em homologação: o arquivo nº {conta['proximo_nsa']} é tratado pelo banco como TESTE.")
        else:
            avisos.append("Conta em homologação, mas o banco processa o arquivo como REAL. "
                          "Para testar sem pagar, use o sequencial de teste do convênio.")
    return {
        "itens": resultado, "validos": len(validos), "invalidos": len(resultado) - len(validos),
        "valor_total": str(total), "data_pagamento": data_pagamento.isoformat(), "data_sugerida": sugerida.isoformat(),
        "lotes": [{**g, "valor": str(g["valor"])} for g in lotes.values()], "avisos": avisos,
        "conta": {"id": conta["id"], "codigo_banco": conta["codigo_banco"], "ambiente": conta.get("ambiente"),
                  "proximo_nsa": conta.get("proximo_nsa")},
    }


def _marcar(ids: list[str], usuario: UsuarioAtual, db: Client) -> set[str]:
    """Marca "em remessa" só as despesas livres (UPDATE condicional)."""
    marcadas: set[str] = set()
    base = {"status_pagamento": "em_remessa"}
    r1 = _q(usuario, db.table("despesas").update(base).in_("id", ids).eq("status", "aprovada")
            .is_("paga_em", "null").is_("status_pagamento", "null")).execute().data or []
    r2 = _q(usuario, db.table("despesas").update(base).in_("id", ids).eq("status", "aprovada")
            .is_("paga_em", "null").in_("status_pagamento", ["rejeitada", "devolvida"])).execute().data or []
    marcadas |= {str(r["id"]) for r in r1 + r2}
    return marcadas


def _desfazer(anteriores: dict[str, str | None], usuario: UsuarioAtual, db: Client) -> None:
    for did, status in anteriores.items():
        try:
            _q(usuario, db.table("despesas").update({"status_pagamento": status, "remessa_item_id": None})
               .eq("id", did)).execute()
        except Exception as e:  # noqa: BLE001
            logger.error("remessa_desfazer_falhou", despesa_id=did, erro=str(e))


def _reservar_nsa(conta: dict, db: Client) -> int:
    resp = db.rpc("cnab_reservar_nsa", {"p_conta_id": conta["id"]}).execute()
    dado = resp.data
    if isinstance(dado, list):
        dado = dado[0] if dado else None
    if isinstance(dado, dict):
        dado = next(iter(dado.values()), None)
    if not dado:
        raise _erro(500, "Não foi possível reservar o número do arquivo (NSA).")
    return int(dado)


def gerar(conta_id: str, data_pagamento: date, despesa_ids: list[str], usuario: UsuarioAtual, db: Client) -> dict:
    ids = list(dict.fromkeys(str(i) for i in despesa_ids))
    previa = validar(conta_id, data_pagamento, ids, usuario, db)
    if previa["invalidos"]:
        raise _erro(422, {"mensagem": "Há pagamentos com pendência: remova-os ou corrija antes de gerar.",
                          "itens": [r for r in previa["itens"] if not r["ok"]]})
    if data_pagamento < date.today():
        raise _erro(422, "A data de pagamento já passou.")
    conta, builder, despesas, forns = _preparar(conta_id, data_pagamento, ids, usuario, db)
    opcoes = conta.get("opcoes") or {}
    if conta.get("ambiente") == "producao" and opcoes.get("sequencial_teste") and conta.get("proximo_nsa", 1) <= 10:
        raise _erro(422, "Conta em produção com sequencial de teste: ajuste o próximo NSA para 11 ou mais.")

    anteriores = {did: despesas[did].get("status_pagamento") for did in ids}
    marcadas = _marcar(ids, usuario, db)
    if marcadas != set(ids):
        _desfazer({d: anteriores[d] for d in marcadas}, usuario, db)
        raise _erro(409, "Alguma despesa entrou em outra remessa agora há pouco. Atualize a lista e tente de novo.")

    try:
        confid = ids_confidenciais(db)
        tenant = _tenant(usuario)
        base = [_item(despesas[did], forns.get(str(despesas[did].get("fornecedor_id"))), data_pagamento, "", confid)
                for did in ids]
        grupos = builder.separar(base) if hasattr(builder, "separar") else [("geral", base)]
        remessa = db.table("remessas").insert({
            "tenant_id": tenant, "conta_id": conta["id"], "data_pagamento": data_pagamento.isoformat(),
            "status": "gerada", "ambiente": conta.get("ambiente") or "homologacao", "qtd_itens": len(base),
            "valor_total": str(sum((i.valor for i in base), Decimal(0))), "criado_por": usuario.user_id,
        }).execute().data[0]
        por_despesa: dict[str, dict] = {}
        nsas = []
        for tipo, itens in grupos:
            nsa = _reservar_nsa(conta, db)
            nsas.append(nsa)
            for n, it in enumerate(itens, start=1):
                it.seu_numero = seu_numero(conta["codigo_banco"], nsa, n)
            arq = builder.gerar(_empresa(conta), itens, nsa)
            conteudo = arq.texto.encode("ascii")
            sufixo = "_PIX" if tipo == "pix" else ""
            nome = f"PAG{conta['codigo_banco']}_{data_pagamento:%Y%m%d}_{nsa:06d}{sufixo}.REM"
            path = f"{tenant or 'geral'}/remessas/{remessa['id']}/{nome}"
            db.storage.from_(BUCKET).upload(path, conteudo, {"content-type": "text/plain", "upsert": "false"})
            arquivo = db.table("remessa_arquivos").insert({
                "remessa_id": remessa["id"], "tenant_id": tenant, "tipo": tipo, "nsa": nsa, "layout": builder.LAYOUT,
                "path": path, "nome_arquivo": nome, "sha256": hashlib.sha256(conteudo).hexdigest(),
                "qtd_itens": len(itens), "valor_total": str(arq.valor_total),
            }).execute().data[0]
            linhas_itens = db.table("remessa_itens").insert([{
                "remessa_id": remessa["id"], "arquivo_id": arquivo["id"], "tenant_id": tenant, "despesa_id": it.ref,
                "fornecedor_id": despesas[it.ref].get("fornecedor_id"), "forma_pagamento": it.forma,
                "lote": arq.posicoes[it.ref][0], "sequencial": arq.posicoes[it.ref][1], "seu_numero": it.seu_numero,
                "valor": str(it.valor), "status": "em_remessa",
            } for it in itens]).execute().data or []
            for r in linhas_itens:
                por_despesa[str(r["despesa_id"])] = {**r, "nsa": nsa}
        for did, r in por_despesa.items():
            _q(usuario, db.table("despesas").update({"remessa_item_id": r["id"]}).eq("id", did)).execute()
        db.table("despesa_pagamento_eventos").insert([{
            "tenant_id": tenant, "despesa_id": did, "item_id": r["id"], "evento": "incluida_remessa",
            "detalhe": {"remessa_id": remessa["id"], "nsa": r["nsa"], "seu_numero": r["seu_numero"]},
            "usuario_id": usuario.user_id,
        } for did, r in por_despesa.items()]).execute()
    except Exception:
        _desfazer(anteriores, usuario, db)
        raise
    logger.info("remessa_gerada", remessa_id=remessa["id"], nsa=nsas, itens=len(base))
    return detalhe(remessa["id"], usuario, db)


# ── Consulta e ciclo de vida ──────────────────────────────────
def listar(usuario: UsuarioAtual, db: Client) -> list[dict]:
    _exigir(usuario, "visualizar")
    try:
        linhas = _q(usuario, db.table("remessas").select("*").order("criado_em", desc=True).limit(200)).execute().data or []
        arquivos = _q(usuario, db.table("remessa_arquivos").select("id, remessa_id, nsa, nome_arquivo, tipo")
                      ).execute().data or [] if linhas else []
    except Exception as e:  # noqa: BLE001
        if _sem_estrutura(e):
            return []
        raise
    contas = {c["id"]: c["descricao"] for c in contas_pagadoras_service.listar(usuario, db)}
    for r in linhas:
        r["conta"] = contas.get(r.get("conta_id"))
        r["arquivos"] = [a for a in arquivos if a["remessa_id"] == r["id"]]
    return linhas


def _ler_remessa(remessa_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    try:
        linhas = _q(usuario, db.table("remessas").select("*").eq("id", str(remessa_id))).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_estrutura(e):
            raise _indisponivel() from e
        raise
    if not linhas:
        raise _erro(404, "Remessa não encontrada.")
    return linhas[0]


def detalhe(remessa_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    _exigir(usuario, "visualizar")
    r = _ler_remessa(remessa_id, usuario, db)
    arquivos = db.table("remessa_arquivos").select("id, tipo, nsa, nome_arquivo, sha256, qtd_itens, valor_total, retorno_ok, criado_em") \
        .eq("remessa_id", r["id"]).execute().data or []
    itens = db.table("remessa_itens").select("*").eq("remessa_id", r["id"]).execute().data or []
    despesas = {str(d["id"]): d for d in (_q(usuario, db.table("despesas").select("id, descricao, tipo_lancamento_id")
                .in_("id", [i["despesa_id"] for i in itens])).execute().data or [])} if itens else {}
    forns = _fornecedores({str(i["fornecedor_id"]) for i in itens if i.get("fornecedor_id")}, usuario, db)
    confid = set() if _ve_salario(usuario) else ids_confidenciais(db)
    saida = []
    for i in sorted(itens, key=lambda x: (x.get("lote") or 0, x.get("sequencial") or 0)):
        d = despesas.get(str(i["despesa_id"]), {})
        oculto = str(d.get("tipo_lancamento_id")) in confid
        saida.append({
            "id": i["id"], "despesa_id": i["despesa_id"], "seu_numero": i["seu_numero"],
            "descricao": "Salário (confidencial)" if oculto else d.get("descricao"),
            "favorecido": None if oculto else (forns.get(str(i.get("fornecedor_id"))) or {}).get("nome"),
            "forma_pagamento": i["forma_pagamento"], "valor": str(i["valor"]), "status": i["status"],
            "ocorrencias": i.get("ocorrencias") or [], "motivo": i.get("motivo"), "lote": i.get("lote"),
        })
    contas = {c["id"]: c for c in contas_pagadoras_service.listar(usuario, db)}
    conta = contas.get(r.get("conta_id")) or {}
    return {**r, "conta": conta.get("descricao"), "codigo_banco": conta.get("codigo_banco"),
            "arquivos": arquivos, "itens": saida}


def url_arquivo(remessa_id: UUID, arquivo_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    _exigir(usuario, "remessa")
    r = _ler_remessa(remessa_id, usuario, db)
    arqs = db.table("remessa_arquivos").select("path, nome_arquivo").eq("id", str(arquivo_id)) \
        .eq("remessa_id", r["id"]).execute().data or []
    if not arqs:
        raise _erro(404, "Arquivo não encontrado.")
    assinada = db.storage.from_(BUCKET).create_signed_url(arqs[0]["path"], 300, {"download": arqs[0]["nome_arquivo"]})
    return {"url": assinada.get("signedURL") or assinada.get("signed_url"), "nome": arqs[0]["nome_arquivo"]}


def marcar_enviada(remessa_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    _exigir(usuario, "remessa")
    r = _ler_remessa(remessa_id, usuario, db)
    if r["status"] != "gerada":
        raise _erro(409, "Só uma remessa recém-gerada pode ser marcada como enviada.")
    db.table("remessas").update({"status": "enviada", "enviada_em": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", r["id"]).execute()
    return detalhe(r["id"], usuario, db)


def cancelar(remessa_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    """Devolve as despesas para "a pagar". Não cancela nada no banco: se o
    arquivo já foi enviado, o agendamento precisa ser excluído lá também."""
    _exigir(usuario, "remessa")
    r = _ler_remessa(remessa_id, usuario, db)
    if r["status"] in ("cancelada", "processada"):
        raise _erro(409, "Esta remessa já está encerrada.")
    itens = db.table("remessa_itens").select("id, despesa_id, status").eq("remessa_id", r["id"]).execute().data or []
    if any(i["status"] in ("agendada", "paga") for i in itens):
        raise _erro(409, "O banco já agendou ou pagou itens desta remessa: cancele o agendamento no banco, "
                         "e a baixa vem pelo retorno.")
    tenant = _tenant(usuario)
    for i in itens:
        if i["status"] in ("em_remessa", "bloqueada_banco"):
            db.table("remessa_itens").update({"status": "cancelado"}).eq("id", i["id"]).execute()
            _q(usuario, db.table("despesas").update({"status_pagamento": None, "remessa_item_id": None})
               .eq("id", i["despesa_id"]).eq("remessa_item_id", i["id"])).execute()
    if itens:
        db.table("despesa_pagamento_eventos").insert([{
            "tenant_id": tenant, "despesa_id": i["despesa_id"], "item_id": i["id"], "evento": "remessa_cancelada",
            "detalhe": {"remessa_id": r["id"]}, "usuario_id": usuario.user_id,
        } for i in itens]).execute()
    db.table("remessas").update({"status": "cancelada", "cancelada_em": datetime.now(timezone.utc).isoformat()}) \
        .eq("id", r["id"]).execute()
    return detalhe(r["id"], usuario, db)


def dia_util(data: date) -> dict:
    return {"data": data.isoformat(), "dia_util": dias_uteis.eh_dia_util(data),
            "proximo": dias_uteis.proximo_dia_util(data).isoformat(),
            "sugestao_hoje": dias_uteis.proximo_dia_util(date.today() + timedelta(days=0)).isoformat()}


def resumo(usuario: UsuarioAtual, db: Client) -> dict:
    """Quadros do dashboard: a pagar até hoje, com o banco (por banco) e
    rejeitados/devolvidos. Salário confidencial só entra para o Admin."""
    _exigir(usuario, "visualizar")
    try:
        linhas = _q(usuario, db.table("despesas").select(
            "id, valor, valor_pagamento, data_vencimento, vencimento_boleto, tipo_lancamento_id, status_pagamento, "
            "remessa_item_id").eq("status", "aprovada").is_("paga_em", "null")).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_estrutura(e):
            return {"habilitado": False}
        raise
    if not _ve_salario(usuario):
        confid = ids_confidenciais(db)
        linhas = [d for d in linhas if str(d.get("tipo_lancamento_id")) not in confid]
    hoje = date.today().isoformat()

    def soma(ds):
        return {"qtd": len(ds), "valor": str(sum((_valor(d) for d in ds), Decimal(0)))}

    vencendo = [d for d in linhas if d.get("status_pagamento") in LIVRES and d.get("status_pagamento") is None
                and str(d.get("vencimento_boleto") or d.get("data_vencimento") or "9999")[:10] <= hoje]
    rejeitados = [d for d in linhas if d.get("status_pagamento") in ("rejeitada", "devolvida")]
    andamento = [d for d in linhas if d.get("status_pagamento") in EM_ANDAMENTO and d.get("remessa_item_id")]
    por_banco: dict[str, list] = {}
    if andamento:
        itens = {str(i["id"]): i for i in (db.table("remessa_itens").select("id, remessa_id")
                 .in_("id", [str(d["remessa_item_id"]) for d in andamento]).execute().data or [])}
        rems = {r["id"]: r for r in (db.table("remessas").select("id, conta_id")
                .in_("id", list({i["remessa_id"] for i in itens.values()})).execute().data or [])} if itens else {}
        contas = {c["id"]: c["codigo_banco"] for c in (db.table("contas_pagadoras").select("id, codigo_banco")
                  .in_("id", list({r["conta_id"] for r in rems.values()})).execute().data or [])} if rems else {}
        for d in andamento:
            it = itens.get(str(d["remessa_item_id"]), {})
            banco = contas.get(rems.get(it.get("remessa_id"), {}).get("conta_id"), "?")
            por_banco.setdefault({"033": "Santander", "341": "Itaú"}.get(banco, "Outro"), []).append(d)
    return {"habilitado": True, "a_pagar_hoje": soma(vencendo), "rejeitados": soma(rejeitados),
            "com_o_banco": {b: soma(ds) for b, ds in por_banco.items()},
            "autorizar": soma([d for d in andamento if d.get("status_pagamento") == "bloqueada_banco"])}
