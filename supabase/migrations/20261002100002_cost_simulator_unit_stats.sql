-- Função agregadora do Simulador de Custos Logísticos (pedido dela, 2026-10-02) — SECURITY
-- DEFINER de propósito: é a ÚNICA porta de entrada do papel "orcamentos_projetos" pros dados de
-- Transporte/Hospedagem/Passagens Aéreas. Essa migration NÃO dá nenhuma policy de SELECT pra
-- esse papel em transport_trips/hospedagens/hoteis_fornecedores/passagens_aereas — a ausência é
-- a própria garantia de que ele só vê valores agregados (média/mediana/último + nº de amostras),
-- nunca os lançamentos individuais. Também não mexe em is_operator() — Admin/Logística de
-- Pessoal continuam com o acesso amplo que já tinham, por fora dessa função.

CREATE OR REPLACE FUNCTION public._cost_sim_stats(valores numeric[])
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'media', round((SELECT avg(v) FROM unnest(valores) v)::numeric, 2),
    'mediana', round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v) FROM unnest(valores) v)::numeric, 2),
    'ultimo', valores[array_upper(valores, 1)],
    'n', array_length(valores, 1)
  );
$$;
REVOKE ALL ON FUNCTION public._cost_sim_stats(numeric[]) FROM PUBLIC;

-- p_filters (jsonb): {
--   periodo_inicio, periodo_fim: 'YYYY-MM-DD' (resolvido no cliente a partir de "últimos N
--     meses" ou período customizado),
--   cidade_embarque: text (filtra hospedagem pela cidade do hotel e transporte por
--     origem/destino/extras),
--   hotel_ids?: uuid[] (filtro de base opcional, restringe a hotéis específicos),
--   tipo_transporte?: text (filtra pelo nome limpo do transporte, ex. "Uber"/"Future"),
--   rotas?: [{origem, destino}] (uma por cidade de origem distinta na equipe da simulação —
--     várias pessoas podem embarcar de cidades diferentes, por isso é uma lista, não um par só)
-- }
-- Retorno: { hospedagem?: Stats, transporte?: Stats, passagens?: { "origem|destino": Stats } }
-- onde Stats = {media, mediana, ultimo, n}. Categoria/rota fica OMITIDA quando não há nenhum
-- lançamento no período filtrado (pedido dela: sem aviso, a categoria simplesmente não aparece).
CREATE OR REPLACE FUNCTION public.cost_simulator_unit_stats(p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_periodo_inicio date := (p_filters->>'periodo_inicio')::date;
  v_periodo_fim date := (p_filters->>'periodo_fim')::date;
  v_cidade_embarque text := nullif(trim(p_filters->>'cidade_embarque'), '');
  v_hotel_ids uuid[] := CASE WHEN p_filters ? 'hotel_ids'
    THEN (ARRAY(SELECT jsonb_array_elements_text(p_filters->'hotel_ids')))::uuid[]
    ELSE NULL END;
  v_tipo_transporte text := nullif(trim(p_filters->>'tipo_transporte'), '');
  v_rotas jsonb := COALESCE(p_filters->'rotas', '[]'::jsonb);
  v_rota jsonb;
  v_rota_key text;
  v_valores numeric[];
  v_result jsonb := '{}'::jsonb;
  v_passagens jsonb := '{}'::jsonb;
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  -- ── Hospedagem: diária dos hotéis da cidade da base de embarque ──
  SELECT array_agg(h.valor_diaria ORDER BY h.check_in)
  INTO v_valores
  FROM public.hospedagens h
  JOIN public.hoteis_fornecedores hf ON hf.id = h.hotel_id
  WHERE h.check_in >= v_periodo_inicio AND h.check_in <= v_periodo_fim
    AND (v_cidade_embarque IS NULL OR trim(hf.cidade) ILIKE v_cidade_embarque)
    AND (v_hotel_ids IS NULL OR h.hotel_id = ANY (v_hotel_ids));

  IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
    v_result := jsonb_set(v_result, '{hospedagem}', public._cost_sim_stats(v_valores));
  END IF;

  -- ── Transporte: viagens com origem/destino (ou extras) ligados à cidade de embarque ──
  -- "tipo de transporte" compara contra o nome limpo (sem o número no fim, ex. "Future 05" ->
  -- "Future") — aproximação de nomeTransporte() (transport.tsx), que cobre o caso dominante sem
  -- replicar toda a lógica de parseCarro() em plpgsql.
  SELECT array_agg(custo ORDER BY scheduled_at)
  INTO v_valores
  FROM (
    SELECT
      (COALESCE(t.custo, 0) + COALESCE(t.custo_2, 0) + COALESCE(t.custo_3, 0)) AS custo,
      t.scheduled_at
    FROM public.transport_trips t
    WHERE NOT t.cancelado
      AND t.scheduled_at::date >= v_periodo_inicio AND t.scheduled_at::date <= v_periodo_fim
      AND (t.custo IS NOT NULL OR t.custo_2 IS NOT NULL OR t.custo_3 IS NOT NULL)
      AND (
        v_cidade_embarque IS NULL
        OR t.origin ILIKE '%' || v_cidade_embarque || '%'
        OR t.destination ILIKE '%' || v_cidade_embarque || '%'
        OR EXISTS (SELECT 1 FROM unnest(t.origens_extras) x WHERE x ILIKE '%' || v_cidade_embarque || '%')
        OR EXISTS (SELECT 1 FROM unnest(t.destinos_extras) x WHERE x ILIKE '%' || v_cidade_embarque || '%')
      )
      AND (v_tipo_transporte IS NULL OR regexp_replace(t.car_number, '\s+\d{1,3}$', '') ILIKE v_tipo_transporte)
  ) sub;

  IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
    v_result := jsonb_set(v_result, '{transporte}', public._cost_sim_stats(v_valores));
  END IF;

  -- ── Passagens: por rota (cidade de origem <-> base de embarque), uma por linha de equipe
  -- com cidade de origem distinta ──
  FOR v_rota IN SELECT * FROM jsonb_array_elements(v_rotas)
  LOOP
    v_rota_key := trim(v_rota->>'origem') || '|' || trim(v_rota->>'destino');
    SELECT array_agg(p.valor ORDER BY p.data_ida)
    INTO v_valores
    FROM public.passagens_aereas p
    WHERE p.status = 'Confirmada'
      AND p.data_ida >= v_periodo_inicio AND p.data_ida <= v_periodo_fim
      AND (
        (trim(p.origem) ILIKE trim(v_rota->>'origem') AND trim(p.destino) ILIKE trim(v_rota->>'destino'))
        OR (trim(p.origem) ILIKE trim(v_rota->>'destino') AND trim(p.destino) ILIKE trim(v_rota->>'origem'))
      );

    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_passagens := jsonb_set(v_passagens, ARRAY[v_rota_key], public._cost_sim_stats(v_valores));
    END IF;
  END LOOP;

  IF v_passagens <> '{}'::jsonb THEN
    v_result := jsonb_set(v_result, '{passagens}', v_passagens);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.cost_simulator_unit_stats(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cost_simulator_unit_stats(jsonb) TO authenticated;
