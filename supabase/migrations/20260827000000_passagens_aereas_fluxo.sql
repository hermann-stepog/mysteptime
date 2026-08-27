-- Fase 1 do novo módulo de Passagens Aéreas: fluxo de solicitação → cotação → aprovação →
-- revalidação → emissão. Nada destrutivo — todos os campos/comportamentos atuais de
-- passagens_aereas continuam funcionando; status_fluxo é um campo A MAIS, não substitui
-- "status" (Confirmada/Cancelada/Remarcada), que continua existindo do jeito que está.
alter table public.passagens_aereas
  add column if not exists solicitante text,
  add column if not exists solicitante_email text,
  add column if not exists internacional boolean not null default false,
  add column if not exists status_fluxo text not null default 'emitida',
  add column if not exists opcoes_texto_agencia text,
  add column if not exists opcao_escolhida_id uuid,
  add column if not exists aprovado_por text,
  add column if not exists aprovado_em timestamptz,
  add column if not exists comentario_aprovacao text,
  add column if not exists revalidado_por text,
  add column if not exists revalidado_em timestamptz,
  add column if not exists diferenca_preco numeric(12,2);

alter table public.passagens_aereas
  add constraint passagens_aereas_status_fluxo_check
  check (status_fluxo in (
    'solicitada', 'cotacao_recebida', 'aguardando_aprovacao', 'aguardando_revalidacao',
    'aguardando_emissao', 'emitida', 'concluida'
  ));

create table if not exists public.passagem_opcoes (
  id uuid primary key default gen_random_uuid(),
  passagem_id uuid not null references public.passagens_aereas(id) on delete cascade,
  numero integer not null,
  companhia text,
  voo text,
  data_hora_ida timestamptz,
  bagagem text,
  valor numeric(12,2),
  valor_alteracao numeric(12,2),
  criado_em timestamptz not null default now()
);
create index if not exists passagem_opcoes_passagem_idx on public.passagem_opcoes(passagem_id);

alter table public.passagens_aereas
  add constraint passagens_aereas_opcao_escolhida_fkey
  foreign key (opcao_escolhida_id) references public.passagem_opcoes(id) on delete set null;

create table if not exists public.passagem_status_history (
  id uuid primary key default gen_random_uuid(),
  passagem_id uuid not null references public.passagens_aereas(id) on delete cascade,
  status text not null,
  changed_by_name text not null,
  changed_at timestamptz not null default now(),
  notes text
);
create index if not exists passagem_status_history_passagem_idx on public.passagem_status_history(passagem_id);

alter table public.passagem_opcoes enable row level security;
alter table public.passagem_status_history enable row level security;

drop policy if exists "operators_passagem_opcoes_all" on public.passagem_opcoes;
create policy "operators_passagem_opcoes_all" on public.passagem_opcoes
  for all to authenticated
  using (public.is_operator(auth.uid()))
  with check (public.is_operator(auth.uid()));

drop policy if exists "operators_passagem_status_history_all" on public.passagem_status_history;
create policy "operators_passagem_status_history_all" on public.passagem_status_history
  for all to authenticated
  using (public.is_operator(auth.uid()))
  with check (public.is_operator(auth.uid()));

-- Papéis rh/sms já existem no enum app_role (20260812000000_nominations_new_roles.sql), mas
-- nunca ganharam helper SQL nem uso real — criando agora pra dar visibilidade ao Relatório de
-- Viagens Internacionais (Fase 3), só leitura, só registros internacionais.
create or replace function public.is_rh(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = 'rh')
$$;

create or replace function public.is_sms(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = 'sms')
$$;

drop policy if exists "rh_sms_view_international" on public.passagens_aereas;
create policy "rh_sms_view_international" on public.passagens_aereas
  for select to authenticated
  using (internacional = true and (public.is_rh(auth.uid()) or public.is_sms(auth.uid())));
