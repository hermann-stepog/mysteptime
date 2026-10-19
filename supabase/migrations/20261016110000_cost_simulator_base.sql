-- Reestruturação do Simulador de Custos Logísticos (pedido dela, 2026-10-16): uma função só
-- (cost_simulator_base) no lugar de cost_simulator_unit_stats, cost_simulator_local_stats e
-- cost_simulator_transport_trajetos — devolvendo, PRA CADA ITEM PEDIDO (cada cidade/rota/
-- trajeto), o custo unitário já resolvido com o fallback de amostra pequena (n<5) em cascata:
-- específico → mais amplo → geral do sistema. O front não reconcilia mapas soltos, só lê
-- resultado.stats/nivel/amostraPequena por item. Só calcula as categorias pedidas em
-- p_filters.categorias. cost_simulator_hoteis_regiao e cost_simulator_transport_locais
-- continuam como estão (autocomplete, fora da consolidação).
--
-- Limitações assumidas, documentadas aqui porque não têm como ficar óbvias na função em si:
-- - reembolso_itens não tem coluna de cidade (só bsp) — Alimentação cai pro nível "bsp" em vez
--   de cidade (fallback: bsp pedido → geral). Lavanderia nem tem categoria própria em
--   CATEGORIAS_REEMBOLSO — usa categoria='Outros' com categoria_outro contendo "lavand", só
--   nível "geral" (não tem o que agrupar).
-- - Fallback de 3 níveis (específico → "mesma UF" → geral) só existe de verdade pra Hospedagem,
--   que tem uma coluna de estado disponível via hoteis_fornecedores. Passagem ganha um nível
--   intermediário próprio pedido por ela (rota exata → todas as rotas que chegam no mesmo
--   destino → geral) em vez de UF, que não faz sentido pra uma rota. Transporte/Uber/Transporte
--   executivo ficam em 2 níveis (rota → geral) — não têm um "mesma UF" natural pra uma rota.

create or replace function public._cost_sim_norm(p_texto text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(upper(translate(
    coalesce(p_texto, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCcNn'
  )), '[^A-Z0-9]+', ' ', 'g'));
$$;

create or replace function public._cost_sim_stats(p_valores numeric[], p_ultimo numeric, p_ultima_data date)
returns jsonb
language sql
immutable
as $$
  select case
    when p_valores is null or array_length(p_valores, 1) is null then null
    else jsonb_build_object(
      'n', array_length(p_valores, 1),
      'media', round((select avg(v) from unnest(p_valores) v)::numeric, 2),
      'mediana', round((select percentile_cont(0.5) within group (order by v) from unnest(p_valores) v)::numeric, 2),
      'p25', round((select percentile_cont(0.25) within group (order by v) from unnest(p_valores) v)::numeric, 2),
      'p75', round((select percentile_cont(0.75) within group (order by v) from unnest(p_valores) v)::numeric, 2),
      'minimo', round((select min(v) from unnest(p_valores) v)::numeric, 2),
      'maximo', round((select max(v) from unnest(p_valores) v)::numeric, 2),
      'ultimo', round(coalesce(p_ultimo, 0)::numeric, 2),
      'ultima_data', p_ultima_data
    )
  end;
$$;

-- Escolhe, em ordem de prioridade, o primeiro candidato com amostra "boa" (n>=5); se nenhum
-- tiver, cai pro primeiro candidato que pelo menos tenha algum dado (n>=1) e marca
-- amostraPequena=true; sem candidato nenhum, devolve nivel="nenhum" (stats null — "Sem histórico").
create or replace function public._cost_sim_resolver(p_candidatos jsonb[], p_niveis text[])
returns jsonb
language plpgsql
immutable
as $$
declare
  v_fallback_stats jsonb := null;
  v_fallback_nivel text := null;
  i int;
begin
  if p_candidatos is null or array_length(p_candidatos, 1) is null then
    return jsonb_build_object('stats', null, 'nivel', 'nenhum', 'amostraPequena', false);
  end if;
  for i in 1 .. array_length(p_candidatos, 1) loop
    if p_candidatos[i] is not null and (p_candidatos[i]->>'n')::int >= 5 then
      return jsonb_build_object('stats', p_candidatos[i], 'nivel', p_niveis[i], 'amostraPequena', false);
    end if;
    if v_fallback_stats is null and p_candidatos[i] is not null then
      v_fallback_stats := p_candidatos[i];
      v_fallback_nivel := p_niveis[i];
    end if;
  end loop;
  if v_fallback_stats is not null then
    return jsonb_build_object('stats', v_fallback_stats, 'nivel', v_fallback_nivel, 'amostraPequena', true);
  end if;
  return jsonb_build_object('stats', null, 'nivel', 'nenhum', 'amostraPequena', false);
end;
$$;

create or replace function public.cost_simulator_base(p_filters jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio date := coalesce(nullif(p_filters->>'periodo_inicio', '')::date, '1900-01-01'::date);
  v_fim date := coalesce(nullif(p_filters->>'periodo_fim', '')::date, '2999-12-31'::date);
  v_categorias text[] := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p_filters->'categorias', '[]'::jsonb)) x),
    array[]::text[]
  );
  v_hotel_ids uuid[] := coalesce(
    (select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_filters->'hotel_ids', '[]'::jsonb)) x),
    array[]::uuid[]
  );
  v_out jsonb := '{}'::jsonb;
  v_item jsonb;
  v_resultado jsonb;
  v_cidade_norm text;
  v_estado text;
  v_origem_norm text;
  v_destino_norm text;
  v_rota_norm text;
  v_stats_a jsonb;
  v_stats_b jsonb;
  v_stats_c jsonb;
begin
  if not (public.is_operator(auth.uid()) or public.has_role(auth.uid(), 'orcamentos_projetos')) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  -- ── HOSPEDAGEM (por noite): cidade → estado (mesma UF) → geral ──────────────────────────
  if 'hospedagem' = any(v_categorias) then
    v_resultado := '{}'::jsonb;
    for v_item in select * from jsonb_array_elements_text(coalesce(p_filters->'hospedagem_cidades', '[]'::jsonb)) loop
      v_cidade_norm := public._cost_sim_norm(v_item #>> '{}');

      select hf.estado into v_estado
      from public.hoteis_fornecedores hf
      where public._cost_sim_norm(hf.cidade) = v_cidade_norm
      limit 1;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_a
      from (
        select h.valor_total / greatest(1, (h.check_out - h.check_in)) as valor, h.check_in as data
        from public.hospedagens h
        join public.hoteis_fornecedores hf on hf.id = h.hotel_id
        where h.check_in between v_inicio and v_fim
          and h.valor_total is not null and h.valor_total > 0
          and (array_length(v_hotel_ids, 1) is null or h.hotel_id = any(v_hotel_ids))
          and public._cost_sim_norm(hf.cidade) = v_cidade_norm
      ) base;

      if v_estado is not null then
        select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
        into v_stats_b
        from (
          select h.valor_total / greatest(1, (h.check_out - h.check_in)) as valor, h.check_in as data
          from public.hospedagens h
          join public.hoteis_fornecedores hf on hf.id = h.hotel_id
          where h.check_in between v_inicio and v_fim
            and h.valor_total is not null and h.valor_total > 0
            and hf.estado = v_estado
        ) base;
      else
        v_stats_b := null;
      end if;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_c
      from (
        select h.valor_total / greatest(1, (h.check_out - h.check_in)) as valor, h.check_in as data
        from public.hospedagens h
        where h.check_in between v_inicio and v_fim
          and h.valor_total is not null and h.valor_total > 0
      ) base;

      v_resultado := v_resultado || jsonb_build_object(
        v_item #>> '{}',
        public._cost_sim_resolver(
          array[v_stats_a, v_stats_b, v_stats_c],
          array['cidade', 'estado', 'geral']
        )
      );
    end loop;
    v_out := v_out || jsonb_build_object('hospedagem', v_resultado);
  end if;

  -- ── PASSAGEM AÉREA (por trecho): rota exata → mesmo destino → geral ────────────────────
  if 'passagem' = any(v_categorias) then
    v_resultado := '{}'::jsonb;
    for v_item in select * from jsonb_array_elements(coalesce(p_filters->'passagem_rotas', '[]'::jsonb)) loop
      v_origem_norm := public._cost_sim_norm(v_item->>'origem');
      v_destino_norm := public._cost_sim_norm(v_item->>'destino');
      v_rota_norm := v_origem_norm || '|' || v_destino_norm;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_a
      from (
        select p.valor as valor, p.data_ida as data
        from public.passagens_aereas p
        where p.status = 'Confirmada' and p.data_ida between v_inicio and v_fim
          and p.valor is not null and p.valor > 0
          and public._cost_sim_norm(p.origem) = v_origem_norm
          and public._cost_sim_norm(p.destino) = v_destino_norm
      ) base;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_b
      from (
        select p.valor as valor, p.data_ida as data
        from public.passagens_aereas p
        where p.status = 'Confirmada' and p.data_ida between v_inicio and v_fim
          and p.valor is not null and p.valor > 0
          and public._cost_sim_norm(p.destino) = v_destino_norm
      ) base;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_c
      from (
        select p.valor as valor, p.data_ida as data
        from public.passagens_aereas p
        where p.status = 'Confirmada' and p.data_ida between v_inicio and v_fim
          and p.valor is not null and p.valor > 0
      ) base;

      v_resultado := v_resultado || jsonb_build_object(
        v_rota_norm,
        public._cost_sim_resolver(
          array[v_stats_a, v_stats_b, v_stats_c],
          array['rota', 'destino', 'geral']
        )
      );
    end loop;
    v_out := v_out || jsonb_build_object('passagem', v_resultado);
  end if;

  -- ── TRANSPORTE TERRESTRE / UBER / TRANSPORTE EXECUTIVO (por viagem): rota → geral ──────
  -- Mesma fonte (transport_trips), só muda o filtro de car_number por categoria.
  if 'transporteTerrestre' = any(v_categorias) then
    v_resultado := '{}'::jsonb;
    for v_item in select * from jsonb_array_elements(coalesce(p_filters->'transporte_terrestre_trajetos', '[]'::jsonb)) loop
      v_origem_norm := public._cost_sim_norm(v_item->>'origem');
      v_destino_norm := public._cost_sim_norm(v_item->>'destino');
      v_rota_norm := v_origem_norm || '|' || v_destino_norm;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_a
      from (
        select (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) as valor, t.scheduled_at::date as data
        from public.transport_trips t
        where not t.cancelado and t.scheduled_at::date between v_inicio and v_fim
          and t.car_number not ilike 'uber%' and t.car_number not ilike 'future%'
          and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
          and public._cost_sim_norm(t.origin) = v_origem_norm
          and public._cost_sim_norm(t.destination) = v_destino_norm
      ) base;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_c
      from (
        select (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) as valor, t.scheduled_at::date as data
        from public.transport_trips t
        where not t.cancelado and t.scheduled_at::date between v_inicio and v_fim
          and t.car_number not ilike 'uber%' and t.car_number not ilike 'future%'
          and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
      ) base;

      v_resultado := v_resultado || jsonb_build_object(
        v_rota_norm,
        public._cost_sim_resolver(array[v_stats_a, v_stats_c], array['rota', 'geral'])
      );
    end loop;
    v_out := v_out || jsonb_build_object('transporteTerrestre', v_resultado);
  end if;

  if 'uber' = any(v_categorias) then
    v_resultado := '{}'::jsonb;
    for v_item in select * from jsonb_array_elements(coalesce(p_filters->'uber_trajetos', '[]'::jsonb)) loop
      v_origem_norm := public._cost_sim_norm(v_item->>'origem');
      v_destino_norm := public._cost_sim_norm(v_item->>'destino');
      v_rota_norm := v_origem_norm || '|' || v_destino_norm;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_a
      from (
        select (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) as valor, t.scheduled_at::date as data
        from public.transport_trips t
        where not t.cancelado and t.scheduled_at::date between v_inicio and v_fim
          and t.car_number ilike 'uber%'
          and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
          and public._cost_sim_norm(t.origin) = v_origem_norm
          and public._cost_sim_norm(t.destination) = v_destino_norm
      ) base;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_c
      from (
        select (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) as valor, t.scheduled_at::date as data
        from public.transport_trips t
        where not t.cancelado and t.scheduled_at::date between v_inicio and v_fim
          and t.car_number ilike 'uber%'
          and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
      ) base;

      v_resultado := v_resultado || jsonb_build_object(
        v_rota_norm,
        public._cost_sim_resolver(array[v_stats_a, v_stats_c], array['rota', 'geral'])
      );
    end loop;
    v_out := v_out || jsonb_build_object('uber', v_resultado);
  end if;

  if 'transporteExecutivo' = any(v_categorias) then
    v_resultado := '{}'::jsonb;
    for v_item in select * from jsonb_array_elements(coalesce(p_filters->'transporte_executivo_trajetos', '[]'::jsonb)) loop
      v_origem_norm := public._cost_sim_norm(v_item->>'origem');
      v_destino_norm := public._cost_sim_norm(v_item->>'destino');
      v_rota_norm := v_origem_norm || '|' || v_destino_norm;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_a
      from (
        select (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) as valor, t.scheduled_at::date as data
        from public.transport_trips t
        where not t.cancelado and t.scheduled_at::date between v_inicio and v_fim
          and t.car_number ilike 'future%'
          and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
          and public._cost_sim_norm(t.origin) = v_origem_norm
          and public._cost_sim_norm(t.destination) = v_destino_norm
      ) base;

      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_c
      from (
        select (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) as valor, t.scheduled_at::date as data
        from public.transport_trips t
        where not t.cancelado and t.scheduled_at::date between v_inicio and v_fim
          and t.car_number ilike 'future%'
          and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
      ) base;

      v_resultado := v_resultado || jsonb_build_object(
        v_rota_norm,
        public._cost_sim_resolver(array[v_stats_a, v_stats_c], array['rota', 'geral'])
      );
    end loop;
    v_out := v_out || jsonb_build_object('transporteExecutivo', v_resultado);
  end if;

  -- ── ALIMENTAÇÃO (por dia, histórico de Reembolsos): bsp pedido → geral ──────────────────
  -- reembolso_itens não tem cidade, só bsp — não dá pra fazer o fallback "mesma UF" aqui.
  if 'alimentacao' = any(v_categorias) then
    select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
    into v_stats_c
    from (
      select ri.valor as valor, ri.data_despesa as data
      from public.reembolso_itens ri
      join public.reembolsos r on r.id = ri.reembolso_id
      where ri.categoria in ('Alimentação', 'Alimentação — Mercado')
        and ri.data_despesa between v_inicio and v_fim
        and r.status_fluxo <> 'rejeitado'
        and ri.valor is not null and ri.valor > 0
    ) base;

    if nullif(trim(coalesce(p_filters->>'alimentacao_bsp', '')), '') is not null then
      select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
      into v_stats_a
      from (
        select ri.valor as valor, ri.data_despesa as data
        from public.reembolso_itens ri
        join public.reembolsos r on r.id = ri.reembolso_id
        where ri.categoria in ('Alimentação', 'Alimentação — Mercado')
          and ri.data_despesa between v_inicio and v_fim
          and r.status_fluxo <> 'rejeitado'
          and ri.valor is not null and ri.valor > 0
          and trim(ri.bsp) = trim(p_filters->>'alimentacao_bsp')
      ) base;
      v_out := v_out || jsonb_build_object(
        'alimentacao',
        public._cost_sim_resolver(array[v_stats_a, v_stats_c], array['bsp', 'geral'])
      );
    else
      v_out := v_out || jsonb_build_object(
        'alimentacao',
        public._cost_sim_resolver(array[v_stats_c], array['geral'])
      );
    end if;
  end if;

  -- ── LAVANDERIA (histórico de Reembolsos — sem categoria própria, usa "Outros" + texto) ───
  if 'lavanderia' = any(v_categorias) then
    select public._cost_sim_stats(array_agg(valor), (array_agg(valor order by data desc))[1], max(data))
    into v_stats_c
    from (
      select ri.valor as valor, ri.data_despesa as data
      from public.reembolso_itens ri
      join public.reembolsos r on r.id = ri.reembolso_id
      where ri.categoria = 'Outros' and ri.categoria_outro ilike '%lavand%'
        and ri.data_despesa between v_inicio and v_fim
        and r.status_fluxo <> 'rejeitado'
        and ri.valor is not null and ri.valor > 0
    ) base;
    v_out := v_out || jsonb_build_object(
      'lavanderia',
      public._cost_sim_resolver(array[v_stats_c], array['geral'])
    );
  end if;

  return v_out;
end;
$$;

revoke all on function public.cost_simulator_base(jsonb) from public;
grant execute on function public.cost_simulator_base(jsonb) to authenticated;

-- Substituída por cost_simulator_base — nada mais no código chama essas três.
drop function if exists public.cost_simulator_unit_stats(jsonb);
drop function if exists public.cost_simulator_local_stats(jsonb);
drop function if exists public.cost_simulator_transport_trajetos(jsonb);

-- Trajetos já conhecidos (com n/mediana), pra alimentar o combobox pesquisável de
-- Origem/Destino em Uber/Transporte executivo/Transporte terrestre (pedido dela, item 6) — sem
-- isso o campo continuava sendo texto livre com só uma lista de locais soltos, sem trajeto nem
-- estatística nenhuma. p_tipo: 'uber' | 'future' | 'terrestre' (= nem uber nem future).
create or replace function public.cost_simulator_trajetos_conhecidos(p_tipo text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'origem', origem, 'destino', destino, 'n', n, 'mediana', mediana
  ) order by n desc), '[]'::jsonb)
  from (
    select
      t.origin as origem,
      t.destination as destino,
      count(*) as n,
      round((percentile_cont(0.5) within group (
        order by (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0))
      ))::numeric, 2) as mediana
    from public.transport_trips t
    where not t.cancelado
      and t.origin is not null and t.destination is not null
      and (coalesce(t.custo, 0) + coalesce(t.custo_2, 0) + coalesce(t.custo_3, 0)) > 0
      and (
        (p_tipo = 'uber' and t.car_number ilike 'uber%')
        or (p_tipo = 'future' and t.car_number ilike 'future%')
        or (p_tipo = 'terrestre' and t.car_number not ilike 'uber%' and t.car_number not ilike 'future%')
      )
    group by t.origin, t.destination
  ) agregado;
$$;

revoke all on function public.cost_simulator_trajetos_conhecidos(text) from public;
grant execute on function public.cost_simulator_trajetos_conhecidos(text) to authenticated;
