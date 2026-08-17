-- RASCUNHO TÉCNICO EM VALIDAÇÃO — NÃO EXECUTAR NO LOVABLE/PRODUÇÃO.
-- Consolida os eventos do Access em um registro diário de HH.
-- Escreve SOMENTE no schema isolado legacy_access; não altera tabelas public.
CREATE OR REPLACE FUNCTION legacy_access.prepare_hh_stage(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = legacy_access, public, pg_temp
AS $$
DECLARE
  v_period_rows INTEGER;
  v_event_rows INTEGER;
  v_journey_rows INTEGER;
  v_ready INTEGER;
  v_logistics INTEGER;
  v_hh_review INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM legacy_access.runs WHERE run_id=p_run_id) THEN
    RAISE EXCEPTION 'Run % não encontrado', p_run_id;
  END IF;

  SELECT count(*) INTO v_period_rows
  FROM legacy_access.periodo_stage
  WHERE run_id=p_run_id AND review_status IN ('pending', 'approved') AND overlap_status='insert';
  SELECT count(*) INTO v_event_rows FROM legacy_access.evento_stage WHERE run_id=p_run_id;
  SELECT count(*) INTO v_journey_rows FROM legacy_access.jornada_stage WHERE run_id=p_run_id;

  IF v_period_rows=0 THEN RAISE EXCEPTION 'Run % não possui períodos candidatos', p_run_id; END IF;
  IF v_event_rows=0 THEN RAISE EXCEPTION 'Run % não possui eventos brutos para HH', p_run_id; END IF;
  IF v_journey_rows=0 THEN RAISE EXCEPTION 'Run % não possui catálogo de jornadas', p_run_id; END IF;

  DELETE FROM legacy_access.hh_dia_stage WHERE run_id=p_run_id;

  CREATE TEMP TABLE _hh_pool ON COMMIT DROP AS
  WITH expanded AS (
    SELECT
      COALESCE(p.colaborador_id::text, 'LEGACY:' || p.legacy_code) AS identity_key,
      p.colaborador_id,
      p.legacy_code,
      d::date AS data,
      p.source_key,
      p.source_kind,
      p.tipo,
      p.unidade_operacional,
      p.bsp,
      bool_or(p.source_kind='event') OVER (
        PARTITION BY COALESCE(p.colaborador_id::text, 'LEGACY:' || p.legacy_code), d::date
      ) AS has_event
    FROM legacy_access.periodo_stage p
    CROSS JOIN LATERAL generate_series(p.data_inicio, p.data_fim, interval '1 day') d
    WHERE p.run_id=p_run_id
      AND p.review_status IN ('pending', 'approved')
      AND p.overlap_status='insert'
      AND p.data_inicio IS NOT NULL
      AND p.data_fim IS NOT NULL
      AND p.data_fim >= p.data_inicio
  )
  SELECT *
  FROM expanded
  WHERE (has_event AND source_kind='event') OR (NOT has_event AND source_kind='allocation');

  CREATE INDEX ON _hh_pool(identity_key, data);
  CREATE INDEX ON _hh_pool(source_key);

  CREATE TEMP TABLE _hh_day_semantics ON COMMIT DROP AS
  SELECT
    identity_key,
    data,
    min(colaborador_id::text)::uuid AS colaborador_id,
    min(legacy_code) AS legacy_code,
    count(DISTINCT concat_ws('|',
      upper(coalesce(tipo, '')),
      upper(regexp_replace(trim(coalesce(unidade_operacional, '')), '\s+', ' ', 'g')),
      upper(regexp_replace(trim(coalesce(bsp, '')), '\s+', ' ', 'g'))
    )) AS semantic_count,
    (array_agg(tipo ORDER BY source_key))[1] AS tipo,
    (array_agg(unidade_operacional ORDER BY source_key))[1] AS unidade_operacional,
    (array_agg(bsp ORDER BY source_key))[1] AS bsp,
    array_agg(DISTINCT source_key ORDER BY source_key) AS period_source_keys,
    jsonb_agg(jsonb_build_object(
      'source_key', source_key,
      'source_kind', source_kind,
      'tipo', tipo,
      'unidade_operacional', unidade_operacional,
      'bsp', bsp
    ) ORDER BY source_key) AS semantic_options
  FROM _hh_pool
  GROUP BY identity_key, data;

  CREATE TEMP TABLE _hh_normal_distinct ON COMMIT DROP AS
  SELECT DISTINCT ON (p.identity_key, p.data, signature)
    p.identity_key,
    p.data,
    s.source_key,
    regexp_replace(coalesce(s.review_note, ''), '^Evento=', '') AS event_label,
    s.source_payload->>'Jornada' AS jornada,
    round(
      nullif(s.source_payload->>'Qtd_Horas', '')::numeric /
      NULLIF((s.data_fim - s.data_inicio + 1), 0),
      2
    ) AS horas_normais,
    left(j.inicio_jornada, 5) AS hora_entrada,
    left(j.termino_jornada, 5) AS hora_saida,
    coalesce(lower(j.turno)='noturno', false) AS adicional_noturno,
    s.source_payload->>'Projeto' AS projeto,
    signature
  FROM _hh_pool p
  JOIN legacy_access.periodo_stage s
    ON s.run_id=p_run_id AND s.source_key=p.source_key
  LEFT JOIN legacy_access.jornada_stage j
    ON j.run_id=p_run_id AND j.jornada_code=s.source_payload->>'Jornada'
  CROSS JOIN LATERAL (
    SELECT concat_ws('|',
      upper(regexp_replace(coalesce(s.review_note, ''), '^Evento=', '')),
      coalesce(s.source_payload->>'Jornada', ''),
      coalesce(round(
        nullif(s.source_payload->>'Qtd_Horas', '')::numeric /
        NULLIF((s.data_fim - s.data_inicio + 1), 0),
        2
      )::text, ''),
      coalesce(left(j.inicio_jornada, 5), ''),
      coalesce(left(j.termino_jornada, 5), ''),
      upper(trim(coalesce(s.source_payload->>'Projeto', '')))
    ) AS signature
  ) signature_value
  WHERE p.source_kind='event'
    AND s.data_inicio <= p.data AND s.data_fim >= p.data
  ORDER BY p.identity_key, p.data, signature, s.source_key;

  CREATE TEMP TABLE _hh_normal_stats ON COMMIT DROP AS
  SELECT
    identity_key,
    data,
    count(*) AS normal_option_count,
    (array_agg(event_label ORDER BY source_key))[1] AS event_label,
    (array_agg(horas_normais ORDER BY source_key))[1] AS horas_normais,
    (array_agg(hora_entrada ORDER BY source_key))[1] AS hora_entrada,
    (array_agg(hora_saida ORDER BY source_key))[1] AS hora_saida,
    bool_or(adicional_noturno) AS adicional_noturno,
    array_agg(source_key ORDER BY source_key) AS normal_source_keys,
    jsonb_agg(jsonb_build_object(
      'source_key', source_key,
      'evento', event_label,
      'jornada', jornada,
      'horas_normais', horas_normais,
      'hora_entrada', hora_entrada,
      'hora_saida', hora_saida,
      'projeto', projeto
    ) ORDER BY source_key) AS normal_options
  FROM _hh_normal_distinct
  GROUP BY identity_key, data;

  CREATE TEMP TABLE _hh_extra_distinct ON COMMIT DROP AS
  WITH expanded AS (
    SELECT
      COALESCE(m.resolved_collaborator_id::text, 'LEGACY:' || e.legacy_code) AS identity_key,
      d::date AS data,
      e.source_key,
      round(e.qtd_horas / NULLIF((e.data_fim - e.data_inicio + 1), 0), 2) AS horas_extras,
      substring(e.inicio_hora_extra from 'T([0-9]{2}:[0-9]{2})') AS hora_entrada_extra,
      substring(e.fim_hora_extra from 'T([0-9]{2}:[0-9]{2})') AS hora_saida_extra,
      e.jornada,
      e.projeto
    FROM legacy_access.evento_stage e
    LEFT JOIN legacy_access.colaborador_map m
      ON m.run_id=e.run_id AND m.legacy_code=e.legacy_code
    CROSS JOIN LATERAL generate_series(e.data_inicio, e.data_fim, interval '1 day') d
    WHERE e.run_id=p_run_id
      AND e.event_label IN ('Hora Extra', 'Hora Extra Quarentena Hotel')
      AND e.data_inicio IS NOT NULL AND e.data_fim IS NOT NULL AND e.data_fim >= e.data_inicio
  ), signed AS (
    SELECT *, concat_ws('|',
      coalesce(horas_extras::text, ''),
      coalesce(hora_entrada_extra, ''),
      coalesce(hora_saida_extra, ''),
      coalesce(jornada, ''),
      upper(trim(coalesce(projeto, '')))
    ) AS signature
    FROM expanded
  )
  SELECT DISTINCT ON (identity_key, data, signature)
    identity_key, data, source_key, horas_extras, hora_entrada_extra, hora_saida_extra,
    jornada, projeto, signature
  FROM signed
  ORDER BY identity_key, data, signature, source_key;

  CREATE TEMP TABLE _hh_extra_stats ON COMMIT DROP AS
  SELECT
    identity_key,
    data,
    count(*) FILTER (WHERE horas_extras IS NOT NULL) AS extra_option_count,
    round(sum(horas_extras), 2) AS horas_extras,
    CASE WHEN count(*) FILTER (WHERE horas_extras IS NOT NULL)=1
      THEN max(hora_entrada_extra) FILTER (WHERE horas_extras IS NOT NULL) END AS hora_entrada_extra,
    CASE WHEN count(*) FILTER (WHERE horas_extras IS NOT NULL)=1
      THEN max(hora_saida_extra) FILTER (WHERE horas_extras IS NOT NULL) END AS hora_saida_extra,
    array_agg(source_key ORDER BY source_key) AS extra_source_keys,
    jsonb_agg(jsonb_build_object(
      'source_key', source_key,
      'horas_extras', horas_extras,
      'hora_entrada_extra', hora_entrada_extra,
      'hora_saida_extra', hora_saida_extra,
      'jornada', jornada,
      'projeto', projeto
    ) ORDER BY source_key) AS extra_options
  FROM _hh_extra_distinct
  GROUP BY identity_key, data;

  INSERT INTO legacy_access.hh_dia_stage(
    run_id, identity_key, colaborador_id, legacy_code, data, tipo, evento,
    unidade_operacional, bsp, hora_entrada, hora_saida, horas_normais,
    hora_entrada_extra, hora_saida_extra, horas_extras, total_horas,
    adicional_noturno, source_hash, source_payload, review_status,
    blocking_reasons, review_note
  )
  SELECT
    p_run_id,
    d.identity_key,
    d.colaborador_id,
    d.legacy_code,
    d.data,
    CASE WHEN d.semantic_count=1 THEN d.tipo END,
    CASE WHEN d.semantic_count=1 THEN coalesce(n.event_label,
      CASE d.tipo
        WHEN 'E' THEN 'Embarque' WHEN 'DES' THEN 'Desembarque' WHEN 'DB' THEN 'Dobra'
        WHEN 'HTL' THEN 'Hotel Pré Embarque' WHEN 'CANC' THEN 'Embarque Cancelado'
        WHEN 'TE' THEN 'Trabalho Externo' ELSE d.tipo
      END)
    END,
    CASE WHEN d.semantic_count=1 THEN d.unidade_operacional END,
    CASE WHEN d.semantic_count=1 THEN d.bsp END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1 THEN n.hora_entrada END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1 THEN n.hora_saida END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1 THEN n.horas_normais END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1 THEN x.hora_entrada_extra END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1 THEN x.hora_saida_extra END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1 THEN x.horas_extras END,
    CASE
      WHEN d.semantic_count<>1 OR coalesce(n.normal_option_count, 0)>1 THEN NULL
      WHEN n.horas_normais IS NULL AND x.horas_extras IS NULL THEN NULL
      ELSE round(coalesce(n.horas_normais, 0) + coalesce(x.horas_extras, 0), 2)
    END,
    CASE WHEN d.semantic_count=1 AND coalesce(n.normal_option_count, 0) <= 1
      THEN coalesce(n.adicional_noturno, false) END,
    encode(digest(
      d.identity_key || '|' || d.data::text || '|' || d.period_source_keys::text ||
      '|' || coalesce(x.extra_source_keys::text, ''), 'sha256'
    ), 'hex'),
    jsonb_build_object(
      'period_source_keys', d.period_source_keys,
      'semantic_options', d.semantic_options,
      'normal_options', coalesce(n.normal_options, '[]'::jsonb),
      'extra_options', coalesce(x.extra_options, '[]'::jsonb)
    ),
    CASE
      WHEN d.semantic_count<>1 THEN 'pending_logistics'
      WHEN coalesce(n.normal_option_count, 0)>1 THEN 'pending_hh_conflict'
      ELSE 'technical_ready'
    END,
    CASE
      WHEN d.semantic_count<>1 THEN jsonb_build_array('semantic_conflict')
      WHEN coalesce(n.normal_option_count, 0)>1 THEN jsonb_build_array('hh_normal_conflict')
      ELSE '[]'::jsonb
    END,
    CASE
      WHEN d.semantic_count<>1 THEN 'Aguardando decisão da Logística.'
      WHEN coalesce(n.normal_option_count, 0)>1 THEN 'Mais de um valor de jornada/HH normal no mesmo dia.'
      WHEN n.horas_normais IS NULL AND x.horas_extras IS NULL THEN 'Dia operacional sem quantidade de HH no Access.'
      ELSE 'HH consolidado tecnicamente; falta comparar com o timesheet atual.'
    END
  FROM _hh_day_semantics d
  LEFT JOIN _hh_normal_stats n USING (identity_key, data)
  LEFT JOIN _hh_extra_stats x USING (identity_key, data);

  SELECT count(*) FILTER (WHERE review_status='technical_ready'),
         count(*) FILTER (WHERE review_status='pending_logistics'),
         count(*) FILTER (WHERE review_status='pending_hh_conflict')
    INTO v_ready, v_logistics, v_hh_review
  FROM legacy_access.hh_dia_stage
  WHERE run_id=p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'period_rows_used', v_period_rows,
    'raw_event_rows', v_event_rows,
    'journeys', v_journey_rows,
    'technical_ready_days', v_ready,
    'pending_logistics_days', v_logistics,
    'pending_hh_conflict_days', v_hh_review,
    'total_staged_days', v_ready + v_logistics + v_hh_review
  );
END;
$$;

REVOKE ALL ON FUNCTION legacy_access.prepare_hh_stage(UUID) FROM PUBLIC, anon, authenticated;

-- Depois de carregar e validar evento_stage + jornada_stage:
-- SELECT legacy_access.prepare_hh_stage('<RUN_ID>'::uuid);
