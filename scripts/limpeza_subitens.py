"""
MX Seguros — DRE-IA | Limpeza única de dados (item 9 do relatório 06/07/2026).

1. Deduplica subitens de lançamento com o mesmo nome (case/espaço-insensível):
   mantém o mais antigo, reaponta despesas/receitas do duplicado e o exclui.
2. Preenche tenant_id (mx-seguros) nos subitens que ficaram sem.

Idempotente: rodar de novo não encontra nada para corrigir.
"""
from __future__ import annotations

import os
from collections import defaultdict

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# ── 1) Dedupe por nome normalizado ────────────────────────────
subitens = sb.table("subitens_lancamento").select("id, nome, natureza, criado_em").order("criado_em").execute().data
grupos: dict[tuple, list[dict]] = defaultdict(list)
for s in subitens:
    grupos[(s["natureza"], s["nome"].strip().lower())].append(s)

for (natureza, nome), itens in grupos.items():
    if len(itens) <= 1:
        continue
    canonico, duplicados = itens[0], itens[1:]
    print(f"[dedupe] '{nome}' ({natureza}): mantendo {canonico['id']}, removendo {len(duplicados)} duplicado(s)")
    for dup in duplicados:
        for tabela in ("despesas", "receitas_outras"):
            r = sb.table(tabela).update({"tipo_lancamento_id": canonico["id"]}) \
                  .eq("tipo_lancamento_id", dup["id"]).execute()
            if r.data:
                print(f"  {tabela}: {len(r.data)} lançamento(s) reapontado(s) de {dup['id']}")
        sb.table("subitens_lancamento").delete().eq("id", dup["id"]).execute()
        print(f"  subitem {dup['id']} excluído")

# ── 2) tenant_id nulos ────────────────────────────────────────
tenant = sb.table("tenants").select("id").eq("slug", "mx-seguros").single().execute().data
r = sb.table("subitens_lancamento").update({"tenant_id": tenant["id"]}).is_("tenant_id", "null").execute()
print(f"[tenant] {len(r.data or [])} subitem(ns) receberam tenant_id mx-seguros")

print("Limpeza concluída.")
