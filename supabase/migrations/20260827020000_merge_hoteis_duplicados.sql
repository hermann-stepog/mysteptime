-- Mescla hotéis duplicados em hoteis_fornecedores: pra cada grupo, mantém o registro que já
-- tem hospedagens de verdade vinculadas (o de maior uso), reatribui as hospedagens dos
-- duplicados pra ele, completa nome/cidade/estado/endereco/telefone com os dados corretos que
-- a usuária enviou, e então apaga os duplicados (inclusive os 7 registros "novos" criados na
-- migration anterior, que ficaram sem nenhuma hospedagem vinculada e viraram redundantes).
-- Idempotente: usa DELETE/UPDATE por id, seguro rodar mais de uma vez.

-- 1) Alameda Vitória Hotel — mantém "ALAMEDA VITORIA" (8 hospedagens)
update public.hospedagens set hotel_id = '8d80b394-ce5a-4e62-9e5f-8fdf2a5b2469'
  where hotel_id = '85cc6093-948a-4592-8c56-06f2663bf51a'; -- ALAMEDA VITORIA HOTEL (1)
delete from public.hoteis_fornecedores where id = '85cc6093-948a-4592-8c56-06f2663bf51a';
delete from public.hoteis_fornecedores where id = '271bb270-be77-43d0-bb7b-936f7e7123aa'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Alameda Vitória Hotel', cidade = 'Vitória', estado = 'ES',
  endereco = 'Av. Dante Micheline, 585 – Jardim da Penha', telefone = '(27) 3204-6600'
  where id = '8d80b394-ce5a-4e62-9e5f-8fdf2a5b2469';

-- 2) Athotel (Hotelaria Recreio) — mantém "ATH HOTEL" (5 hospedagens)
update public.hospedagens set hotel_id = 'ec535275-751c-4a83-bffc-15a8166d5faf'
  where hotel_id in ('549a5ed5-8ffc-4aa9-b4b1-26dcd2159d1c', '1de3c5b8-74af-480b-b9a8-cea1bedcbdb1'); -- AT HOTEL (1), ATH (2)
delete from public.hoteis_fornecedores where id in ('549a5ed5-8ffc-4aa9-b4b1-26dcd2159d1c', '1de3c5b8-74af-480b-b9a8-cea1bedcbdb1');
delete from public.hoteis_fornecedores where id = 'a9173170-b592-4dda-b8fa-ac7c5cd3d747'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Athotel (Hotelaria Recreio)', cidade = 'Rio de Janeiro', estado = 'RJ',
  endereco = 'Av. Cesar Morani, 140 – Recreio dos Bandeirantes', telefone = '(21) 9963-5300'
  where id = 'ec535275-751c-4a83-bffc-15a8166d5faf';

-- 3) Promenade Prime / Link Stay — mantém "PROMENADE PRIME" (40 hospedagens)
update public.hospedagens set hotel_id = '51992c77-7141-4215-a90a-6a1c4bb50ce6'
  where hotel_id = '49a963de-f1b0-482a-ad3d-e702ba3cbc9a'; -- PROMENADE LINK STAY (14)
delete from public.hoteis_fornecedores where id = '49a963de-f1b0-482a-ad3d-e702ba3cbc9a';
delete from public.hoteis_fornecedores where id = 'bb543708-575e-464a-a5bf-9658891fd323'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Promenade Prime / Link Stay', cidade = 'Itaboraí', estado = 'RJ',
  endereco = 'R. Dr. Mesquita, 367 – Centro', telefone = 'Não encontrado nos emails'
  where id = '51992c77-7141-4215-a90a-6a1c4bb50ce6';

-- 4) Royal Kingdom (Royal Cavaleiros Hotel) — mantém "ROYAL KINGDOM" (7 hospedagens).
-- "ROYAL HOTEL" e "ROYAL INTERNACIONAL" ficam de fora de propósito: nome parecido, mas sem
-- certeza de que são o mesmo hotel — não mistura dado sem confirmação.
delete from public.hoteis_fornecedores where id = 'd4dbcda5-0812-442a-8d09-dbf01ac28273'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Royal Kingdom (Royal Cavaleiros Hotel)', cidade = 'Macaé', estado = 'RJ',
  endereco = 'Av. Atlântica (número não consta nos documentos)', telefone = '(22) 3737-0800'
  where id = '8220a166-28c4-48e0-8966-a23c00974a86';

-- 5) Scorial Rio Hotel — mantém "SCORIAL" (10 hospedagens)
update public.hospedagens set hotel_id = 'e468d1ba-96f6-45cd-b222-af6c3b297139'
  where hotel_id = '2d7cd63e-8172-471d-ad38-8d8aa3578686'; -- SCORIAL RIO (2)
delete from public.hoteis_fornecedores where id = '2d7cd63e-8172-471d-ad38-8d8aa3578686';
delete from public.hoteis_fornecedores where id = 'e9381e7b-8ee6-466e-bae1-889b4199a41e'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Scorial Rio Hotel', cidade = 'Rio de Janeiro', estado = 'RJ',
  endereco = 'Rua Bento Lisboa (número não consta nos documentos)', telefone = '(21) 3147-9100'
  where id = 'e468d1ba-96f6-45cd-b222-af6c3b297139';

-- 6) Sleep Inn Vitória — mantém "SLEEP INN" (104 hospedagens)
delete from public.hoteis_fornecedores where id = '8fca5746-81f1-4dc4-bab0-66b27a62d1b4'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Sleep Inn Vitória', cidade = 'Vitória', estado = 'ES',
  endereco = 'Av. Nossa Senhora da Penha, 1212 – Praia do Canto', telefone = '(27) 2888-0028'
  where id = 'fba0efc6-7187-4bd4-a3bb-3f94949f4a11';

-- 7) Vox Hotel — mantém "VOX" (10 hospedagens)
delete from public.hoteis_fornecedores where id = 'cccbe38a-a86c-4fb7-89a1-d7fd842516c3'; -- dup novo, 0 hospedagens
update public.hoteis_fornecedores set
  nome = 'Vox Hotel', cidade = 'São João de Meriti', estado = 'RJ',
  endereco = 'Estrada Arthur Antônio Sendas, 1010 – Parque Analândia', telefone = '(21) 3488-6498'
  where id = 'd95f78bc-baab-4e9c-bbd3-b4dea7249779';

-- 8) Ribalta Hotel — nunca foi criado na migration anterior (colidiu por nome com "RIBALTA
-- HOTEL", que já existia sem endereço/telefone) — mantém "RIBALTA" (131 hospedagens, o maior uso
-- de todos os hotéis do sistema).
update public.hospedagens set hotel_id = 'f683069f-6449-4854-943e-99646d670c10'
  where hotel_id = 'e7a1d663-af2f-4944-8d0f-07c179213d9d'; -- RIBALTA HOTEL (1)
delete from public.hoteis_fornecedores where id = 'e7a1d663-af2f-4944-8d0f-07c179213d9d';
update public.hoteis_fornecedores set
  nome = 'Ribalta Hotel', cidade = 'Rio de Janeiro', estado = 'RJ',
  endereco = 'Av. das Américas, 9650 – Barra da Tijuca', telefone = '(21) 2430-5500'
  where id = 'f683069f-6449-4854-943e-99646d670c10';
