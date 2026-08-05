-- Troca atômica dos dois relatórios legados pela ficha anual de posição do Drake.
-- A função existente faz toda a validação/upsert do novo snapshot. Somente depois disso,
-- ainda na mesma transação, os períodos automáticos antigos de disponibilidade são retirados.
-- Nenhum período manual, colaborador ou dado de timesheet é apagado.

CREATE OR REPLACE FUNCTION public.sync_drake_annual_position_snapshot(
  p_window_start date,
  p_window_end date,
  p_workers jsonb,
  p_periods jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_removed_availability integer := 0;
  v_timesheet_links jsonb := '[]'::jsonb;
BEGIN
  -- Guarda os vínculos dos embarques legados em memória transacional. Depois do novo snapshot,
  -- eles serão apontados para o período equivalente, sem criar uma segunda linha de timesheet.
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'timesheet_id', timesheet.id,
      'worker_key', worker.drake_worker_key,
      'data_inicio', period.data_inicio,
      'data_fim', period.data_fim,
      'unidade_operacional', period.unidade_operacional,
      'centro_de_custo', period.centro_de_custo
    )),
    '[]'::jsonb
  )
  INTO v_timesheet_links
  FROM public.timesheet_embarques timesheet
  JOIN public.hist_novo_periodos period ON period.id = timesheet.periodo_id
  JOIN public.hist_novo_colaboradores worker ON worker.id = period.colaborador_id
  WHERE period.origem = 'drake'
    AND period.tipo = 'E'
    AND period.data_fim >= p_window_start
    AND period.data_inicio <= p_window_end;

  -- sync_drake_histogram_snapshot usa origem='drake'. Como a chamada ocorre dentro desta
  -- função, qualquer falha posterior também desfaz integralmente os upserts realizados aqui.
  v_result := public.sync_drake_histogram_snapshot(
    'drake',
    p_window_start,
    p_window_end,
    p_workers,
    p_periods
  );

  UPDATE public.timesheet_embarques timesheet
  SET periodo_id = period.id,
      source_event_key = period.drake_event_key
  FROM jsonb_to_recordset(v_timesheet_links) AS link(
    timesheet_id uuid,
    worker_key text,
    data_inicio date,
    data_fim date,
    unidade_operacional text,
    centro_de_custo text
  )
  JOIN public.hist_novo_colaboradores worker
    ON worker.drake_worker_key = link.worker_key
  JOIN public.hist_novo_periodos period
    ON period.colaborador_id = worker.id
   AND period.origem = 'drake'
   AND period.tipo = 'E'
   AND period.data_inicio = link.data_inicio
   AND period.data_fim = link.data_fim
   AND COALESCE(period.unidade_operacional, '') = COALESCE(link.unidade_operacional, '')
   AND COALESCE(period.centro_de_custo, '') = COALESCE(link.centro_de_custo, '')
  WHERE timesheet.id = link.timesheet_id;

  -- Preserva o timesheet do usuário: apenas desfaz a referência ao período automático legado
  -- antes de removê-lo. O registro do timesheet não é removido nem reescrito.
  UPDATE public.timesheet_embarques timesheet
  SET periodo_id = NULL
  WHERE timesheet.periodo_id IN (
    SELECT period.id
    FROM public.hist_novo_periodos period
    WHERE period.origem = 'disponibilidade'
      AND period.data_fim >= p_window_start
      AND period.data_inicio <= p_window_end
  );

  DELETE FROM public.hist_novo_periodos period
  WHERE period.origem = 'disponibilidade'
    AND period.data_fim >= p_window_start
    AND period.data_inicio <= p_window_end;
  GET DIAGNOSTICS v_removed_availability = ROW_COUNT;

  RETURN jsonb_set(
    v_result,
    '{removed_stale_events}',
    to_jsonb(COALESCE((v_result ->> 'removed_stale_events')::integer, 0) + v_removed_availability),
    true
  );
END
$$;

REVOKE ALL ON FUNCTION public.sync_drake_annual_position_snapshot(date, date, jsonb, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_drake_annual_position_snapshot(date, date, jsonb, jsonb)
  TO authenticated;
