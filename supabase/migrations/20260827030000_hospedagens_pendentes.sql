-- 11 hospedagens que ficaram de fora da importação em lote (vieram de um print à parte).
-- Fornecedores usados já existem em hoteis_fornecedores (Brisa Tropical, Ribalta, Promenade
-- Prime, Paradiso, Sleep Inn, Windsor Plaza) — nenhum hotel novo precisa ser criado.
insert into public.hospedagens
  (unidade, bsp, nome_usuario, hotel_id, check_in, check_out, diarias, valor_diaria, valor_total,
   motivo, observacoes, nf, fornecedor, cobrado, status_lancamento, faturado)
values
  ('Executiva', 'Não informado', 'FILLIPE PEREIRA',
   (select id from public.hoteis_fornecedores where nome = 'BRISA TROPICAL'),
   '2026-02-04', '2026-02-05', 1, 674.38, 674.38,
   'PEDIDO CARLO D.', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 04 ATE 05/02',
   '79843', 'BRISA TROPICAL', false, 'Definitivo', false),

  ('MARICA', '25-832', 'CRISTIAN COMAN',
   (select id from public.hoteis_fornecedores where nome = 'Ribalta Hotel'),
   '2026-02-09', '2026-02-10', 1, 455.40, 455.40,
   'EMBARQUE TRANSFERIDO', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 09 ATE 10/02',
   '659/026', 'RIBALTA', false, 'Definitivo', false),

  ('MARICA', '26-488', 'LUIS ANDRESSO',
   (select id from public.hoteis_fornecedores where nome = 'Ribalta Hotel'),
   '2026-06-24', '2026-06-25', 1, 255.68, 255.68,
   'EMBARQUE TRANSFERIDO', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 24 ATE 25/06',
   '3575', 'RIBALTA', false, 'Definitivo', false),

  ('MARICA', '26-488', 'LUIS ANDRESSO',
   (select id from public.hoteis_fornecedores where nome = 'Ribalta Hotel'),
   '2026-07-07', '2026-07-08', 1, 428.40, 428.40,
   'EMBARQUE TRANSFERIDO', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 07/07 A 08/07',
   '3981', 'RIBALTA', false, 'Definitivo', false),

  ('ALMIRANTE TAMANDARÉ', '25-1310-007', 'RODRIGO GONCALVES',
   (select id from public.hoteis_fornecedores where nome = 'Promenade Prime / Link Stay'),
   '2026-05-20', '2026-05-21', 1, 452.10, 452.10,
   'EMBARQUE', 'Hospedagem - COM cobrança ao cliente — PERIODO: 20 ATE 21/05',
   '44241', 'PROMENADE PRIME', true, 'Definitivo', false),

  ('ALMIRANTE TAMANDARÉ', '25-1310-007', 'GEANDRO SILVA',
   (select id from public.hoteis_fornecedores where nome = 'Promenade Prime / Link Stay'),
   '2026-06-02', '2026-06-02', 1, 13.00, 13.00,
   'EMBARQUE', 'Hospedagem - COM cobrança ao cliente — ALIMENTAÇÃO',
   '44308', 'PROMENADE PRIME', true, 'Definitivo', false),

  ('ALEXANDRE DE GUSMÃO', '25-1310-001', 'JEFERSON VACCARI',
   (select id from public.hoteis_fornecedores where nome = 'PARADISO'),
   '2026-06-24', '2026-06-25', 1, 399.00, 399.00,
   'EMBARQUE', 'Hospedagem - COM cobrança ao cliente — PERIODO: 24 ATE 25/06',
   '2026000982', 'PARADISO', true, 'Provisório', false),

  ('MARIA QUITÉRIA', '26-053-01', 'ENEIAS COSTA',
   (select id from public.hoteis_fornecedores where nome = 'Sleep Inn Vitória'),
   '2026-02-04', '2026-02-05', 1, 508.38, 508.38,
   'IDA PARA HOTEL', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 04 ATE 05/02',
   '69468', 'SLEEP INN', false, 'Definitivo', false),

  ('MARIA QUITÉRIA', '26-053-01', 'ANDRE SOUZA',
   (select id from public.hoteis_fornecedores where nome = 'Sleep Inn Vitória'),
   '2026-02-10', '2026-02-11', 1, 741.65, 741.65,
   'EMBARQUE', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 10 ATE 11/02',
   '69559', 'SLEEP INN', false, 'Definitivo', false),

  ('ALMIRANTE TAMANDARÉ', '25-751-007', 'GEANDRO SILVA',
   (select id from public.hoteis_fornecedores where nome = 'Promenade Prime / Link Stay'),
   '2026-02-11', '2026-02-12', 1, 393.80, 393.80,
   'EMBARQUE', 'Hospedagem - COM cobrança ao cliente — PERIODO: 11 ATE 12/02 - DIARIA',
   '41841', 'PROMENADE PRIME', true, 'Definitivo', false),

  ('ATLANTA', '24-309', 'RAFAEL BRANDAO',
   (select id from public.hoteis_fornecedores where nome = 'WINDSOR PLAZA'),
   '2026-05-05', '2026-05-06', 1, 624.38, 624.38,
   'REUNIAO', 'Hospedagem - SEM cobrança ao cliente — PERIODO: 05 ATE 06/05',
   'CARTAO 8', 'WINDSOR PLAZA', false, 'Definitivo', false);
