"""
MX Seguros — DRE-IA | Lançamentos por trás de cada valor da Visão Geral.

Ao clicar num número da tela, a modal lista o que o forma. Cada bloco repete
aqui os critérios do cálculo em dashboard_service, e
tests/test_dashboard_detalhe.py confere que a soma da lista é igual ao número.

Mesma visibilidade de Lançamentos: Admin e Gestor veem tudo; Contador só o que
lançou; Comercial só as próprias receitas. Os totais da tela não têm esse
recorte, por isso a resposta avisa com `parcial` quando a lista pode ser menor.
"""
from __future__ import annotations

import asyncio

from datetime import date, timedelta

from fastapi import HTTPException
from supabase import Client

from app.auth import UsuarioAtual
from app.database import executar_sem_bloquear as _exec
from app.services import dashboard_service as ds
from app.services import relatorio_service as rs
from app.services.periodo_base import coluna_data
from app.services.somente_dre import ids_somente_dre

SEM_BANCO = "Sem banco"
_FORA_CARDS_RECEITA = ds._RECEITAS_FORA_CARDS_BANCO

_PRECISA_BANCO = {"saldo_inicial", "box_emprestimo", "box_aplicacao", "box_banco", "resultado", "emprestimos", "aplicacoes"}


def _erro(msg: str) -> HTTPException:
    return HTTPException(status_code=422, detail=msg)


class _Leitor:
    """Consultas de um pedido, sempre em sequência: o client HTTP/2 do
    supabase-py não suporta várias páginas em paralelo."""

    def __init__(self, inicio: date, fim: date, base: str, usuario: UsuarioAtual, db: Client):
        self.inicio, self.fim, self.base, self.usuario, self.db = inicio, fim, base, usuario, db
        self.ler_despesas = rs.pode_ler_despesas(usuario)
        self._bancos: dict[str, str] | None = None

    def _consulta(self, tabela: str):
        # banco_id: os blocos filtram por banco; o relatório só precisa do nome.
        q = self.db.table(tabela).select(f"{rs._COLUNAS[tabela]}, banco_id")
        return q if rs._ve_tudo(self.usuario) else q.eq("criado_por", self.usuario.user_id)

    def _no_intervalo(self, tabela: str, de: date, ate: date):
        col = coluna_data(tabela, self.base)
        return self._consulta(tabela).gte(col, de.isoformat()).lte(col, ate.isoformat())

    async def bancos(self) -> dict[str, str]:
        if self._bancos is None:
            resp = await _exec(self.db.table("bancos").select("id, nome").eq("ativo", True))
            self._bancos = {b["id"]: b["nome"].strip() for b in (resp.data or [])}
        return self._bancos

    async def _do_banco(self, linhas: list[dict], banco: str | None) -> list[dict]:
        """Por nome, como nos cards: banco inativo ou vazio cai em "Sem banco"."""
        if banco is None:
            return linhas
        bancos = await self.bancos()
        return [r for r in linhas if bancos.get(r.get("banco_id"), SEM_BANCO) == banco]

    async def classificacao(self, codigo: str) -> tuple[list[dict], list[dict]]:
        if not self.ler_despesas:
            return [], []
        linhas = await ds._todas(
            self._no_intervalo("despesas", self.inicio, self.fim).not_.in_("status", ds._FORA).order("id"))
        if codigo == "nao_classificada":
            return [r for r in linhas if not r.get("custo_tipo")], []
        return [r for r in linhas if r.get("custo_tipo") == codigo], []

    async def quadro(
        self, alvos: set[str], de: date, ate: date, banco: str | None, lado: str | None = None, subitem: str | None = None,
    ) -> tuple[list[dict], list[dict]]:
        """Categoria Empréstimo ou Aplicações, só com data de pagamento/recebimento."""
        cat_ids, subs = await ds._subitens_das_categorias(self.db, alvos)

        async def ler(natureza: str, tabela: str, col_liquidacao: str) -> list[dict]:
            nomes = {s["id"]: s["nome"].strip() for s in subs if cat_ids.get(s["categoria_id"]) == natureza}
            if subitem is not None:
                nomes = {i: n for i, n in nomes.items() if n == subitem}
            if not nomes:
                return []
            linhas = await ds._todas(
                self._no_intervalo(tabela, de, ate).in_("tipo_lancamento_id", list(nomes))
                .not_.is_(col_liquidacao, "null").not_.in_("status", ds._FORA).order("id"))
            return await self._do_banco(linhas, banco)

        despesas = await ler("despesa", "despesas", "paga_em") if self.ler_despesas and lado != "receitas" else []
        receitas = await ler("receita", "receitas_outras", "recebido_em") if lado != "despesas" else []
        return despesas, receitas

    async def movimento(
        self, banco: str | None, de: date, ate: date, lado: str | None = None,
    ) -> tuple[list[dict], list[dict]]:
        """Critérios do card Por Banco. Sem `banco`: todos os ativos (card Total)."""
        if de > ate:
            return [], []
        ativos = await self.bancos()
        so_dre = await ids_somente_dre(self.db)
        vendas = await ds._ids_subitens_receita_vendas(self.db)
        despesas: list[dict] = []
        receitas: list[dict] = []
        if self.ler_despesas and lado != "receitas":
            despesas = await ds._todas(
                self._no_intervalo("despesas", de, ate).not_.is_("banco_id", "null").not_.is_("paga_em", "null")
                .not_.in_("status", ds._FORA).in_("custo_tipo", list(ds._CLASSIF_CARDS_BANCO)).order("id"))
        if lado != "despesas":
            linhas = await ds._todas(
                self._no_intervalo("receitas_outras", de, ate).not_.is_("banco_id", "null").not_.is_("recebido_em", "null")
                .not_.in_("status", ds._FORA).order("id"))
            receitas = [r for r in linhas
                        if r.get("tipo_lancamento_id") in vendas and r.get("tipo_lancamento_id") not in so_dre
                        and r.get("custo_tipo") not in _FORA_CARDS_RECEITA]

        def do_card(linhas: list[dict]) -> list[dict]:
            return [r for r in linhas if r.get("banco_id") in ativos
                    and (banco is None or ativos[r["banco_id"]] == banco)]
        return do_card(despesas), do_card(receitas)

    async def saldo_inicial(self, banco: str) -> tuple[list[dict], list[dict]]:
        """Lançamento de Saldo Inicial, em qualquer data, + movimento do banco
        de INICIO_ACUMULADO até a véspera do período."""
        ids = await ds.ids_subitens_saldo_inicial(self.db)
        iniciais: list[dict] = []
        if ids:
            linhas = await ds._todas(
                self._consulta("receitas_outras").in_("tipo_lancamento_id", ids)
                .not_.in_("status", ds._FORA).order("id"))
            iniciais = await self._do_banco(linhas, banco)
        despesas, receitas = await self.movimento(banco, ds.INICIO_ACUMULADO, self.inicio - timedelta(days=1))
        return despesas, iniciais + receitas

    async def centro(self, nome: str, lado: str | None) -> tuple[list[dict], list[dict]]:
        """Bloco por centro de custo, com os critérios de GET /lancamentos/*, de onde
        vêm os totais da tela: despesa só sai se excluída, e receita não filtra status."""
        resp = await _exec(self.db.table("centros_custo").select("codigo, nome"))
        alvo = nome.strip().lower()
        codigo = next((c["codigo"] for c in (resp.data or [])
                       if c["nome"].strip().lower() == alvo or c["codigo"].strip().lower() == alvo), None)
        if codigo is None:
            raise _erro(f'Centro de custo "{nome}" não está cadastrado.')
        # Grupo traz os subgrupos, como no filtro de GET /lancamentos/* (0044).
        from app.services.financeiro_service import expandir_centro
        codigos = await asyncio.to_thread(expandir_centro, self.db, codigo)
        despesas: list[dict] = []
        receitas: list[dict] = []
        if self.ler_despesas and lado != "receitas":
            despesas = await ds._todas(
                self._no_intervalo("despesas", self.inicio, self.fim).in_("centro_custo", codigos)
                .neq("status", "excluida").order("id"))
        if lado != "despesas":
            so_dre = await ids_somente_dre(self.db)
            linhas = await ds._todas(
                self._no_intervalo("receitas_outras", self.inicio, self.fim).in_("centro_custo", codigos).order("id"))
            receitas = [r for r in linhas if r.get("tipo_lancamento_id") not in so_dre]
        return despesas, receitas


async def _selecionar(
    leitor: _Leitor, bloco: str, banco: str | None, lado: str | None, subitem: str | None,
    classificacao: str | None, centro: str | None,
) -> tuple[list[dict], list[dict]]:
    ini, fim, acu = leitor.inicio, leitor.fim, ds.INICIO_ACUMULADO
    if bloco == "classificacao":
        return await leitor.classificacao(classificacao or "")
    if bloco == "saldo_inicial":
        return await leitor.saldo_inicial(banco or "")
    if bloco == "box_emprestimo":
        return await leitor.quadro(ds.ALVOS_EMPRESTIMOS, acu, fim, banco)
    if bloco == "box_aplicacao":
        return await leitor.quadro(ds.ALVOS_APLICACOES, acu, fim, banco)
    if bloco == "box_banco":
        return await leitor.movimento(banco, ini, fim)
    if bloco == "por_banco":
        return await leitor.movimento(banco, ini, fim, lado)
    if bloco == "emprestimos":
        return await leitor.quadro(ds.ALVOS_EMPRESTIMOS, ini, fim, banco, lado, subitem)
    if bloco == "aplicacoes":
        return await leitor.quadro(ds.ALVOS_APLICACOES, ini, fim, banco, lado, subitem)
    if bloco == "centro":
        return await leitor.centro(centro or "", lado)
    # resultado: as quatro linhas do box, cada uma com os próprios critérios.
    despesas: list[dict] = []
    receitas: list[dict] = []
    for parte in (
        await leitor.saldo_inicial(banco or ""),
        await leitor.quadro(ds.ALVOS_EMPRESTIMOS, acu, fim, banco),
        await leitor.quadro(ds.ALVOS_APLICACOES, acu, fim, banco),
        await leitor.movimento(banco, ini, fim),
    ):
        despesas += parte[0]
        receitas += parte[1]
    return despesas, receitas


async def detalhe(
    bloco: str, inicio: date, fim: date, base: str, usuario: UsuarioAtual, db: Client,
    banco: str | None = None, lado: str | None = None, subitem: str | None = None,
    classificacao: str | None = None, centro: str | None = None,
) -> dict:
    """Lista e valor de um número da tela: só despesas ou só receitas somam o
    próprio lado, como nos cards; os demais são receitas − despesas."""
    if bloco in _PRECISA_BANCO and not banco:
        raise _erro("Informe o banco.")
    if bloco == "classificacao" and not classificacao:
        raise _erro("Informe a classificação.")
    if bloco == "centro" and not centro:
        raise _erro("Informe o centro de custo.")

    leitor = _Leitor(inicio, fim, base, usuario, db)
    despesas, receitas = await _selecionar(leitor, bloco, banco, lado, subitem, classificacao, centro)

    classif = await rs._mapa(db, "classificacoes", "codigo", "nome")
    centros, grupos = await rs.mapas_centro(db)
    usuarios = await rs._mapa(db, "usuarios", "id", "nome")
    so_dre = await ids_somente_dre(db)
    nomes = {"classificacao": classif, "centro": centros, "centro_grupo": grupos, "usuario": usuarios}

    total_d, total_r = ds._soma(despesas), ds._soma(receitas)
    so_despesas = bloco == "classificacao" or lado == "despesas"
    valor = total_d if so_despesas else total_r if lado == "receitas" else total_r - total_d
    itens = rs.linhas_despesas(despesas, nomes, so_dre, usuario, db)
    itens += [rs._linha(r, "Receita", nomes, so_dre) for r in receitas]
    return {"valor": valor, "total": len(itens), "parcial": not rs._ve_tudo(usuario), "itens": itens}
