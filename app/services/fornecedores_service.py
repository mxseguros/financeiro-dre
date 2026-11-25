"""
MX Seguros — DRE-IA | Favorecidos de pagamento (migration 0050, 25/11/2026).

Fornecedor = quem recebe o pagamento por CNAB. O funcionário vira favorecido
por uma linha com `funcionario_id` (dados bancários num lugar só, com uma regra
só de máscara).

Dados bancários e chave Pix são sensíveis: nas listagens saem mascarados; o
dado completo só para quem gera remessa (pagamentos.remessa) ou é Admin.
Nunca vão para log nem para a auditoria (só id e nome).
"""
from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.cnab.normalize import so_alfanum, so_digitos
from app.cnab.validators import chave_pix_valida, documento_valido, normalizar_chave_pix, tipo_documento
from app.models.pagamentos import FavorecidoFuncionarioPayload, FornecedorPayload
from app.permissions import permissao_pagamentos

_COLS = ("id, nome, tipo_pessoa, cpf_cnpj, banco_codigo, ispb, agencia, agencia_dv, conta, conta_dv, "
         "tipo_conta, pix_tipo_chave, pix_chave, forma_pagamento_padrao, funcionario_id, ativo")
_SENSIVEIS = ("cpf_cnpj", "ispb", "agencia", "agencia_dv", "conta", "conta_dv", "pix_chave")


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _sem_tabela(e: Exception) -> bool:
    s = str(e).lower()
    return "fornecedores" in s and ("does not exist" in s or "schema cache" in s or "42p01" in s)


def _indisponivel(e: Exception) -> HTTPException:
    return _erro(503, "Pagamentos ainda não habilitados: rode a migration 0050.")


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def _q(usuario: UsuarioAtual, q):
    return q.eq("tenant_id", _tenant(usuario)) if _tenant(usuario) else q


def pode_ver_completo(usuario: UsuarioAtual) -> bool:
    return permissao_pagamentos(usuario.role, usuario.permissions, "remessa")


def exigir(usuario: UsuarioAtual, acao: str) -> None:
    if not permissao_pagamentos(usuario.role, usuario.permissions, acao):
        raise _erro(403, "Sem permissão para Pagamentos.")


# ── Máscaras ──────────────────────────────────────────────────
def mascarar_conta(r: dict) -> str | None:
    if not r.get("conta"):
        return None
    conta = str(r["conta"])
    fim = conta[-2:] + (f"-{r['conta_dv']}" if r.get("conta_dv") else "")
    tipo = {"poupanca": "PP", "pagamento": "CP"}.get(r.get("tipo_conta") or "", "CC")
    return f"{r.get('banco_codigo') or '---'} · Ag {r.get('agencia') or '—'} · {tipo} ****{fim}"


def mascarar_chave(tipo: str | None, chave: str | None) -> str | None:
    if not chave:
        return None
    if tipo == "email" and "@" in chave:
        nome, dom = chave.split("@", 1)
        return f"{nome[:2]}***@{dom}"
    if tipo == "telefone":
        return f"{chave[:5]} ****-{chave[-4:]}"
    if tipo == "cpf_cnpj":
        return mascarar_documento(chave)
    return f"{chave[:4]}…{chave[-4:]}"


def mascarar_documento(doc: str | None) -> str | None:
    d = so_alfanum(doc)
    if not d:
        return None
    if len(d) == 11:
        return f"***.{d[3:6]}.{d[6:9]}-**"
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.***/****-{d[12:]}"
    return "****"


def _saida(r: dict, completo: bool) -> dict:
    out = {k: r.get(k) for k in _COLS.split(", ")}
    out["conta_mascarada"] = mascarar_conta(r)
    out["pix_mascarada"] = mascarar_chave(r.get("pix_tipo_chave"), r.get("pix_chave"))
    out["documento_mascarado"] = mascarar_documento(r.get("cpf_cnpj"))
    out["tem_conta"] = bool(r.get("conta"))
    out["tem_pix"] = bool(r.get("pix_chave"))
    if not completo:
        for k in _SENSIVEIS:
            out[k] = None
    return out


# ── Normalização e validação ──────────────────────────────────
def _dados(p: FornecedorPayload | FavorecidoFuncionarioPayload, doc: str | None) -> dict:
    dados: dict = {}
    doc = so_alfanum(doc) or None
    if doc:
        if not documento_valido(doc):
            raise _erro(422, "CPF/CNPJ inválido.")
    dados["cpf_cnpj"] = doc

    banco = so_digitos(p.banco_codigo) or None
    if banco and len(banco) > 3:
        raise _erro(422, "Código do banco tem 3 números (ex.: 341, 033, 260).")
    dados["banco_codigo"] = banco.zfill(3) if banco else None
    ispb = so_digitos(p.ispb) or None
    if ispb and len(ispb) != 8:
        raise _erro(422, "ISPB tem 8 números.")
    dados["ispb"] = ispb
    agencia, conta = so_digitos(p.agencia) or None, so_alfanum(p.conta) or None
    if agencia and len(agencia) > 5:
        raise _erro(422, "Agência tem até 5 números.")
    if conta:
        conta = "".join(c if c.isdigit() else "0" for c in conta)   # letra vira 0 (nota G003)
        if len(conta) > 12:
            raise _erro(422, "Conta tem até 12 números (sem o dígito).")
    dados.update(agencia=agencia, conta=conta,
                 agencia_dv=(so_alfanum(p.agencia_dv)[:1] or None),
                 conta_dv=(so_alfanum(p.conta_dv)[:1] or None),
                 tipo_conta=p.tipo_conta if conta else None)
    if conta and not (dados["banco_codigo"] or ispb) :
        raise _erro(422, "Informe o banco da conta.")
    if conta and not agencia and p.tipo_conta != "pagamento":
        raise _erro(422, "Informe a agência.")

    if p.pix_tipo_chave or p.pix_chave:
        if not (p.pix_tipo_chave and p.pix_chave):
            raise _erro(422, "Informe o tipo e a chave Pix.")
        if not chave_pix_valida(p.pix_tipo_chave, p.pix_chave):
            raise _erro(422, "Chave Pix inválida para o tipo escolhido.")
        dados["pix_tipo_chave"] = p.pix_tipo_chave
        dados["pix_chave"] = normalizar_chave_pix(p.pix_tipo_chave, p.pix_chave)
    else:
        dados["pix_tipo_chave"] = dados["pix_chave"] = None

    forma = p.forma_pagamento_padrao
    if forma == "pix" and not dados["pix_chave"] and not conta:
        raise _erro(422, "Para pagar por Pix, informe a chave Pix ou a conta.")
    if forma in ("ted", "credito_conta") and not conta:
        raise _erro(422, "Para TED ou crédito em conta, informe a conta.")
    if forma in ("ted", "pix") and not doc:
        raise _erro(422, "Para Pix e TED o banco exige o CPF/CNPJ do favorecido.")
    dados["forma_pagamento_padrao"] = forma
    return dados


# ── CRUD ──────────────────────────────────────────────────────
def listar(usuario: UsuarioAtual, db: Client, incluir_inativos: bool = False,
           incluir_funcionarios: bool = True) -> list[dict]:
    try:
        q = _q(usuario, db.table("fornecedores").select(_COLS))
        if not incluir_inativos:
            q = q.eq("ativo", True)
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return []
        raise
    if not incluir_funcionarios:
        linhas = [r for r in linhas if not r.get("funcionario_id")]
    completo = pode_ver_completo(usuario)
    linhas.sort(key=lambda r: (not r.get("ativo", True), (r.get("nome") or "").lower()))
    return [_saida(r, completo) for r in linhas]


def _ler(fornecedor_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    try:
        linhas = _q(usuario, db.table("fornecedores").select(_COLS + ", tenant_id")
                    .eq("id", str(fornecedor_id))).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel(e) from e
        raise
    if not linhas:
        raise _erro(404, "Favorecido não encontrado.")
    return linhas[0]


def obter(fornecedor_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    return _saida(_ler(fornecedor_id, usuario, db), pode_ver_completo(usuario))


def _duplicado(usuario: UsuarioAtual, db: Client, doc: str | None, ignorar: str | None = None) -> None:
    if not doc:
        return
    linhas = _q(usuario, db.table("fornecedores").select("id, nome, cpf_cnpj")
                .eq("cpf_cnpj", doc)).execute().data or []
    outros = [r for r in linhas if str(r["id"]) != str(ignorar or "")]
    if outros:
        raise _erro(409, f"Já existe um favorecido com este CPF/CNPJ: {outros[0]['nome']}.")


def criar(payload: FornecedorPayload, usuario: UsuarioAtual, db: Client) -> dict:
    exigir(usuario, "remessa")
    dados = _dados(payload, payload.cpf_cnpj)
    tipo = tipo_documento(dados["cpf_cnpj"])
    dados.update(nome=" ".join(payload.nome.split()), ativo=payload.ativo,
                 tipo_pessoa="F" if tipo == "cpf" else ("J" if tipo == "cnpj" else payload.tipo_pessoa))
    if _tenant(usuario):
        dados["tenant_id"] = _tenant(usuario)
    try:
        _duplicado(usuario, db, dados["cpf_cnpj"])
        row = db.table("fornecedores").insert(dados).execute().data[0]
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel(e) from e
        raise
    return _saida(row, True)


def atualizar(fornecedor_id: UUID, payload: FornecedorPayload, usuario: UsuarioAtual, db: Client) -> dict:
    exigir(usuario, "remessa")
    atual = _ler(fornecedor_id, usuario, db)
    if atual.get("funcionario_id"):
        raise _erro(409, "Dados de funcionário: edite em Configurações → Funcionários → Contrato.")
    dados = _dados(payload, payload.cpf_cnpj)
    tipo = tipo_documento(dados["cpf_cnpj"])
    dados.update(nome=" ".join(payload.nome.split()), ativo=payload.ativo,
                 tipo_pessoa="F" if tipo == "cpf" else ("J" if tipo == "cnpj" else payload.tipo_pessoa))
    _duplicado(usuario, db, dados["cpf_cnpj"], ignorar=str(fornecedor_id))
    _q(usuario, db.table("fornecedores").update(dados).eq("id", str(fornecedor_id))).execute()
    return obter(fornecedor_id, usuario, db)


def excluir(fornecedor_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    exigir(usuario, "remessa")
    atual = _ler(fornecedor_id, usuario, db)
    if atual.get("funcionario_id"):
        raise _erro(409, "Favorecido de funcionário: remova os dados no contrato do funcionário.")
    usado = db.table("despesas").select("id").eq("fornecedor_id", str(fornecedor_id)).limit(1).execute().data
    if usado:
        raise _erro(409, "Este favorecido tem despesas — desative-o em vez de excluir.")
    _q(usuario, db.table("fornecedores").delete().eq("id", str(fornecedor_id))).execute()


# ── Funcionário como favorecido (Admin, no contrato) ──────────
def do_funcionario(funcionario_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict | None:
    try:
        linhas = _q(usuario, db.table("fornecedores").select(_COLS)
                    .eq("funcionario_id", str(funcionario_id))).execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return None
        raise
    return _saida(linhas[0], True) if linhas else None


def salvar_do_funcionario(funcionario_id: UUID | str, payload: FavorecidoFuncionarioPayload,
                          usuario: UsuarioAtual, db: Client) -> dict | None:
    from app.services import funcionarios_service
    func = funcionarios_service.obter(funcionario_id, usuario, db)
    vazio = not any([payload.cpf, payload.conta, payload.pix_chave])
    existente = do_funcionario(funcionario_id, usuario, db)
    if vazio:
        if existente:
            _q(usuario, db.table("fornecedores").update({"ativo": False})
               .eq("id", existente["id"])).execute()
        return None
    if payload.cpf and tipo_documento(payload.cpf) != "cpf":
        raise _erro(422, "CPF do funcionário inválido.")
    dados = _dados(payload, payload.cpf)
    dados.update(nome=func["nome"], tipo_pessoa="F", ativo=True, funcionario_id=str(funcionario_id))
    if _tenant(usuario):
        dados["tenant_id"] = _tenant(usuario)
    try:
        if existente:
            _q(usuario, db.table("fornecedores").update(dados).eq("id", existente["id"])).execute()
        else:
            db.table("fornecedores").insert(dados).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel(e) from e
        raise
    return do_funcionario(funcionario_id, usuario, db)
