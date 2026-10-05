-- Adiciona Alimentação ao Simulador de Custos Logísticos (pedido dela, 2026-10-02, depois de
-- ver um e-mail real de pedido de cotação pro ARM da SBM em Duque de Caxias: equipe + dias +
-- local fixo, com Acomodação/Alimentação/Transporte exclusivo/Lavanderia — não só o caso de
-- Embarque offshore com regime de rotação). Alimentação usa o histórico real de Reembolsos
-- (categoria 'Alimentação' em reembolso_itens) — a única fonte de custo de refeição que já
-- existe no sistema. Reembolsos não tem cidade/local associado, só BSP, então o valor é um
-- único agregado (não por cidade como hospedagem/transporte), opcionalmente filtrado por BSP
-- quando a simulação informar um.
CREATE OR REPLACE FUNCTION public.cost_simulator_unit_stats(p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_periodo_inicio date := (p_filters->>'periodo_inicio')::date;
  v_periodo_fim date := (p_filters->>'periodo_fim')::date;
  v_cidades text[] := CASE WHEN p_filters ? 'cidades'
    THEN (ARRAY(SELECT jsonb_array_elements_text(p_filters->'cidades')))::text[]
    ELSE ARRAY[]::text[] END;
  v_hotel_ids uuid[] := CASE WHEN p_filters ? 'hotel_ids'
    THEN (ARRAY(SELECT jsonb_array_elements_text(p_filters->'hotel_ids')))::uuid[]
    ELSE NULL END;
  v_tipo_transporte text := nullif(trim(p_filters->>'tipo_transporte'), '');
  v_bsp text := nullif(trim(p_filters->>'bsp'), '');
  v_rotas jsonb := COALESCE(p_filters->'rotas', '[]'::jsonb);
  v_cidade text;
  v_rota jsonb;
  v_rota_key text;
  v_valores numeric[];
  v_result jsonb := '{}'::jsonb;
  v_hospedagem jsonb := '{}'::jsonb;
  v_transporte jsonb := '{}'::jsonb;
  v_passagens jsonb := '{}'::jsonb;
BEGIN
  IF NOT (public.is_operator(auth.uid()) OR public.has_role(auth.uid(), 'orcamentos_projetos')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar custos.';
  END IF;

  FOREACH v_cidade IN ARRAY v_cidades
  LOOP
    -- ── Hospedagem: diária dos hotéis da cidade ──
    SELECT array_agg(h.valor_diaria ORDER BY h.check_in)
    INTO v_valores
    FROM public.hospedagens h
    JOIN public.hoteis_fornecedores hf ON hf.id = h.hotel_id
    WHERE h.check_in >= v_periodo_inicio AND h.check_in <= v_periodo_fim
      AND trim(hf.cidade) ILIKE trim(v_cidade)
      AND (v_hotel_ids IS NULL OR h.hotel_id = ANY (v_hotel_ids));

    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_hospedagem := jsonb_set(v_hospedagem, ARRAY[trim(v_cidade)], public._cost_sim_stats(v_valores));
    END IF;

    -- ── Transporte: viagens com origem/destino (ou extras) ligados à cidade ──
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
          t.origin ILIKE '%' || v_cidade || '%'
          OR t.destination ILIKE '%' || v_cidade || '%'
          OR EXISTS (SELECT 1 FROM unnest(t.origens_extras) x WHERE x ILIKE '%' || v_cidade || '%')
          OR EXISTS (SELECT 1 FROM unnest(t.destinos_extras) x WHERE x ILIKE '%' || v_cidade || '%')
        )
        AND (v_tipo_transporte IS NULL OR regexp_replace(t.car_number, '\s+\d{1,3}$', '') ILIKE v_tipo_transporte)
    ) sub;

    IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
      v_transporte := jsonb_set(v_transporte, ARRAY[trim(v_cidade)], public._cost_sim_stats(v_valores));
    END IF;
  END LOOP;

  IF v_hospedagem <> '{}'::jsonb THEN v_result := jsonb_set(v_result, '{hospedagem}', v_hospedagem); END IF;
  IF v_transporte <> '{}'::jsonb THEN v_result := jsonb_set(v_result, '{transporte}', v_transporte); END IF;

  -- ── Passagens: por rota (origem <-> destino) ──
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

  -- ── Alimentação: média/mediana/último dos itens de Reembolso dessa categoria, no período ──
  -- (sem cidade — reembolso não guarda local, só BSP; filtra por BSP quando informado).
  SELECT array_agg(ri.valor ORDER BY ri.data_despesa)
  INTO v_valores
  FROM public.reembolso_itens ri
  WHERE ri.categoria = 'Alimentação'
    AND ri.data_despesa >= v_periodo_inicio AND ri.data_despesa <= v_periodo_fim
    AND (v_bsp IS NULL OR ri.bsp ILIKE v_bsp);

  IF v_valores IS NOT NULL AND array_length(v_valores, 1) > 0 THEN
    v_result := jsonb_set(v_result, '{alimentacao}', public._cost_sim_stats(v_valores));
  END IF;

  RETURN v_result;
END;
$$;
