# Ambiente de Staging — guia de configuração

## Por que

Hoje o desenvolvimento local e a produção compartilham o **mesmo** projeto Supabase
(`jrqmntvmtukmhlmnukgn`). Todo teste local mexe em dados reais, e migrations
precisam ser aplicadas em produção antes de qualquer teste ponta a ponta — foi o
que aconteceu na entrega de 06-07/07/2026, quando a produção ficou temporariamente
quebrada entre a migration e o deploy do backend.

Um projeto de staging elimina essa classe de risco: migrations e features são
validadas numa cópia antes de tocar a produção.

## Passo a passo (~30 min, uma vez)

1. **Criar o projeto Supabase de staging** (plano Free basta):
   https://supabase.com/dashboard → New project → nome sugerido `mx-dre-staging`.

2. **Aplicar o schema**: no SQL Editor do projeto novo, rodar as migrations em
   ordem (`migrations/0001_init.sql` até a mais recente). Alternativa rápida:
   `python executar_migrations.py` com o `.env` apontando para o staging.

3. **Popular com dados de exemplo**: rodar `scripts/backup_diagnostico.py` contra
   a produção e importar os JSONs no staging (ou cadastrar meia dúzia de
   lançamentos manualmente — o suficiente para testar).

4. **Criar `.env.staging`** na raiz (copie do `.env` e troque):
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` → do projeto staging
   - `DATABASE_URL` → connection string do staging
   E em `frontend/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   apontando para o staging quando for testar.

5. **Fluxo de trabalho** a partir daí:
   - Desenvolver e testar localmente **contra o staging**.
   - Aplicar migrations primeiro no staging, validar, depois em produção
     (imediatamente antes do deploy do backend — ver nota da migration 0026).
   - `.env` de produção fica reservado para operações deliberadas
     (backup, migrations de release).

## Custos

Plano Free do Supabase: 2 projetos gratuitos por organização — o staging cabe
no limite atual sem custo.
