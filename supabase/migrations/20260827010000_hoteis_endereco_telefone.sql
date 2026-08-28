-- Cadastro de 8 hotéis fornecedores enviados pela usuária (endereço/telefone coletados de
-- e-mails/documentos). hoteis_fornecedores só tinha nome/cidade/estado — endereco/telefone
-- são campos A MAIS, nada existente é alterado.
alter table public.hoteis_fornecedores
  add column if not exists endereco text,
  add column if not exists telefone text;

insert into public.hoteis_fornecedores (nome, cidade, estado, endereco, telefone)
select v.nome, v.cidade, v.estado, v.endereco, v.telefone
from (values
  ('Ribalta Hotel', 'Rio de Janeiro', 'RJ', 'Av. das Américas, 9650 – Barra da Tijuca', '(21) 2430-5500'),
  ('Vox Hotel', 'São João de Meriti', 'RJ', 'Estrada Arthur Antônio Sendas, 1010 – Parque Analândia', '(21) 3488-6498'),
  ('Athotel (Hotelaria Recreio)', 'Rio de Janeiro', 'RJ', 'Av. Cesar Morani, 140 – Recreio dos Bandeirantes', '(21) 9963-5300'),
  ('Sleep Inn Vitória', 'Vitória', 'ES', 'Av. Nossa Senhora da Penha, 1212 – Praia do Canto', '(27) 2888-0028'),
  ('Alameda Vitória Hotel', 'Vitória', 'ES', 'Av. Dante Micheline, 585 – Jardim da Penha', '(27) 3204-6600'),
  ('Promenade Prime / Link Stay', 'Itaboraí', 'RJ', 'R. Dr. Mesquita, 367 – Centro', 'Não encontrado nos emails'),
  ('Scorial Rio Hotel', 'Rio de Janeiro', 'RJ', 'Rua Bento Lisboa (número não consta nos documentos)', '(21) 3147-9100'),
  ('Royal Kingdom (Royal Cavaleiros Hotel)', 'Macaé', 'RJ', 'Av. Atlântica (número não consta nos documentos)', '(22) 3737-0800')
) as v(nome, cidade, estado, endereco, telefone)
where not exists (
  select 1 from public.hoteis_fornecedores h where lower(h.nome) = lower(v.nome)
);
