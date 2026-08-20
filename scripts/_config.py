"""
MX Seguros — DRE-IA | Configuração compartilhada dos scripts de teste/diagnóstico.

Lê as credenciais do .env (via app.config) — nunca hardcode segredos aqui.
Execute os scripts a partir da raiz do repositório: `python scripts/test_completo.py`.

Variáveis lidas do .env: SUPABASE_URL, SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL.
A URL do backend (pública, não é segredo) pode ser sobrescrita via env BACKEND_URL.
"""
from __future__ import annotations

import os
import sys

# Raiz do repo no path para importar app.config (mesmo padrão dos demais scripts)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import cfg  # noqa: E402

SUPABASE_URL = cfg.supabase_url
ANON_KEY = cfg.supabase_anon_key
SERVICE_KEY = cfg.supabase_service_role_key

# asyncpg.connect() não aceita o sufixo "+asyncpg" usado pelo SQLAlchemy
DB_URL = (cfg.database_url or "").replace("postgresql+asyncpg://", "postgresql://")

# URL pública do backend — configurável por env, com fallback para produção
API = os.environ.get("BACKEND_URL", "https://web-production-606a2.up.railway.app")

_faltando = [
    nome
    for nome, valor in {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": ANON_KEY,
        "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY,
        "DATABASE_URL": DB_URL,
    }.items()
    if not valor
]
if _faltando:
    raise SystemExit(
        "Faltam variáveis no .env: " + ", ".join(_faltando) + "\n"
        "Preencha o .env na raiz (veja .env.example) antes de rodar os scripts."
    )
