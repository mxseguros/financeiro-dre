"""
MX Seguros — DRE-IA | Anexos de lançamentos (Nota Fiscal, Boleto, comprovante).

O arquivo vai direto do navegador para o bucket privado "anexos" do Supabase,
por uma URL de upload assinada gerada aqui depois de conferir o acesso ao
lançamento: assim ele não passa pela função da Vercel (limite de 4,5 MB no
corpo). Leitura também por URL assinada de curta duração.

Tudo roda com a service_role (a tabela `anexos` não tem policy para o
navegador), então a regra de acesso é este módulo:
  * Admin, Gestor e super_admin: qualquer lançamento do tenant;
  * os demais: só os lançamentos que criaram.
Excluir anexo: Admin/Gestor qualquer um; os demais, só os que enviaram.
"""
from __future__ import annotations

import re
import unicodedata
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from supabase import Client

from app.auth import UsuarioAtual
from app.logging_config import get_logger

logger = get_logger(__name__)

BUCKET = "anexos"
TAMANHO_MAX = 10 * 1024 * 1024
MIMES = {
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
}
TIPOS_DOCUMENTO = ("nota_fiscal", "boleto", "comprovante", "outro")
ENTIDADES = {"despesa": "despesas", "receita": "receitas_outras", "ordem_compra": "ordens_compra"}
_VE_TUDO = ("admin", "gestor", "super_admin")
_COLS = "id, entidade, entidade_id, tipo_documento, nome_arquivo, mime, tamanho, criado_por, criado_em"


def _erro(codigo: int, msg: str) -> HTTPException:
    return HTTPException(status_code=codigo, detail=msg)


def _sem_tabela(e: Exception) -> bool:
    msg = str(e).lower()
    return "anexos" in msg and ("does not exist" in msg or "not find" in msg or "42p01" in msg or "pgrst205" in msg)


def _indisponivel() -> HTTPException:
    return _erro(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "Anexos ainda não habilitados no banco (migration 0045). Avise o administrador.",
    )


def nome_seguro(nome: str) -> str:
    base = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "arquivo"
    return base[-80:]


def _tenant(usuario: UsuarioAtual) -> str | None:
    return getattr(usuario, "tenant_id", None)


def ve_tudo(usuario: UsuarioAtual) -> bool:
    return usuario.role in _VE_TUDO


def carregar_entidade(entidade: str, entidade_id: UUID | str, usuario: UsuarioAtual, db: Client) -> dict:
    """O lançamento, se o usuário pode vê-lo; senão 404 (não revela que existe)."""
    tabela = ENTIDADES.get(entidade)
    if not tabela:
        raise _erro(422, "Tipo de lançamento inválido.")
    q = db.table(tabela).select("*").eq("id", str(entidade_id))
    if _tenant(usuario):
        q = q.eq("tenant_id", _tenant(usuario))
    linhas = q.execute().data or []
    row = linhas[0] if linhas else None
    nao_achou = _erro(status.HTTP_404_NOT_FOUND, "Lançamento não encontrado.")
    if not row or row.get("status") == "excluida":
        raise nao_achou
    if not ve_tudo(usuario) and str(row.get("criado_por")) != str(usuario.user_id):
        raise nao_achou
    # Salário confidencial (0046): anexo (holerite, guia) só para o Admin.
    from app.services.confidencial import garantir_detalhe
    garantir_detalhe(entidade, row, usuario, db)
    return row


def _carregar_anexo(anexo_id: UUID, usuario: UsuarioAtual, db: Client) -> dict:
    try:
        q = db.table("anexos").select(_COLS + ", path, tenant_id").eq("id", str(anexo_id))
        if _tenant(usuario):
            q = q.eq("tenant_id", _tenant(usuario))
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    if not linhas:
        raise _erro(status.HTTP_404_NOT_FOUND, "Anexo não encontrado.")
    anexo = linhas[0]
    carregar_entidade(anexo["entidade"], anexo["entidade_id"], usuario, db)
    return anexo


def _validar_arquivo(nome: str, mime: str | None, tamanho: int | None) -> None:
    if mime not in MIMES:
        raise _erro(422, "Envie PDF ou imagem (JPG, PNG, WEBP, HEIC).")
    if not tamanho or tamanho <= 0:
        raise _erro(422, f'O arquivo "{nome}" está vazio.')
    if tamanho > TAMANHO_MAX:
        raise _erro(422, f'"{nome}" passa de 10 MB.')


def _prefixo(usuario: UsuarioAtual, entidade: str, entidade_id: UUID | str) -> str:
    return f"{_tenant(usuario) or 'sem_tenant'}/{entidade}/{entidade_id}/"


def gerar_upload(
    entidade: str, entidade_id: UUID, nome_arquivo: str, mime: str | None, tamanho: int | None,
    usuario: UsuarioAtual, db: Client,
) -> dict:
    carregar_entidade(entidade, entidade_id, usuario, db)
    _validar_arquivo(nome_arquivo, mime, tamanho)
    try:  # sem a tabela não adianta subir o arquivo
        db.table("anexos").select("id").limit(1).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    path = _prefixo(usuario, entidade, entidade_id) + f"{uuid4().hex[:12]}-{nome_seguro(nome_arquivo)}"
    assinado = db.storage.from_(BUCKET).create_signed_upload_url(path)
    return {"bucket": BUCKET, "path": path, "token": assinado["token"], "signed_url": assinado["signed_url"]}


def registrar(
    entidade: str, entidade_id: UUID, path: str, nome_arquivo: str, mime: str | None,
    tamanho: int | None, tipo_documento: str, usuario: UsuarioAtual, db: Client,
) -> dict:
    carregar_entidade(entidade, entidade_id, usuario, db)
    _validar_arquivo(nome_arquivo, mime, tamanho)
    # O caminho veio do próprio gerar_upload: impede registrar arquivo de outro lançamento/tenant.
    if not path.startswith(_prefixo(usuario, entidade, entidade_id)) or ".." in path:
        raise _erro(422, "Caminho de anexo inválido.")
    if tipo_documento not in TIPOS_DOCUMENTO:
        tipo_documento = "outro"
    dados = {
        "entidade": entidade, "entidade_id": str(entidade_id), "tipo_documento": tipo_documento,
        "path": path, "nome_arquivo": nome_arquivo[:200], "mime": mime, "tamanho": tamanho,
        "criado_por": usuario.user_id, "tenant_id": _tenant(usuario),
    }
    try:
        resp = db.table("anexos").insert(dados).execute()
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            raise _indisponivel() from e
        raise
    row = resp.data[0]
    return {k: row.get(k) for k in _COLS.split(", ")}


def listar(entidade: str, entidade_id: UUID, usuario: UsuarioAtual, db: Client) -> list[dict]:
    carregar_entidade(entidade, entidade_id, usuario, db)
    try:
        q = (db.table("anexos").select(_COLS).eq("entidade", entidade)
             .eq("entidade_id", str(entidade_id)).order("criado_em"))
        if _tenant(usuario):
            q = q.eq("tenant_id", _tenant(usuario))
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return []
        raise
    # Só os campos públicos: o path do Storage não sai daqui.
    return [{k: r.get(k) for k in _COLS.split(", ")} for r in linhas]


def contagem(entidade: str, ids: list[str], usuario: UsuarioAtual, db: Client) -> dict[str, int]:
    """Quantos anexos cada lançamento tem — para o clipe nas listas. Só conta;
    abrir continua exigindo o acesso ao lançamento."""
    if entidade not in ENTIDADES or not ids:
        return {}
    contas: dict[str, int] = {}
    try:
        for i in range(0, len(ids), 200):
            q = db.table("anexos").select("entidade_id").eq("entidade", entidade).in_("entidade_id", ids[i:i + 200])
            if _tenant(usuario):
                q = q.eq("tenant_id", _tenant(usuario))
            for r in q.execute().data or []:
                contas[r["entidade_id"]] = contas.get(r["entidade_id"], 0) + 1
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return {}
        raise
    return contas


def url_download(anexo_id: UUID, usuario: UsuarioAtual, db: Client) -> str:
    anexo = _carregar_anexo(anexo_id, usuario, db)
    return db.storage.from_(BUCKET).create_signed_url(anexo["path"], 300)["signedURL"]


def excluir(anexo_id: UUID, usuario: UsuarioAtual, db: Client) -> None:
    anexo = _carregar_anexo(anexo_id, usuario, db)
    if not ve_tudo(usuario) and str(anexo.get("criado_por")) != str(usuario.user_id):
        raise _erro(status.HTTP_403_FORBIDDEN, "Você só pode excluir anexos que você enviou.")
    db.table("anexos").delete().eq("id", str(anexo_id)).execute()
    # Só remove o arquivo se nenhum outro registro aponta para ele (OC aprovada
    # copia o anexo para a despesa gerada, com o mesmo path).
    resto = db.table("anexos").select("id").eq("path", anexo["path"]).limit(1).execute().data
    if not resto:
        try:
            db.storage.from_(BUCKET).remove([anexo["path"]])
        except Exception as e:  # noqa: BLE001 — registro já saiu; arquivo órfão não quebra nada
            logger.warning("anexo_remover_arquivo_falhou", path=anexo["path"], erro=str(e))


def copiar(origem: str, origem_id: str, destino: str, destino_id: str, tenant_id: str | None, db: Client) -> int:
    """Duplica os registros de anexo (mesmo arquivo) — OC aprovada → despesa."""
    try:
        q = db.table("anexos").select("*").eq("entidade", origem).eq("entidade_id", origem_id)
        if tenant_id:
            q = q.eq("tenant_id", tenant_id)
        linhas = q.execute().data or []
    except Exception as e:  # noqa: BLE001
        if _sem_tabela(e):
            return 0
        raise
    novos = [
        {k: v for k, v in r.items() if k not in ("id", "criado_em")} | {"entidade": destino, "entidade_id": destino_id}
        for r in linhas
    ]
    if novos:
        db.table("anexos").insert(novos).execute()
    return len(novos)
