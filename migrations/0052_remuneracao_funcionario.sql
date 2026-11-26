-- 0052 — Remove a Folha de pagamento (cálculo CLT da 0049) e deixa no
-- funcionário só os valores de remuneração/benefícios + os dados de pagamento.
--
-- Pedido de 26/11/2026: sai a Folha inteira (tabelas de INSS/IRRF, rubricas,
-- contrato, cálculo). Cada funcionário passa a ter os valores (R$):
--   salario, decimo_terceiro, terco_ferias, abono_ferias, fgts,
--   vale_refeicao, odonto, plano_saude, seguro_vida, rescisao
-- guardados em funcionarios_contrato.valores (JSONB). Continua só Admin
-- (RLS sem policies; acesso só pela API).
-- Em produção a tabela funcionarios_contrato estava vazia (0 linhas) em 26/11.

ALTER TABLE funcionarios_contrato
  ADD COLUMN IF NOT EXISTS valores JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE funcionarios_contrato
  DROP COLUMN IF EXISTS tipo_contrato,
  DROP COLUMN IF EXISTS cargo,
  DROP COLUMN IF EXISTS data_admissao,
  DROP COLUMN IF EXISTS data_desligamento,
  DROP COLUMN IF EXISTS salario_base,
  DROP COLUMN IF EXISTS adicionais,
  DROP COLUMN IF EXISTS dependentes_ir,
  DROP COLUMN IF EXISTS filhos_salario_familia,
  DROP COLUMN IF EXISTS pensao_alimenticia,
  DROP COLUMN IF EXISTS vt_custo_mensal,
  DROP COLUMN IF EXISTS vt_descontar,
  DROP COLUMN IF EXISTS va_valor,
  DROP COLUMN IF EXISTS plano_saude_empresa,
  DROP COLUMN IF EXISTS plano_saude_desconto,
  DROP COLUMN IF EXISTS seguro_vida,
  DROP COLUMN IF EXISTS outros_beneficios,
  DROP COLUMN IF EXISTS sindical;
-- banco_pagamento (texto livre antigo) fica: aparece como "anotação antiga".

-- Tabelas da Folha que deixam de existir (todas vazias em produção, exceto o
-- mapeamento rubrica → subitem, que só servia à Folha).
DROP TABLE IF EXISTS folha_itens;
DROP TABLE IF EXISTS folhas;
DROP TABLE IF EXISTS folha_parametros;
DROP TABLE IF EXISTS folha_rubrica_subitem;

-- Fica como está: subitens "Folha - …"/"Encargos sociais" continuam
-- confidenciais (regra de 24/11, independente da Folha).
