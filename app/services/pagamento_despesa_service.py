"""
MX Seguros — DRE-IA | Dados de pagamento da despesa (migration 0050).

Bloco "Pagamento" do lançamento: favorecido, forma, valor a pagar e o
documento (linha digitável do boleto/conta, Pix copia-e-cola, dados do
tributo). Quem vê a despesa vê o bloco; dados ficam travados enquanto o
pagamento está com o banco (em remessa, agendado, bloqueado no banco).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.cnab import barcode, pix
from app.cnab.normalize import so_alfanum, so_digitos
from app.cnab.validators import documento_valido
from app.models.pagamentos import PagamentoDespesaPayload
from app.services import fornecedores_service

COLS = ("fornecedor_id, forma_pagamento, valor_pagamento, codigo_barras, linha_digitavel, vencimento_boleto, "
        "cedente_cpf_cnpj, cedente_nome, pix_copia_cola, tributo, status_pagamento, remessa_item_id")
TRAVADOS = ("em_remessa", "agendada", "bloqueada_banco", "paga", "paga_manual")


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _sem_colunas(e: Exception) -> bool:
    s = str(e).lower()
    return "schema cache" in s or "does not exist" in s or "42703" in s or "pgrst204" in s


def _despesa(despesa_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    from app.services.anexos_service import carregar_entidade
    return carregar_entidade("despesa", despesa_id, usuario, db)


def _decimal(v: str | None, campo: str) -> Decimal | None:
    if v in (None, ""):
        return None
    try:
        d = Decimal(str(v).replace(".", "").replace(",", ".")) if "," in str(v) else Decimal(str(v))
    except InvalidOperation as exc:
        raise _erro(422, f"{campo}: valor inválido.") from exc
    if d < 0 or d > Decimal("99999999.99"):
        raise _erro(422, f"{campo}: valor fora do limite.")
    return d.quantize(Decimal("0.01"))


def _saida(row: dict) -> dict:
    out = {k: row.get(k) for k in COLS.split(", ")}
    if out.get("valor_pagamento") is not None:
        out["valor_pagamento"] = str(out["valor_pagamento"])
    return out


def obter(despesa_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    row = _despesa(despesa_id, usuario, db)
    if "status_pagamento" not in row:
        return {"habilitado": False}
    out = _saida(row)
    out["habilitado"] = True
    out["valor_despesa"] = str(row.get("valor"))
    out["favorecido"] = None
    if row.get("fornecedor_id"):
        try:
            out["favorecido"] = fornecedores_service.obter(row["fornecedor_id"], usuario, db)
        except HTTPException:
            out["favorecido"] = None
    return out


def interpretar_documento(texto: str, referencia: date | None = None) -> dict:
    """Prévia ao colar: boleto/conta (valor, vencimento) ou Pix copia-e-cola."""
    t = (texto or "").strip()
    if t.startswith("000201"):
        try:
            br = pix.ler(t)
        except pix.PixInvalido as e:
            raise _erro(422, str(e)) from e
        return {"tipo": "pix_qr", "valor": str(br.valor) if br.valor else None, "dinamico": br.dinamico,
                "recebedor": br.nome_recebedor, "cidade": br.cidade}
    try:
        cb = barcode.ler(t, referencia)
    except barcode.CodigoInvalido as e:
        raise _erro(422, str(e)) from e
    return {"tipo": "boleto" if cb.tipo == "boleto" else "concessionaria", "codigo_barras": cb.codigo,
            "valor": str(cb.valor) if cb.valor else None,
            "vencimento": cb.vencimento.isoformat() if cb.vencimento else None, "banco": cb.banco}


def salvar(despesa_id: UUID, payload: PagamentoDespesaPayload, usuario: UsuarioAtual, db: Client) -> dict:
    row = _despesa(despesa_id, usuario, db)
    if "status_pagamento" not in row:
        raise _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.")
    if row.get("status_pagamento") in TRAVADOS:
        raise _erro(409, "Este pagamento já está com o banco ou pago: os dados não podem mudar agora.")

    forma = payload.forma_pagamento
    dados: dict = {k: None for k in ("fornecedor_id", "forma_pagamento", "valor_pagamento", "codigo_barras",
                                      "linha_digitavel", "vencimento_boleto", "cedente_cpf_cnpj",
                                      "cedente_nome", "pix_copia_cola", "tributo")}
    avisos: list[str] = []
    if not forma and not payload.fornecedor_id:
        return _gravar(despesa_id, usuario, db, dados, avisos)   # limpar o bloco

    fornecedor = None
    if payload.fornecedor_id:
        fornecedor = fornecedores_service._ler(payload.fornecedor_id, usuario, db)
        dados["fornecedor_id"] = fornecedor["id"]
    forma = forma or (fornecedor or {}).get("forma_pagamento_padrao")
    dados["forma_pagamento"] = forma
    valor = _decimal(payload.valor_pagamento, "Valor a pagar") or Decimal(str(row.get("valor") or 0))
    dados["valor_pagamento"] = str(valor)

    if forma in ("pix", "ted", "credito_conta"):
        if not fornecedor:
            raise _erro(422, "Escolha o favorecido.")
        if forma == "pix" and not (fornecedor.get("pix_chave") or fornecedor.get("conta")):
            raise _erro(422, "O favorecido não tem chave Pix nem conta cadastrada.")
        if forma in ("ted", "credito_conta") and not fornecedor.get("conta"):
            raise _erro(422, "O favorecido não tem conta cadastrada.")
    elif forma in ("boleto", "concessionaria"):
        if not payload.linha_digitavel:
            raise _erro(422, "Cole a linha digitável ou o código de barras.")
        try:
            cb = barcode.ler(payload.linha_digitavel, date.fromisoformat(str(row.get("data_vencimento") or date.today())))
        except barcode.CodigoInvalido as e:
            raise _erro(422, str(e)) from e
        if forma == "boleto" and cb.tipo != "boleto":
            raise _erro(422, "Esta linha é de conta/tributo, não de boleto: escolha 'Conta ou tributo com código'.")
        if forma == "concessionaria" and cb.tipo != "arrecadacao":
            raise _erro(422, "Esta linha é de boleto bancário: escolha 'Boleto'.")
        dados["codigo_barras"] = cb.codigo
        dados["linha_digitavel"] = so_digitos(payload.linha_digitavel)
        dados["vencimento_boleto"] = cb.vencimento.isoformat() if cb.vencimento else None
        if cb.valor and cb.valor != valor:
            avisos.append(f"O documento é de R$ {cb.valor:.2f} e o valor a pagar está R$ {valor:.2f}.")
        if forma == "boleto":
            doc = so_alfanum(payload.cedente_cpf_cnpj) or so_alfanum((fornecedor or {}).get("cpf_cnpj"))
            if not doc:
                raise _erro(422, "O banco exige o CPF/CNPJ do beneficiário do boleto.")
            if not documento_valido(doc):
                raise _erro(422, "CPF/CNPJ do beneficiário inválido.")
            dados["cedente_cpf_cnpj"] = doc
            dados["cedente_nome"] = (payload.cedente_nome or (fornecedor or {}).get("nome") or "").strip() or None
    elif forma == "pix_qr":
        if not payload.pix_copia_cola:
            raise _erro(422, "Cole o Pix copia-e-cola.")
        try:
            br = pix.ler(payload.pix_copia_cola)
        except pix.PixInvalido as e:
            raise _erro(422, str(e)) from e
        dados["pix_copia_cola"] = payload.pix_copia_cola.strip()
        if br.valor and br.valor != valor:
            avisos.append(f"O QR Code é de R$ {br.valor:.2f} e o valor a pagar está R$ {valor:.2f}.")
    elif forma == "tributo":
        t = payload.tributo
        if not t or not so_digitos(t.codigo_receita):
            raise _erro(422, "Informe o código da receita do tributo.")
        if t.tipo == "darf" and not t.periodo_apuracao:
            raise _erro(422, "Informe o período de apuração do DARF.")
        if t.tipo == "gps" and not t.competencia:
            raise _erro(422, "Informe a competência da GPS.")
        if t.contribuinte_doc and not so_alfanum(t.contribuinte_doc):
            raise _erro(422, "Identificação do contribuinte inválida.")
        dados["tributo"] = {k: v for k, v in t.model_dump().items() if v not in (None, "")}
    return _gravar(despesa_id, usuario, db, dados, avisos)


def _gravar(despesa_id, usuario: UsuarioAtual, db: Client, dados: dict, avisos: list[str]) -> dict:
    q = db.table("despesas").update(dados).eq("id", str(despesa_id))
    if getattr(usuario, "tenant_id", None):
        q = q.eq("tenant_id", usuario.tenant_id)
    try:
        q.execute()
    except Exception as e:  # noqa: BLE001
        if _sem_colunas(e):
            raise _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.") from e
        raise
    out = obter(despesa_id, usuario, db)
    out["avisos"] = avisos
    return out
