"""Remessa Santander — Pagamento a Fornecedores V11.7.

`validar(item)` devolve os motivos que impedem o item de entrar no arquivo;
`gerar(...)` monta o arquivo (lotes por forma de lançamento e tipo de serviço).
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.cnab import pix
from app.cnab.engine import registro
from app.cnab.layouts import santander_v11_7 as L
from app.cnab.modelo import ArquivoGerado, Empresa, Favorecido, ItemPagamento, LoteGerado
from app.cnab.normalize import so_alfanum, so_digitos
from app.cnab.validators import documento_valido

LAYOUT = "santander_pagamentos_240_v11_7"
BRT = timezone(timedelta(hours=-3))

_INICIACAO = {"telefone": "01", "email": "02", "cpf_cnpj": "03", "aleatoria": "04"}
# Formas de lançamento (nota G002) → versão do lote (G031) e segmento principal.
_VERSAO = {"01": "031", "03": "031", "05": "031", "45": "031", "47": "031",
           "30": "030", "31": "030", "11": "010", "16": "010", "17": "010"}


def tipo_inscricao(doc: str | None) -> str:
    d = so_alfanum(doc)
    return "1" if len(d) == 11 else ("2" if len(d) == 14 else "0")


def _chave_tipo(chave: str) -> str | None:
    from app.cnab.validators import chave_pix_valida
    for tipo in ("aleatoria", "email", "telefone", "cpf_cnpj"):
        if chave_pix_valida(tipo, chave):
            return tipo
    return None


def classificar(item: ItemPagamento) -> tuple[str, str]:
    """(forma de lançamento G002, tipo de serviço G015)."""
    servico = "98" if item.salario else "20"
    f = item.favorecido
    if item.forma == "credito_conta":
        return ("05" if f and f.tipo_conta == "poupanca" else "01"), servico
    if item.forma == "ted":
        return "03", servico
    if item.forma == "pix":
        return "45", servico
    if item.forma == "pix_qr":
        br = pix.ler(item.pix_copia_cola or "")
        return ("47" if br.dinamico else "45"), servico
    if item.forma == "boleto":
        return ("30" if (item.codigo_barras or "").startswith("033") else "31"), servico
    if item.forma == "concessionaria":
        return "11", "22"
    if item.forma == "tributo":
        return ("17" if (item.tributo or {}).get("tipo") == "gps" else "16"), "22"
    raise ValueError(f"forma desconhecida: {item.forma}")


def validar(item: ItemPagamento, hoje: date | None = None) -> list[str]:
    erros: list[str] = []
    f = item.favorecido
    if item.valor is None or item.valor <= 0:
        erros.append("Valor a pagar zerado.")
    if hoje and item.data_pagamento < hoje:
        erros.append("Data de pagamento no passado.")

    def precisa_doc():
        if not f or not f.cpf_cnpj:
            erros.append("O favorecido não tem CPF/CNPJ cadastrado.")
        elif not documento_valido(f.cpf_cnpj):
            erros.append("CPF/CNPJ do favorecido inválido.")

    def precisa_conta():
        if not f or not f.conta or not (f.banco_codigo or f.ispb):
            erros.append("O favorecido não tem conta cadastrada.")
        elif f.tipo_conta == "pagamento":
            erros.append("Conta de pagamento ainda não é aceita na remessa: use Pix pela chave.")

    if item.forma in ("pix", "ted", "credito_conta") and not f:
        return erros + ["Escolha o favorecido."]
    if item.forma == "credito_conta":
        precisa_conta()
        if f.banco_codigo and f.banco_codigo != "033":
            erros.append("Crédito em conta é só para conta Santander: use TED ou Pix.")
        precisa_doc()
    elif item.forma == "ted":
        precisa_conta()
        if f.banco_codigo == "033":
            erros.append("Conta Santander: use Crédito em conta em vez de TED.")
        precisa_doc()
    elif item.forma == "pix":
        precisa_doc()
        if f.pix_chave:
            if f.pix_tipo_chave == "cpf_cnpj" and so_alfanum(f.pix_chave) != so_alfanum(f.cpf_cnpj):
                erros.append("A chave Pix CPF/CNPJ precisa ser o documento do próprio favorecido.")
            if len(f.pix_chave) > 99:
                erros.append("Chave Pix longa demais.")
        else:
            precisa_conta()
    elif item.forma == "pix_qr":
        try:
            br = pix.ler(item.pix_copia_cola or "")
        except pix.PixInvalido as e:
            return erros + [str(e)]
        if br.dinamico:
            if len(br.url or "") > 79:
                erros.append("O endereço do QR Code é longo demais para o arquivo do banco.")
        else:
            if not br.chave or not _chave_tipo(br.chave):
                erros.append("QR Code estático sem chave Pix válida.")
            precisa_doc()
    elif item.forma == "boleto":
        cb = so_digitos(item.codigo_barras)
        if len(cb) != 44 or cb.startswith("8"):
            erros.append("Boleto sem código de barras válido.")
        if not item.cedente_doc or not documento_valido(item.cedente_doc):
            erros.append("O banco exige o CPF/CNPJ do beneficiário do boleto.")
    elif item.forma == "concessionaria":
        cb = so_digitos(item.codigo_barras)
        if len(cb) != 44 or not cb.startswith("8"):
            erros.append("Conta/tributo sem código de barras válido.")
    elif item.forma == "tributo":
        t = item.tributo or {}
        if not so_digitos(t.get("codigo_receita")):
            erros.append("Tributo sem código da receita.")
        if t.get("tipo") == "darf":
            if not t.get("periodo_apuracao"):
                erros.append("DARF sem período de apuração.")
            if _darf_principal(item) <= 0:
                erros.append("DARF: multa + juros maiores que o valor a pagar.")
        elif t.get("tipo") == "gps":
            if not t.get("competencia"):
                erros.append("GPS sem competência.")
        else:
            erros.append("Tributo sem tipo (DARF ou GPS).")
    else:
        erros.append("Forma de pagamento não informada.")
    return erros


def _dec(v) -> Decimal:
    try:
        return Decimal(str(v or 0))
    except Exception:  # noqa: BLE001
        return Decimal(0)


def _darf_principal(item: ItemPagamento) -> Decimal:
    t = item.tributo or {}
    return item.valor - _dec(t.get("valor_multa")) - _dec(t.get("valor_juros"))


def convenio(empresa: Empresa) -> str:
    """Nota G009: banco (4) + agência (4, sem DV) + convênio (12)."""
    return "0033" + so_digitos(empresa.agencia).zfill(4)[-4:] + so_digitos(empresa.convenio).zfill(12)


def _empresa(empresa: Empresa) -> dict:
    return {"cnpj": empresa.cnpj, "convenio": convenio(empresa), "agencia": empresa.agencia,
            "agencia_dv": empresa.agencia_dv, "conta": empresa.conta, "conta_dv": empresa.conta_dv,
            "nome_empresa": empresa.razao_social}


def _detalhes(item: ItemPagamento, empresa: Empresa, forma: str, instrucao: str) -> list[tuple]:
    """Segmentos de um item: [(layout, valores, soma no trailer?)]."""
    f = item.favorecido or Favorecido(nome=item.cedente_nome or item.descricao or "")
    base = {"seu_numero": item.seu_numero, "data_pagamento": item.data_pagamento, "instrucao": instrucao}

    if forma in ("01", "03", "05"):
        camara = "000" if forma in ("01", "05") else ("888" if (f.ispb and not f.banco_codigo) else "018")
        a = {**base, "camara": camara, "banco_favorecido": f.banco_codigo or "000",
             "agencia_favorecido": f.agencia, "conta_favorecido": f.conta, "conta_dv": f.conta_dv,
             "nome_favorecido": f.nome, "valor": item.valor,
             "finalidade_ted": ("00010" if item.salario else "00005") if forma == "03" else "",
             "finalidade_complementar": "PP" if f.tipo_conta == "poupanca" else "CC"}
        b = {"tipo_inscricao": tipo_inscricao(f.cpf_cnpj), "documento": f.cpf_cnpj,
             "vencimento": item.data_pagamento, "valor_documento": item.valor,
             "ted_instituicao": "N" if forma == "03" else "", "ispb": f.ispb or ""}
        return [(L.SEG_A, a, True), (L.SEG_B, b, False)]

    if forma == "45":
        txid, chave, tipo_chave = "", f.pix_chave, f.pix_tipo_chave
        if item.forma == "pix_qr":
            br = pix.ler(item.pix_copia_cola or "")
            chave, tipo_chave, txid = br.chave, _chave_tipo(br.chave or ""), (br.txid or "")[:25]
        por_chave = bool(chave)
        a = {**base, "camara": "009", "nome_favorecido": f.nome, "valor": item.valor,
             "finalidade_complementar": "PP" if f.tipo_conta == "poupanca" else "CC"}
        if not por_chave:
            a.update(banco_favorecido=f.banco_codigo or "000", agencia_favorecido=f.agencia,
                     conta_favorecido=f.conta, conta_dv=f.conta_dv)
        info12 = (so_alfanum(chave) if tipo_chave == "cpf_cnpj" else chave) if por_chave else \
            ("03" if f.tipo_conta == "poupanca" else "01")
        b = {"forma_iniciacao": _INICIACAO.get(tipo_chave or "", "05") if por_chave else "05",
             "tipo_inscricao": tipo_inscricao(f.cpf_cnpj), "documento": f.cpf_cnpj, "txid": txid,
             "chave": info12, "ispb": "" if por_chave or f.banco_codigo else (f.ispb or "")}
        return [(L.SEG_A, a, True), (L.SEG_B_PIX, b, False)]

    if forma == "47":
        br = pix.ler(item.pix_copia_cola or "")
        j = {**base, "nome_beneficiario": br.nome_recebedor or f.nome, "valor_pagamento": item.valor}
        j52 = {"devedor_doc": empresa.cnpj, "devedor_nome": empresa.razao_social,
               "recebedor_tipo": "0", "recebedor_nome": br.nome_recebedor or f.nome, "url": br.url}
        return [(L.SEG_J_PIX, j, True), (L.SEG_J52_PIX, j52, False)]

    if forma in ("30", "31"):
        from app.cnab import barcode
        cb = barcode.ler(item.codigo_barras or "", item.data_pagamento)
        nominal = cb.valor or item.valor
        diferenca = item.valor - nominal
        j = {**base, "codigo_barras": cb.codigo, "nome_beneficiario": item.cedente_nome or f.nome,
             "vencimento": cb.vencimento or item.vencimento or item.data_pagamento,
             "valor_nominal": nominal, "desconto": -diferenca if diferenca < 0 else 0,
             "multa_juros": diferenca if diferenca > 0 else 0, "valor_pagamento": item.valor}
        j52 = {"pagador_doc": empresa.cnpj, "pagador_nome": empresa.razao_social,
               "beneficiario_tipo": tipo_inscricao(item.cedente_doc), "beneficiario_doc": item.cedente_doc,
               "beneficiario_nome": item.cedente_nome or f.nome, "sacador_tipo": "0"}
        return [(L.SEG_J, j, True), (L.SEG_J52, j52, False)]

    if forma == "11":
        o = {**base, "codigo_barras": so_digitos(item.codigo_barras), "nome": f.nome or item.descricao,
             "vencimento": item.vencimento or item.data_pagamento, "valor": item.valor}
        return [(L.SEG_O, o, True)]

    if forma in ("16", "17"):
        t = item.tributo or {}
        doc = so_alfanum(t.get("contribuinte_doc")) or empresa.cnpj
        n = {**base, "contribuinte": empresa.razao_social, "valor_total": item.valor,
             "codigo_receita": so_digitos(t.get("codigo_receita")),
             "tipo_contribuinte": "01" if len(doc) == 11 else "02", "contribuinte_doc": doc}
        if forma == "17":
            ano, mes = (t.get("competencia") or "0000-00")[:7].split("-")
            outras = _dec(t.get("valor_outras"))
            n.update(competencia=f"{mes}{ano}", valor_inss=item.valor - outras, valor_outras=outras)
            return [(L.SEG_N_GPS, n, True)]
        n.update(periodo_apuracao=t.get("periodo_apuracao"), numero_referencia=t.get("numero_referencia") or "",
                 valor_principal=_darf_principal(item), valor_multa=_dec(t.get("valor_multa")),
                 valor_juros=_dec(t.get("valor_juros")), vencimento=item.vencimento or item.data_pagamento)
        return [(L.SEG_N_DARF, n, True)]
    raise ValueError(f"forma de lançamento sem leiaute: {forma}")


def gerar(empresa: Empresa, itens: list[ItemPagamento], nsa: int, agora: datetime | None = None) -> ArquivoGerado:
    agora = (agora or datetime.now(BRT)).astimezone(BRT)
    instrucao = "09" if (empresa.opcoes or {}).get("enviar_bloqueado", True) else "00"
    emp = _empresa(empresa)
    end = empresa.endereco or {}
    cep = so_digitos(end.get("cep")).ljust(8, "0") if end.get("cep") else ""

    grupos: "OrderedDict[tuple[str, str], list[ItemPagamento]]" = OrderedDict()
    for item in itens:
        grupos.setdefault(classificar(item), []).append(item)

    linhas = [registro(L.HEADER_ARQUIVO, {**emp, "data_geracao": agora.date(),
                                         "hora_geracao": agora.strftime("%H%M%S"), "nsa": nsa})]
    lotes: list[LoteGerado] = []
    posicoes: dict[str, tuple[int, int]] = {}
    total_arquivo = Decimal(0)
    for numero, ((forma, servico), grupo) in enumerate(sorted(grupos.items()), start=1):
        linhas.append(registro(L.HEADER_LOTE, {
            **emp, "lote": numero, "tipo_servico": servico, "forma_lancamento": forma,
            "versao_lote": _VERSAO[forma], "endereco": end.get("logradouro"), "numero": end.get("numero"),
            "complemento": end.get("complemento"), "cidade": end.get("cidade"),
            "cep": cep[:5], "cep_complemento": cep[5:], "uf": end.get("uf")}))
        seq, soma = 0, Decimal(0)
        for item in grupo:
            for i, (layout, valores, conta) in enumerate(_detalhes(item, empresa, forma, instrucao)):
                seq += 1
                if i == 0:
                    posicoes[item.ref] = (numero, seq)
                if conta:
                    soma += item.valor
                linhas.append(registro(layout, {**valores, "lote": numero, "sequencial": seq}))
        linhas.append(registro(L.TRAILER_LOTE, {"lote": numero, "qtd_registros": seq + 2, "soma_valores": soma}))
        lotes.append(LoteGerado(numero, forma, servico, len(grupo), soma))
        total_arquivo += soma
    linhas.append(registro(L.TRAILER_ARQUIVO, {"qtd_lotes": len(lotes), "qtd_registros": len(linhas) + 1}))
    return ArquivoGerado(texto="\r\n".join(linhas) + "\r\n", lotes=lotes, posicoes=posicoes,
                         valor_total=total_arquivo, qtd_registros=len(linhas))
