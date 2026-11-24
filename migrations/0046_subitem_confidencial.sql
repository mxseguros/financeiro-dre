-- 0046 — Subitem confidencial: salários sem nome para quem não é Admin (24/11/2026)
--
-- Despesas de subitem marcado como confidencial (folha de pagamento) aparecem
-- para Gestor, Contador e Comercial numa linha só, "Total Salários
-- Funcionários", por mês e situação. O detalhe (nome e valor de cada
-- funcionário) só o Admin vê. A DRE não muda: já mostra a folha somada.
--
-- O mascaramento é feito na API (app/services/confidencial.py). A RLS de
-- despesas NÃO foi alterada de propósito: as funções da DRE são SECURITY
-- INVOKER e a Visão Geral consulta com o token do usuário — esconder as linhas
-- na RLS tiraria os salários dos totais do Gestor.
--
-- O código tolera a coluna ausente (nada fica confidencial até rodar).

ALTER TABLE subitens_lancamento
  ADD COLUMN IF NOT EXISTS confidencial BOOLEAN NOT NULL DEFAULT false;

-- Folha de salários já nasce confidencial; os demais subitens de pessoal
-- (13º, férias, rescisões, FGTS…) o Admin marca em Configurações.
UPDATE subitens_lancamento
   SET confidencial = true
 WHERE natureza = 'despesa'
   AND lower(nome) LIKE 'folha - sal%';
