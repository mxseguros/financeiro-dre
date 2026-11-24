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

-- Subitens de pessoal cujas despesas levam o nome do funcionário na descrição
-- (conferido nos dados em 24/11/2026; decisão do Gabriel). 13º e Prêmios ainda
-- não têm lançamento, mas são pagamento por pessoa. Ficam de fora os que não
-- identificam ninguém: Guia GPS - Pró-Labore ("INSS"), Seguro de Vida
-- (coletivo), Encargos Sociais, EPI. O Admin ajusta em Configurações.
UPDATE subitens_lancamento
   SET confidencial = true
 WHERE natureza = 'despesa'
   AND (
     lower(btrim(nome)) LIKE 'folha - sal%'
     OR lower(btrim(nome)) IN (
       'folha - adicionais', 'folha - prêmios', 'férias', '13º salário',
       'pró-labore', 'rescisões contratuais', 'guia fgts',
       'plano de saúde', 'vale alimentação'
     )
   );
