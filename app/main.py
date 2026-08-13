"""
MX Seguros — DRE-IA | Ponto de entrada do backend FastAPI.

Rodar localmente:
    uvicorn app.main:app --reload --port 8000

Swagger UI: http://localhost:8000/docs
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import cfg
from app.database import close_asyncpg_pool, init_asyncpg_pool
from app.logging_config import get_logger, setup_logging
from app.middleware.rate_limit import limiter
from app.middleware.tenant import TenantMiddleware
from app.routers import chat, comissoes, configuracoes, dashboard, dre, estornos, exports, fechamentos, health as health_router, importacao, lancamentos, metas, monitor, ordens_compra, platform, repasses, usuarios

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_asyncpg_pool()
    yield
    await close_asyncpg_pool()


app = FastAPI(
    lifespan=lifespan,
    title="MX Seguros — DRE-IA API",
    description=(
        "Backend do sistema de DRE com IA para a MX Seguros. "
        "Todos os endpoints exigem JWT do Supabase Auth no header Authorization."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── RATE LIMITING ─────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── ERROS NÃO TRATADOS (registrado ANTES do CORS de propósito) ─
# add_middleware empilha por fora: registrar este middleware antes do
# CORSMiddleware faz ele rodar POR DENTRO do CORS. Assim a exceção vira
# JSON 500 aqui e a resposta ainda atravessa o CORS ganhando os headers
# Access-Control-*. Sem isso, o erro sobe até o ServerErrorMiddleware
# (fora do CORS), a resposta chega sem headers CORS e o navegador exibe
# "Failed to fetch"/"Não foi possível conectar" em vez do erro real.
@app.middleware("http")
async def erros_com_cors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001 — catch-all intencional
        logger.error(
            "erro_nao_tratado",
            path=request.url.path,
            method=request.method,
            exc=str(exc),
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Erro interno do servidor. Tente novamente em instantes.",
                "detalhe": None if cfg.is_production else str(exc),
            },
        )

# ── CORS ──────────────────────────────────────────────────────
_frontend_urls_dev = ["http://localhost:3000", "http://localhost:3001"]
_frontend_url_prod = os.getenv("FRONTEND_URL", "https://app.mxseguros.com.br")

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        _frontend_urls_dev + [_frontend_url_prod]
        if not cfg.is_production
        else [_frontend_url_prod] + _frontend_urls_dev
    ),
    # Libera também os deploys do projeto na Vercel (produção e previews *.vercel.app),
    # evitando "Failed to fetch" quando o app é acessado por um domínio diferente
    # de FRONTEND_URL. Combina com allow_origins acima.
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── TENANT MIDDLEWARE ─────────────────────────────────────────
app.add_middleware(TenantMiddleware)

# ── SECURITY HEADERS ──────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    if cfg.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# ── ROUTERS ───────────────────────────────────────────────────

app.include_router(health_router.router)
app.include_router(platform.router)
app.include_router(dashboard.router)
app.include_router(chat.router)
app.include_router(dre.router)
app.include_router(exports.router)
app.include_router(comissoes.router)
app.include_router(estornos.router)
app.include_router(metas.router)
app.include_router(repasses.router)
app.include_router(lancamentos.router)
app.include_router(monitor.router)
app.include_router(ordens_compra.router)
app.include_router(fechamentos.router)
app.include_router(importacao.router)
app.include_router(configuracoes.router)
app.include_router(usuarios.router)



# ── HANDLER GLOBAL DE ERROS ───────────────────────────────────

@app.exception_handler(Exception)
async def handler_global(request: Request, exc: Exception):
    logger.error(
        "erro_nao_tratado",
        path=request.url.path,
        method=request.method,
        exc=str(exc),
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={"erro": "Erro interno do servidor", "detalhe": str(exc) if not cfg.is_production else None},
    )
