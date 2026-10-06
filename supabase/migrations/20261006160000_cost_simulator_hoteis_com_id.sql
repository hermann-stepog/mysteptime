-- Hotéis da região com id (pedido dela, 2026-10-06): a lista de acomodação mostra os hotéis
-- da cidade e o escolhido filtra a diária usada no cálculo. cost_simulator_local_stats passa a
-- aceitar hotel_ids (mesmo filtro da cost_simulator_unit_stats).

CREATE OR REPLACE FUNCTION public.cost_simulator_hoteis_regiao(p_cidade text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', h.id, 'nome', h.nome, 'cidade', h.cidade) ORDER BY h.nome)
    FROM (
      SELECT hf.id, trim(hf.nome) AS nome, trim(hf.cidade) AS cidade
      FROM public.hoteis_fornecedores hf
      WHERE public._cost_sim_aprox(hf.cidade, p_cidade)
        AND nullif(trim(hf.nome), '') IS NOT NULL
    ) h
  ), '[]'::jsonb);
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
  v_hotel_ids uuid[] := CASE WHEN p_filters ? 'hotel_ids'
    THEN (ARRAY(SELECT jsonb_array_elements_text(p_filters->'hotel_ids')))::uuid[]
    ELSE NULL END;
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
      AND (v_hotel_ids IS NULL OR h.hotel_id = ANY (v_hotel_ids))
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
