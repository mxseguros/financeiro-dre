"""Remessa Itaú — SISPAG CNAB 240 versão 086 (fev/2024).

Particularidades (ver o leiaute): lotes Pix vão num arquivo separado
(`separar`), tipo de movimento com 3 dígitos, agência/conta no formato da
nota 11, J com os 44 dígitos do código de barras, O com a representação de 48
posições e salário (tipo 30) só por crédito em conta Itaú — o resto sai como
tipo 98, menos o Pix QR Code, que é sempre tipo 20 (Instruções de Procedimentos). O manual é anterior ao CNPJ com letras: esses favorecidos são barrados.
"""
from __future__ import annotations

from collections import OrderedDict
from datetime import date, datetime
from decimal import Decimal

from app.cnab import barcode, pix
from app.cnab.builders.santander import BRT, _dec, tipo_inscricao
from app.cnab.engine import registro
from app.cnab.layouts import itau_sispag_v086 as L
from app.cnab.modelo import ArquivoGerado, Empresa, Favorecido, ItemPagamento, LoteGerado
from app.cnab.normalize import so_alfanum, so_digitos
from app.cnab.validators import cnpj_alfanumerico, documento_valido

LAYOUT = "itau_sispag_240_v086"
_TIPO_CHAVE = {"telefone": "01", "email": "02", "cpf_cnpj": "03", "aleatoria": "04"}
_A = {"01", "05", "41", "45"}
_J = {"30", "31", "47"}
_O = {"13", "19", "91"}
_N = {"16", "17"}


def separar(itens: list[ItemPagamento]) -> list[tuple[str, list[ItemPagamento]]]:
    """Pág. 7: lotes Pix obrigatoriamente em arquivo separado das demais formas."""
    pixs = [i for i in itens if i.forma in ("pix", "pix_qr")]
    outros = [i for i in itens if i.forma not in ("pix", "pix_qr")]
    return [(t, g) for t, g in (("geral", outros), ("pix", pixs)) if g]


def classificar(item: ItemPagamento) -> tuple[str, str]:
    """(forma de pagamento — nota 5, tipo de pagamento — nota 4)."""
    f = item.favorecido
    servico = "98" if item.salario else "20"
    if item.forma == "credito_conta":
        forma = "05" if f and f.tipo_conta == "poupanca" else "01"
        return forma, ("30" if item.salario and forma == "01" else servico)
    if item.forma == "ted":
        return "41", servico
    if item.forma == "pix":
        return "45", servico
    if item.forma == "pix_qr":
        return "47", "20"                # QR Code (inclusive FGTS Digital) é sempre tipo 20
    if item.forma == "boleto":
        return ("30" if (item.codigo_barras or "").startswith("341") else "31"), servico
    if item.forma == "concessionaria":
        segmento = so_digitos(item.codigo_barras)[1:2]
        if segmento == "1":
            return "19", "22"            # IPTU/ISS/tributos municipais
        if segmento in ("5", "7"):
            return "91", "22"            # GNRE e tributos com código de barras (DAS, multas)
        return "13", "20"                # concessionárias (água, luz, gás, telefone…)
    if item.forma == "tributo":
        return ("17" if (item.tributo or {}).get("tipo") == "gps" else "16"), "22"
    raise ValueError(f"forma desconhecida: {item.forma}")


def _docs(item: ItemPagamento) -> list[str]:
    return [d for d in ((item.favorecido.cpf_cnpj if item.favorecido else None), item.cedente_doc,
                        (item.tributo or {}).get("contribuinte_doc")) if d]


def validar(item: ItemPagamento, hoje: date | None = None) -> list[str]:
    erros: list[str] = []
    f = item.favorecido
    if item.valor is None or item.valor <= 0:
        erros.append("Valor a pagar zerado.")
    if hoje and item.data_pagamento < hoje:
        erros.append("Data de pagamento no passado.")
    if any(cnpj_alfanumerico(d) for d in _docs(item)):
        erros.append("O manual do Itaú (SISPAG v086) ainda não aceita CNPJ com letras: pague pelo Santander.")

    def precisa_doc():
        if not f or not f.cpf_cnpj:
            erros.append("O favorecido não tem CPF/CNPJ cadastrado.")
        elif not documento_valido(f.cpf_cnpj):
            erros.append("CPF/CNPJ do favorecido inválido.")

    if item.forma in ("pix", "ted", "credito_conta") and not f:
        return erros + ["Escolha o favorecido."]
    if item.forma == "credito_conta":
        precisa_doc()
        if f.banco_codigo != "341":
            erros.append("Crédito em conta é só para conta Itaú: use TED ou Pix.")
        elif len(so_digitos(f.agencia)) > 4 or len(so_digitos(f.conta)) > 6 or not f.conta_dv:
            erros.append("Conta Itaú: agência com 4 números, conta com até 6 e o dígito (DAC).")
        if f.tipo_conta == "pagamento":
            erros.append("Conta de pagamento não recebe crédito em conta: use Pix.")
    elif item.forma == "ted":
        precisa_doc()
        if not f.conta or not (f.banco_codigo or f.ispb):
            erros.append("O favorecido não tem conta cadastrada.")
        elif f.banco_codigo == "341":
            erros.append("Conta Itaú: use Crédito em conta em vez de TED.")
        if f.tipo_conta == "pagamento":
            erros.append("TED para conta de pagamento ainda não é gerada pelo sistema: use Pix.")
    elif item.forma == "pix":
        precisa_doc()
        if f.pix_chave:
            if len(f.pix_chave) > 100:
                erros.append("Chave Pix longa demais.")
        elif not f.conta or not (f.banco_codigo or f.ispb):
            erros.append("O favorecido não tem chave Pix nem conta cadastrada.")
        elif f.tipo_conta == "pagamento" and not so_digitos(f.agencia):
            erros.append("Pix para conta de pagamento: o Itaú exige a agência (nota 44). Cadastre a agência ou use a chave Pix.")
        elif f.tipo_conta == "pagamento" and len(so_digitos(f.agencia)) > 5:
            erros.append("Agência da conta de pagamento com mais de 5 números.")
    elif item.forma == "pix_qr":
        try:
            br = pix.ler(item.pix_copia_cola or "")
        except pix.PixInvalido as e:
            return erros + [str(e)]
        alvo = br.url or br.chave or ""
        if not alvo:
            erros.append("QR Code sem endereço nem chave Pix.")
        elif len(alvo) > 77:
            erros.append("O endereço do QR Code é longo demais para o arquivo do Itaú (77 posições).")
    elif item.forma == "boleto":
        cb = so_digitos(item.codigo_barras)
        if len(cb) != 44 or cb.startswith("8"):
            erros.append("Boleto sem código de barras válido.")
        if not item.cedente_doc or not documento_valido(item.cedente_doc):
            erros.append("O Itaú exige o CPF/CNPJ do beneficiário do boleto (senão rejeita com BI).")
    elif item.forma == "concessionaria":
        cb = so_digitos(item.codigo_barras)
        if len(cb) != 44 or not cb.startswith("8"):
            erros.append("Conta/tributo sem código de barras válido.")
    elif item.forma == "tributo":
        t = item.tributo or {}
        receita = so_digitos(t.get("codigo_receita"))
        if not receita:
            erros.append("Tributo sem código da receita.")
        elif len(receita.lstrip("0")) > 4:
            erros.append("No Itaú o código da receita tem 4 números.")
        if t.get("tipo") == "darf":
            if not t.get("periodo_apuracao"):
                erros.append("DARF sem período de apuração.")
            if _principal(item) <= 0:
                erros.append("DARF: multa + juros maiores que o valor a pagar.")
        elif t.get("tipo") == "gps":
            if not t.get("competencia"):
                erros.append("GPS sem competência.")
        else:
            erros.append("Tributo sem tipo (DARF ou GPS).")
    else:
        erros.append("Forma de pagamento não informada.")
    return erros


def _principal(item: ItemPagamento) -> Decimal:
    t = item.tributo or {}
    return item.valor - _dec(t.get("valor_multa")) - _dec(t.get("valor_juros"))


def agencia_conta(f: Favorecido) -> str:
    """Nota 11 — X(20) das posições 024–043."""
    ag, conta = so_digitos(f.agencia), so_digitos(f.conta)
    dv = so_alfanum(f.conta_dv)
    if f.banco_codigo == "341":
        return "0" + ag.zfill(4)[-4:] + " " + "000000" + conta.zfill(6)[-6:] + " " + (dv[:1] or "0")
    if f.tipo_conta == "pagamento":
        return conta.zfill(20)[-20:]
    dv2 = (dv + "  ")[:2] if len(dv) > 1 else " " + (dv or " ")
    return ag.zfill(5)[-5:] + " " + conta.zfill(12)[-12:] + dv2


def linha_arrecadacao(codigo44: str) -> str:
    """Código de barras de 44 → representação numérica de 48 (anexo B)."""
    c = so_digitos(codigo44)
    calc = barcode.mod10 if c[2] in "67" else barcode.mod11_arrecadacao
    return "".join(c[i:i + 11] + str(calc(c[i:i + 11])) for i in range(0, 44, 11))


def _empresa(e: Empresa) -> dict:
    return {"cnpj": so_digitos(e.cnpj), "agencia": e.agencia, "conta": e.conta, "dac": so_digitos(e.conta_dv) or "0",
            "nome_empresa": e.razao_social}


def _detalhes(item: ItemPagamento, empresa: Empresa, forma: str) -> list[tuple]:
    f = item.favorecido or Favorecido(nome=item.cedente_nome or item.descricao or "")
    base = {"seu_numero": item.seu_numero, "data_pagamento": item.data_pagamento}
    doc = so_digitos(f.cpf_cnpj)

    if forma in ("01", "05", "41"):
        so_ispb = forma == "41" and f.ispb and not f.banco_codigo
        a = {**base, "camara": "888" if so_ispb else "000", "banco_favorecido": f.banco_codigo or "000",
             "agencia_conta": agencia_conta(f), "nome_favorecido": f.nome, "ispb": f.ispb if so_ispb else "",
             "valor": item.valor, "documento": doc,
             "finalidade_ted": ("00004" if item.salario else "00005") if forma == "41" else ""}
        b = {"tipo_inscricao": tipo_inscricao(doc), "documento": doc}
        return [(L.SEG_A, a, True), (L.SEG_B, b, False)]

    if forma == "45":
        por_chave = bool(f.pix_chave)
        a = {**base, "camara": "009", "nome_favorecido": f.nome, "valor": item.valor, "documento": doc,
             "tipo_transferencia": "04" if por_chave else
             {"poupanca": "03", "pagamento": "PG"}.get(f.tipo_conta or "", "01")}
        if por_chave:
            a.update(banco_favorecido="000", agencia_conta="")
        else:
            a.update(banco_favorecido=f.banco_codigo or "000", agencia_conta=agencia_conta(f),
                     ispb="" if f.banco_codigo else (f.ispb or ""))
            if f.tipo_conta == "pagamento":     # nota 44 (v086): agência em 225–229
                a["agencia_pagamento"] = so_digitos(f.agencia).zfill(5)[-5:]
        chave = (so_alfanum(f.pix_chave) if f.pix_tipo_chave == "cpf_cnpj" else f.pix_chave) if por_chave else ""
        b = {"tipo_chave": _TIPO_CHAVE.get(f.pix_tipo_chave or "", "") if por_chave else "",
             "tipo_inscricao": tipo_inscricao(doc), "documento": doc, "chave": chave}
        return [(L.SEG_A, a, True), (L.SEG_B_PIX, b, False)]

    if forma == "47":
        br = pix.ler(item.pix_copia_cola or "")
        j = {**base, "codigo_barras": "0", "nome_favorecido": br.nome_recebedor or f.nome,
             "vencimento": item.data_pagamento, "valor_titulo": item.valor, "valor_pagamento": item.valor}
        j52 = {"sacado_doc": so_digitos(empresa.cnpj), "sacado_nome": empresa.razao_social,
               "cedente_tipo": tipo_inscricao(doc), "cedente_doc": doc,
               "cedente_nome": br.nome_recebedor or f.nome, "chave_url": br.url or br.chave, "txid": br.txid or ""}
        return [(L.SEG_J, j, True), (L.SEG_J52_PIX, j52, False)]

    if forma in ("30", "31"):
        cb = barcode.ler(item.codigo_barras or "", item.data_pagamento)
        nominal = cb.valor or item.valor
        dif = item.valor - nominal
        j = {**base, "codigo_barras": cb.codigo, "nome_favorecido": item.cedente_nome or f.nome,
             "vencimento": cb.vencimento or item.vencimento or item.data_pagamento, "valor_titulo": nominal,
             "descontos": -dif if dif < 0 else 0, "acrescimos": dif if dif > 0 else 0, "valor_pagamento": item.valor}
        ced = so_digitos(item.cedente_doc)
        j52 = {"sacado_doc": so_digitos(empresa.cnpj), "sacado_nome": empresa.razao_social,
               "cedente_tipo": tipo_inscricao(ced), "cedente_doc": ced,
               "cedente_nome": item.cedente_nome or f.nome, "sacador_tipo": "0"}
        return [(L.SEG_J, j, True), (L.SEG_J52, j52, False)]

    if forma in _O:
        o = {**base, "codigo_barras": linha_arrecadacao(item.codigo_barras or ""), "nome": f.nome or item.descricao,
             "vencimento": item.vencimento or item.data_pagamento, "valor": item.valor}
        return [(L.SEG_O, o, True)]

    if forma in _N:
        t = item.tributo or {}
        contrib = so_digitos(t.get("contribuinte_doc")) or so_digitos(empresa.cnpj)
        n = {**base, "contribuinte": empresa.razao_social}
        if forma == "17":
            ano, mes = (t.get("competencia") or "0000-00")[:7].split("-")
            outras = _dec(t.get("valor_outras"))
            n.update(codigo_pagamento=so_digitos(t.get("codigo_receita"))[-4:], competencia=f"{mes}{ano}",
                     identificador=contrib, valor_inss=item.valor - outras, valor_outras=outras,
                     valor_arrecadado=item.valor, data_arrecadacao=item.data_pagamento)
            return [(L.SEG_N_GPS, n, True)]
        inscricao = contrib.ljust(14) if len(contrib) == 11 else contrib.zfill(14)
        n.update(codigo_receita=so_digitos(t.get("codigo_receita"))[-4:], tipo_inscricao="1" if len(contrib) == 11 else "2",
                 inscricao=inscricao, periodo_apuracao=t.get("periodo_apuracao"),
                 referencia=t.get("numero_referencia") or "", valor_principal=_principal(item),
                 valor_multa=_dec(t.get("valor_multa")), valor_juros=_dec(t.get("valor_juros")),
                 valor_total=item.valor, vencimento=item.vencimento or item.data_pagamento)
        return [(L.SEG_N_DARF, n, True)]
    raise ValueError(f"forma sem leiaute: {forma}")


def _versao(forma: str) -> str:
    return L.VERSAO_LOTE["A"] if forma in _A else "030"


def gerar(empresa: Empresa, itens: list[ItemPagamento], nsa: int, agora: datetime | None = None) -> ArquivoGerado:
    """Um arquivo. Quem chama separa Pix e demais (`separar`) antes."""
    if len({i.forma in ("pix", "pix_qr") for i in itens}) > 1:
        raise ValueError("Itaú: Pix e demais formas precisam de arquivos separados.")
    if cnpj_alfanumerico(empresa.cnpj):
        raise ValueError("Itaú v086 não aceita CNPJ com letras no cabeçalho.")
    agora = (agora or datetime.now(BRT)).astimezone(BRT)
    emp = _empresa(empresa)
    end = empresa.endereco or {}

    grupos: "OrderedDict[tuple[str, str], list[ItemPagamento]]" = OrderedDict()
    for item in itens:
        grupos.setdefault(classificar(item), []).append(item)

    linhas = [registro(L.HEADER_ARQUIVO, {**emp, "data_geracao": agora.date(), "hora_geracao": agora.strftime("%H%M%S")})]
    lotes: list[LoteGerado] = []
    posicoes: dict[str, tuple[int, int]] = {}
    total = Decimal(0)
    for numero, ((forma, tipo), grupo) in enumerate(sorted(grupos.items()), start=1):
        linhas.append(registro(L.HEADER_LOTE, {
            **emp, "lote": numero, "tipo_pagamento": tipo, "forma_pagamento": forma, "versao_lote": _versao(forma),
            "endereco": end.get("logradouro"), "numero": end.get("numero"), "complemento": end.get("complemento"),
            "cidade": end.get("cidade"), "cep": so_digitos(end.get("cep")), "uf": end.get("uf")}))
        qtd_reg, soma = 0, Decimal(0)
        principal = outras = acrescimos = Decimal(0)
        for seq, item in enumerate(grupo, start=1):
            posicoes[item.ref] = (numero, seq)
            for layout, valores, conta in _detalhes(item, empresa, forma):
                qtd_reg += 1
                if conta:
                    soma += item.valor
                # Nota 9: complementos (B, J-52…) repetem o número do segmento principal.
                linhas.append(registro(layout, {**valores, "lote": numero, "sequencial": seq}))
            if forma in _N:
                t = item.tributo or {}
                if forma == "17":
                    outras += _dec(t.get("valor_outras"))
                    principal += item.valor - _dec(t.get("valor_outras"))
                else:
                    principal += _principal(item)
                    acrescimos += _dec(t.get("valor_multa")) + _dec(t.get("valor_juros"))
        if forma in _N:
            trailer = registro(L.TRAILER_LOTE_N, {"lote": numero, "qtd_registros": qtd_reg + 2, "total_principal": principal,
                                                  "total_outras": outras, "total_acrescimos": acrescimos,
                                                  "total_arrecadado": soma})
        elif forma in _O:
            trailer = registro(L.TRAILER_LOTE_O, {"lote": numero, "qtd_registros": qtd_reg + 2, "soma_valores": soma})
        else:
            trailer = registro(L.TRAILER_LOTE, {"lote": numero, "qtd_registros": qtd_reg + 2, "soma_valores": soma})
        linhas.append(trailer)
        lotes.append(LoteGerado(numero, forma, tipo, len(grupo), soma))
        total += soma
    linhas.append(registro(L.TRAILER_ARQUIVO, {"qtd_lotes": len(lotes), "qtd_registros": len(linhas) + 1}))
    return ArquivoGerado(texto="\r\n".join(linhas) + "\r\n", lotes=lotes, posicoes=posicoes,
                         valor_total=total, qtd_registros=len(linhas))
