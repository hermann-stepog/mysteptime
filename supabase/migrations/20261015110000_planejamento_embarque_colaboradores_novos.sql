-- "Colaborador novo" no Planejamento de Embarque — sinalização pedida por ela, que precisa
-- sobreviver à reimportação da planilha (ImportarPlanejamentoDialog apaga TODAS as linhas e
-- reinsere do zero a cada import, então created_at de planejamento_embarque reseta pra NOW()
-- em todo mundo a cada reimportação — não serve pra saber quem é realmente novo). Esta tabela
-- separada guarda a primeira vez que cada nome apareceu, por nome normalizado (sem acento/
-- maiúsculo/pontuação — mesmo critério de normNomePlanejamento em NominationsPage.tsx), e nunca
-- é tocada pelo delete+insert da importação.
create table public.planejamento_colaboradores_vistos (
  nome_normalizado text primary key,
  primeira_vez_em  timestamptz not null default now()
);

alter table public.planejamento_colaboradores_vistos enable row level security;

create policy "operators_planejamento_colaboradores_vistos_select"
  on public.planejamento_colaboradores_vistos
  for select to authenticated
  using (public.is_operator(auth.uid()));

create or replace function public.planejamento_normalizar_nome(p_nome text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(upper(translate(
    coalesce(p_nome, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCcNn'
  )), '[^A-Z0-9]+', ' ', 'g'));
$$;

-- SECURITY DEFINER pra gravar mesmo quando quem está importando/cadastrando não tem (e não
-- precisa ter) policy de INSERT na tabela de controle — mesmo padrão já usado em
-- rh_set_bloqueio_planejamento.
create or replace function public.planejamento_marcar_primeira_vez()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.planejamento_colaboradores_vistos (nome_normalizado)
  values (public.planejamento_normalizar_nome(new.nome))
  on conflict (nome_normalizado) do nothing;
  return new;
end;
$$;

create trigger planejamento_embarque_marca_primeira_vez
  after insert on public.planejamento_embarque
  for each row
  execute function public.planejamento_marcar_primeira_vez();

-- Backfill: todo mundo que já está na planilha hoje não deve nascer marcado como "novo" quando
-- essa funcionalidade for publicada — data bem antiga, só pra existir o registro.
insert into public.planejamento_colaboradores_vistos (nome_normalizado, primeira_vez_em)
select distinct public.planejamento_normalizar_nome(nome), '2000-01-01T00:00:00Z'::timestamptz
from public.planejamento_embarque
on conflict (nome_normalizado) do nothing;
