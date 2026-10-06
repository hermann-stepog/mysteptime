-- Trajetos de transporte no Simulador de Custos, agora por tipo de carro: 'uber' (Uber) ou
-- 'future' (transporte executivo). Mesma regra de custo por viagem da versão anterior; sem
-- tipo informado continua sendo Uber.
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
          (trim(t.origin) ILIKE trim(v_t->>'origem') AND trim(t.destination) ILIKE trim(v_t->>'destino'))
          OR (trim(t.origin) ILIKE trim(v_t->>'destino') AND trim(t.destination) ILIKE trim(v_t->>'origem'))
        )
    ) sub;

    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_result := jsonb_set(v_result, ARRAY[v_key], public._cost_sim_stats(v_valores));
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.cost_simulator_transport_trajetos(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cost_simulator_transport_trajetos(jsonb) TO authenticated;
