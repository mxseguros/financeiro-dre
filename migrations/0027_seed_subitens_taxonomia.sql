-- ================================================================
-- 0027_seed_subitens_taxonomia.sql
-- Épico 1 (Task 1.2) — Seed da taxonomia de subitens de despesa
-- pedida na spec (67 subitens em 8 categorias), com a classificação
-- fixa/variável inicial sugerida. O usuário poderá ajustar depois em
-- Configurações.
--
-- Idempotente: cada subitem só é inserido se ainda não existir um
-- com o mesmo nome (case-insensitive) na mesma natureza/tenant — os
-- 15 subitens seedados em 0005_financeiro.sql não são duplicados.
-- ================================================================

-- Índice único para permitir dedup seguro aqui e em seeds futuros.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subitens_lancamento_nome
  ON subitens_lancamento (tenant_id, natureza, lower(nome));

DO $$
DECLARE v_tenant_id UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'mx-seguros';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant mx-seguros não encontrado.';
  END IF;

  INSERT INTO subitens_lancamento (nome, natureza, categoria_id, custo_tipo, tenant_id, ativo)
  SELECT t.nome, 'despesa', cl.id, t.custo_tipo, v_tenant_id, true
  FROM (VALUES
    -- Despesas com pessoal
    ('Folha - Salários + Vale Transp. + Sindicato + Guia Gps', 'pessoal', 'fixo'),
    ('Folha - Adicionais',                                      'pessoal', 'variavel'),
    ('Folha - Prêmios',                                         'pessoal', 'variavel'),
    ('Pró-Labore',                                              'pessoal', 'fixo'),
    ('Guia GPS - Pró-Labore',                                   'pessoal', 'fixo'),
    ('Guia FGTS',                                               'pessoal', 'fixo'),
    ('13º Salário',                                             'pessoal', 'fixo'),
    ('Férias',                                                  'pessoal', 'fixo'),
    ('Rescisões Contratuais',                                   'pessoal', 'variavel'),
    ('EPI / Uniformes / Acessórios',                            'pessoal', 'variavel'),
    ('Plano de Saúde',                                          'pessoal', 'fixo'),
    ('Primeiros Socorros',                                      'pessoal', 'variavel'),
    ('Cesta Básica',                                            'pessoal', 'fixo'),
    ('Seguro de Vida',                                          'pessoal', 'fixo'),

    -- Despesa comercial
    ('Viagens, Estadias, Pedágios, Estacionamentos (Comercial)', 'comercial', 'variavel'),
    ('Propaganda e Marketing',                                   'comercial', 'variavel'),
    ('Introdução, despesas com novos clientes',                  'comercial', 'variavel'),
    ('Brindes e Doações',                                        'comercial', 'variavel'),
    ('Custo de Protótipos e Novos Projetos',                     'comercial', 'variavel'),

    -- Despesa administrativa
    ('Água e Esgoto',                                                     'administrativa_operacional', 'fixo'),
    ('Energia Elétrica',                                                  'administrativa_operacional', 'fixo'),
    ('Telefonia (móvel e fixa)',                                          'administrativa_operacional', 'fixo'),
    ('Internet',                                                          'administrativa_operacional', 'fixo'),
    ('Aluguel',                                                           'administrativa_operacional', 'fixo'),
    ('Impostos, Taxas e Contribuições (IPTU, ISS, Alvará, Outros)',       'administrativa_operacional', 'fixo'),
    ('Seguro Predial',                                                    'administrativa_operacional', 'fixo'),
    ('Materiais de Limpeza, Escritório e Higiene',                        'administrativa_operacional', 'variavel'),
    ('Alimentação / Cozinha (Café, Lanche, Almoço)',                      'administrativa_operacional', 'variavel'),
    ('Associações e Entidades de Classe',                                 'administrativa_operacional', 'fixo'),
    ('Despesas c/ Cartórios',                                             'administrativa_operacional', 'variavel'),
    ('Manutenção, Limpeza e Benfeitoria Predial',                         'administrativa_operacional', 'variavel'),
    ('Manutenção e Acessórios de Informática',                            'administrativa_operacional', 'variavel'),
    ('Manutenção de Móveis e Utensílios',                                 'administrativa_operacional', 'variavel'),
    ('Manutenção de Máquinas e Equipamentos',                             'administrativa_operacional', 'variavel'),
    ('Sistemas, Programas e Softwares',                                   'administrativa_operacional', 'fixo'),
    ('Monitoramento e Segurança',                                         'administrativa_operacional', 'fixo'),
    ('Correios',                                                          'administrativa_operacional', 'variavel'),
    ('Locações - Máquinas e Equipamentos Diversos',                       'administrativa_operacional', 'fixo'),
    ('Fretes e Despesas de Transporte - Compras',                         'administrativa_operacional', 'variavel'),
    ('Prejuízo Operacional / Perdas de Produção / Retrabalho',            'administrativa_operacional', 'variavel'),

    -- Despesa com veículos
    ('Manutenção de Veículos / Serviços e Peças',  'veiculos', 'variavel'),
    ('Combustível e Lubrificante',                 'veiculos', 'variavel'),
    ('IPVA / DPVAT / Licenciamento / Multas',      'veiculos', 'fixo'),
    ('Seguros de Veículos',                        'veiculos', 'fixo'),
    ('Pedágios / Sem Parar / Estacionamentos',     'veiculos', 'variavel'),

    -- Serviços prestados por terceiros
    ('Assessoria em Contabilidade',                          'terceiros', 'fixo'),
    ('Consultoria Empresarial',                               'terceiros', 'fixo'),
    ('Assessoria Jurídica',                                    'terceiros', 'fixo'),
    ('Assessoria de Segurança do Trabalho',                    'terceiros', 'fixo'),
    ('Assessoria em Licenças CETESB / Bombeiro / Outros',      'terceiros', 'fixo'),
    ('Assessoria Médica e Hospitalar',                         'terceiros', 'fixo'),

    -- Despesa financeira
    ('Tarifas Bancárias',                    'financeira', 'variavel'),
    ('Tarifas de Emissão de Boletos',        'financeira', 'variavel'),
    ('Tarifa Desconto de Cheques/Boletos',   'financeira', 'variavel'),
    ('Juros de Boletos',                     'financeira', 'variavel'),
    ('Juros de Empréstimos',                 'financeira', 'variavel'),
    ('Juros Cheque Especial',                'financeira', 'variavel'),
    ('Tarifas de Operadora de Cartão',       'financeira', 'variavel'),

    -- Despesas não operacionais
    ('Parcelas de Empréstimos e Financiamentos', 'nao_operacional', 'variavel'),
    ('Distribuição de Lucros',                    'nao_operacional', 'variavel'),
    ('Outras Despesas não Operacionais',          'nao_operacional', 'variavel'),

    -- Despesas com investimentos e ativo imobilizado
    ('Imóveis',                                        'investimento_imobilizado', 'variavel'),
    ('Móveis e Utensílios',                            'investimento_imobilizado', 'variavel'),
    ('Máquinas e Equipamentos',                        'investimento_imobilizado', 'variavel'),
    ('Equipamentos de Informática',                    'investimento_imobilizado', 'variavel'),
    ('Veículos',                                       'investimento_imobilizado', 'variavel'),
    ('Aplicação Financeira / Reservas da Empresa',     'investimento_imobilizado', 'variavel')
  ) AS t(nome, cod_categoria, custo_tipo)
  JOIN categorias_lancamento cl
    ON cl.codigo = t.cod_categoria
   AND cl.natureza = 'despesa'
   AND cl.tenant_id = v_tenant_id
  WHERE NOT EXISTS (
    SELECT 1 FROM subitens_lancamento sl
    WHERE sl.natureza = 'despesa'
      AND lower(sl.nome) = lower(t.nome)
      AND (sl.tenant_id = v_tenant_id OR sl.tenant_id IS NULL)
  );

  RAISE NOTICE 'Seed de subitens da taxonomia concluído para tenant: %', v_tenant_id;
END;
$$;
