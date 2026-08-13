#!/usr/bin/env python3
"""
MX Seguros — DRE-IA | Monitoramento IA — execução diária (GitHub Actions).

Roda as checagens determinísticas do Monitor + o resumo por IA e salva um
snapshot JSON (artifact do workflow) + imprime no log. Ainda SEM canal de push
(WhatsApp/e-mail ficou fora do escopo) — o snapshot é o registro diário.

Executar da raiz do repo:  python scripts/monitor_diario.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import get_supabase_admin  # noqa: E402
from app.services import monitor_service  # noqa: E402


async def main() -> None:
    db = get_supabase_admin()
    # Perfil admin = enxerga todos os apontamentos (visão global do tenant)
    user = SimpleNamespace(role="admin", user_id=None, tenant_id=None)

    dados = await monitor_service.gerar_insights(user, db)
    print(f"[monitor] {dados['total']} insight(s): {dados['resumo']}")
    for i in dados["insights"]:
        print(f"  [{i['severidade']}] {i['titulo']} — {i['detalhe']}")

    # Resumo por IA (best effort — não falha o job se a IA estiver indisponível)
    try:
        r = monitor_service.gerar_resumo_ia(dados)
        if r.get("resumo"):
            print("\n[resumo IA]\n" + r["resumo"])
            dados["resumo_ia"] = r["resumo"]
    except Exception as e:  # noqa: BLE001
        print(f"[monitor] resumo IA indisponível: {e}")

    os.makedirs("monitor_out", exist_ok=True)
    fname = f"monitor_out/insights_{datetime.now(timezone.utc):%Y%m%d}.json"
    with open(fname, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    print(f"\n[monitor] snapshot salvo em {fname}")


if __name__ == "__main__":
    asyncio.run(main())
