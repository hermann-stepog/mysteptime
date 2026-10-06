-- Busca aproximada no Simulador de Custos (pedido dela, 2026-10-06): o nome digitado não precisa
-- ser igual ao cadastrado. Vale quando um contém o outro, sem diferenciar maiúscula
-- (ex.: "ARM SBM Duque de Caxias" encontra "Duque de Caxias"). Aplica em hospedagem e transporte
-- por cidade e nos trajetos Uber/executivo.

CREATE OR REPLACE FUNCTION public._cost_sim_aprox(a text, b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(trim(a), '') IS NOT NULL
     AND nullif(trim(b), '') IS NOT NULL
     AND (trim(a) ILIKE '%' || trim(b) || '%' OR trim(b) ILIKE '%' || trim(a) || '%');
$$;

CREATE OR REPLACE FUNCTION public.cost_simulator_transport_trajetos(p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_periodo_inicio date := (p_filters->>'periodo_inicio')::date;
  v_periodo_fim date := (p_filters->>'periodo_fim')::date;
  v_tipo text := lower(COALESCE(nullif(trim(p_filters->>'tipo'), ''), 'uber'));
  v_trajetos jsonb := COALESCE(p_filters->'trajetos', '[]'::jsonb);
  v_result jsonb := '{}'::jsonb;
  v_t jsonb;
  v_key text;
  v_valores numeric[];
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  FOR v_t IN SELECT * FROM jsonb_array_elements(v_trajetos)
  LOOP
    v_key := trim(v_t->>'origem') || '|' || trim(v_t->>'destino');

    SELECT array_agg(sub.custo ORDER BY sub.scheduled_at)
    INTO v_valores
    FROM (
      SELECT (COALESCE(t.custo, 0) + COALESCE(t.custo_2, 0) + COALESCE(t.custo_3, 0)) AS custo,
             t.scheduled_at
      FROM public.transport_trips t
      WHERE NOT t.cancelado
        AND t.scheduled_at::date >= v_periodo_inicio
        AND t.scheduled_at::date <= v_periodo_fim
        AND (t.custo IS NOT NULL OR t.custo_2 IS NOT NULL OR t.custo_3 IS NOT NULL)
        AND trim(t.car_number) ILIKE v_tipo || '%'
        AND (
          (public._cost_sim_aprox(t.origin, v_t->>'origem') AND public._cost_sim_aprox(t.destination, v_t->>'destino'))
          OR (public._cost_sim_aprox(t.origin, v_t->>'destino') AND public._cost_sim_aprox(t.destination, v_t->>'origem'))
        )
    ) sub;

    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_result := jsonb_set(v_result, ARRAY[v_key], public._cost_sim_stats(v_valores));
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cost_simulator_local_stats(p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_periodo_inicio date := (p_filters->>'periodo_inicio')::date;
  v_periodo_fim date := (p_filters->>'periodo_fim')::date;
  v_cidades jsonb := COALESCE(p_filters->'cidades', '[]'::jsonb);
  v_cidade text;
  v_hospedagem jsonb := '{}'::jsonb;
  v_transporte jsonb := '{}'::jsonb;
  v_valores numeric[];
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  FOR v_cidade IN SELECT trim(x) FROM jsonb_array_elements_text(v_cidades) x WHERE trim(x) <> ''
  LOOP
    SELECT array_agg(h.valor_diaria ORDER BY h.check_in)
    INTO v_valores
    FROM public.hospedagens h
    JOIN public.hoteis_fornecedores hf ON hf.id = h.hotel_id
    WHERE h.check_in >= v_periodo_inicio
      AND h.check_in <= v_periodo_fim
      AND public._cost_sim_aprox(hf.cidade, v_cidade);
    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_hospedagem := jsonb_set(v_hospedagem, ARRAY[v_cidade], public._cost_sim_stats(v_valores));
    END IF;

    SELECT array_agg(sub.custo ORDER BY sub.scheduled_at)
    INTO v_valores
    FROM (
      SELECT (COALESCE(t.custo, 0) + COALESCE(t.custo_2, 0) + COALESCE(t.custo_3, 0)) AS custo,
             t.scheduled_at
      FROM public.transport_trips t
      WHERE NOT t.cancelado
        AND t.scheduled_at::date >= v_periodo_inicio
        AND t.scheduled_at::date <= v_periodo_fim
        AND (t.custo IS NOT NULL OR t.custo_2 IS NOT NULL OR t.custo_3 IS NOT NULL)
        AND (public._cost_sim_aprox(t.origin, v_cidade) OR public._cost_sim_aprox(t.destination, v_cidade))
    ) sub;
    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_transporte := jsonb_set(v_transporte, ARRAY[v_cidade], public._cost_sim_stats(v_valores));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('hospedagem', v_hospedagem, 'transporte', v_transporte);
END;
$$;

REVOKE ALL ON FUNCTION public.cost_simulator_local_stats(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cost_simulator_local_stats(jsonb) TO authenticated;
