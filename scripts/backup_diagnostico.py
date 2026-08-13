"""
MX Seguros — DRE-IA | Backup completo + diagnóstico de parcelas incompletas.

Uso:
    python scripts/backup_diagnostico.py            # backup + diagnóstico
    python scripts/backup_diagnostico.py --so-diag  # apenas diagnóstico (só leitura)

Exporta todas as tabelas para backups/backup_YYYYMMDD_HHMMSS/ em JSON
(e CSV para as tabelas financeiras críticas). 100% somente leitura.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TABELAS = [
    "despesas", "receitas_outras", "comissoes", "fechamentos",
    "bancos", "categorias_lancamento", "subitens_lancamento", "centros_custo", "usuarios",
    "estornos", "repasses", "apolices", "equipes", "tenants",
    "chat_conversas", "chat_mensagens", "audit_log",
]
# Tabelas críticas também ganham CSV (fácil de abrir no Excel)
TABELAS_CSV = {"despesas", "receitas_outras", "comissoes", "fechamentos"}

PAGE = 1000


def exportar_tabela(db, tabela: str, destino: Path) -> int:
    """Exporta uma tabela completa (paginada) para JSON. Retorna nº de linhas."""
    linhas: list[dict] = []
    offset = 0
    while True:
        resp = db.table(tabela).select("*").range(offset, offset + PAGE - 1).execute()
        dados = resp.data or []
        linhas.extend(dados)
        if len(dados) < PAGE:
            break
        offset += PAGE

    (destino / f"{tabela}.json").write_text(
        json.dumps(linhas, ensure_ascii=False, indent=1, default=str), encoding="utf-8"
    )
    if tabela in TABELAS_CSV and linhas:
        campos = sorted({k for linha in linhas for k in linha})
        with open(destino / f"{tabela}.csv", "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=campos)
            w.writeheader()
            w.writerows(linhas)
    return len(linhas)


def diagnostico_parcelas(db) -> None:
    """Procura grupos de parcelamento incompletos (bug do loop de criação)."""
    linhas: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("despesas")
            .select("id, descricao, valor, competencia, parcela_atual, parcela_total, "
                    "tipo_lancamento_id, criado_por, criado_em, status, centro_custo")
            .gt("parcela_total", 1)
            .neq("status", "excluida")
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        dados = resp.data or []
        linhas.extend(dados)
        if len(dados) < PAGE:
            break
        offset += PAGE

    # Agrupa por assinatura do parcelamento (mesma descrição/valor/total/criador)
    grupos: dict[tuple, list[dict]] = defaultdict(list)
    for d in linhas:
        chave = (d["descricao"], str(d["valor"]), d["parcela_total"],
                 d.get("tipo_lancamento_id"), d.get("criado_por"))
        grupos[chave].append(d)

    print(f"\n{'='*70}")
    print("DIAGNÓSTICO DE PARCELAS")
    print(f"{'='*70}")
    print(f"Despesas parceladas (parcela_total > 1): {len(linhas)}")
    print(f"Grupos de parcelamento identificados:    {len(grupos)}")

    incompletos = []
    for chave, itens in grupos.items():
        total_esperado = chave[2]
        numeros = sorted(i.get("parcela_atual") or 0 for i in itens)
        if len(itens) != total_esperado or numeros != list(range(1, total_esperado + 1)):
            incompletos.append((chave, itens, numeros))

    if not incompletos:
        print("\n[OK] Nenhum grupo de parcelas incompleto encontrado.")
        print("     O bug do parcelamento NÃO deixou dados inconsistentes.")
        return

    print(f"\n[ATENÇÃO] {len(incompletos)} grupo(s) INCOMPLETO(s):\n")
    for (descricao, valor, total, _tipo, _criador), itens, numeros in incompletos:
        faltando = sorted(set(range(1, total + 1)) - set(numeros))
        print(f"  • '{descricao}' — R$ {valor} — esperado {total} parcelas, "
              f"encontradas {len(itens)} (parcelas {numeros})")
        if faltando:
            print(f"    Faltando: {faltando}")
        for i in sorted(itens, key=lambda x: x.get("parcela_atual") or 0):
            print(f"      {i['parcela_atual']}/{total}  {i['competencia']}  "
                  f"status={i['status']}  id={i['id']}")
        print()


def main() -> None:
    so_diag = "--so-diag" in sys.argv
    db = create_client(SUPABASE_URL, SERVICE_KEY)

    if not so_diag:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        destino = ROOT / "backups" / f"backup_{stamp}"
        destino.mkdir(parents=True, exist_ok=True)

        print(f"{'='*70}")
        print(f"BACKUP → {destino}")
        print(f"{'='*70}")
        total_geral = 0
        for tabela in TABELAS:
            try:
                n = exportar_tabela(db, tabela, destino)
                total_geral += n
                print(f"  {tabela:<20} {n:>6} linhas")
            except Exception as exc:  # tabela pode não existir neste ambiente
                print(f"  {tabela:<20} ERRO: {exc}")
        print(f"  {'TOTAL':<20} {total_geral:>6} linhas")

    diagnostico_parcelas(db)


if __name__ == "__main__":
    main()
