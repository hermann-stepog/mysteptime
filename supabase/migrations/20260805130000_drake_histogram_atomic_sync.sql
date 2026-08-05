-- Sincronização atômica e idempotente dos relatórios 1 e 14 do Drake.
-- Não remove tabelas nem dados manuais. Registros obsoletos são removidos somente da
-- própria origem Drake e somente dentro da janela completa do relatório recebido.

ALTER TABLE public.hist_novo_colaboradores
  ADD COLUMN IF NOT EXISTS drake_worker_key text;

ALTER TABLE public.hist_novo_periodos
  ADD COLUMN IF NOT EXISTS drake_event_key text,
  ADD COLUMN IF NOT EXISTS drake_sync_token uuid,
  ADD COLUMN IF NOT EXISTS drake_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_event_name text;

ALTER TABLE public.timesheet_embarques
  ADD COLUMN IF NOT EXISTS source_event_key text;

-- Matrícula sozinha não identifica uma pessoa no Drake: há matrículas iguais em empresas
-- diferentes. A constraint antiga precisa ser substituída sem apagar nenhuma linha.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.hist_novo_colaboradores
    GROUP BY
      upper(btrim(matricula)),
      upper(btrim(COALESCE(empresa, '')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Existem colaboradores duplicados para a mesma empresa e matrícula. A migration foi cancelada sem alterar esses dados.';
  END IF;
END
$$;

ALTER TABLE public.hist_novo_colaboradores
  DROP CONSTRAINT IF EXISTS hist_novo_colaboradores_matricula_key;

CREATE UNIQUE INDEX IF NOT EXISTS hist_novo_colaboradores_empresa_matricula_uidx
  ON public.hist_novo_colaboradores (
    upper(btrim(matricula)),
    upper(btrim(COALESCE(empresa, '')))
  );

CREATE UNIQUE INDEX IF NOT EXISTS hist_novo_colaboradores_drake_worker_key_uidx
  ON public.hist_novo_colaboradores (drake_worker_key)
  WHERE drake_worker_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hist_novo_periodos_drake_event_key_uidx
  ON public.hist_novo_periodos (drake_event_key)
  WHERE drake_event_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS timesheet_embarques_source_event_key_uidx
  ON public.timesheet_embarques (source_event_key)
  WHERE source_event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.drake_histogram_sync_lease (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner text,
  acquired_at timestamptz,
  expires_at timestamptz
);

INSERT INTO public.drake_histogram_sync_lease (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.drake_histogram_sync_lease ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_histogram_sync_lease'
      AND policyname = 'operators_drake_histogram_sync_lease_all'
  ) THEN
    CREATE POLICY "operators_drake_histogram_sync_lease_all"
      ON public.drake_histogram_sync_lease
      FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()));
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.try_acquire_drake_histogram_sync(
  p_owner text,
  p_ttl_seconds integer DEFAULT 3600
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_acquired boolean := false;
BEGIN
  IF NULLIF(btrim(p_owner), '') IS NULL THEN
    RAISE EXCEPTION 'O identificador da sincronização Drake é obrigatório.';
  END IF;
  IF p_ttl_seconds < 60 OR p_ttl_seconds > 7200 THEN
    RAISE EXCEPTION 'Tempo de proteção inválido para a sincronização Drake.';
  END IF;

  UPDATE public.drake_histogram_sync_lease
  SET owner = p_owner,
      acquired_at = clock_timestamp(),
      expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
  WHERE singleton = true
    AND (
      owner IS NULL
      OR expires_at IS NULL
      OR expires_at <= clock_timestamp()
      OR owner = p_owner
    )
  RETURNING true INTO v_acquired;

  RETURN COALESCE(v_acquired, false);
END
$$;

CREATE OR REPLACE FUNCTION public.release_drake_histogram_sync(p_owner text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released boolean := false;
BEGIN
  UPDATE public.drake_histogram_sync_lease
  SET owner = NULL,
      acquired_at = NULL,
      expires_at = NULL
  WHERE singleton = true
    AND owner = p_owner
  RETURNING true INTO v_released;

  RETURN COALESCE(v_released, false);
END
$$;

CREATE OR REPLACE FUNCTION public.sync_drake_histogram_snapshot(
  p_source text,
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
  v_sync_token uuid := gen_random_uuid();
  v_worker_count integer;
  v_period_count integer;
  v_existing_workers integer;
  v_existing_periods integer;
  v_synchronized_periods integer;
  v_removed_stale integer := 0;
  v_periods jsonb;
BEGIN
  IF p_source NOT IN ('drake', 'disponibilidade') THEN
    RAISE EXCEPTION 'Origem inválida para sincronização Drake: %', p_source;
  END IF;
  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start > p_window_end THEN
    RAISE EXCEPTION 'Janela inválida para sincronização Drake.';
  END IF;
  IF jsonb_typeof(p_workers) <> 'array' OR jsonb_typeof(p_periods) <> 'array' THEN
    RAISE EXCEPTION 'Snapshot inválido para sincronização Drake.';
  END IF;

  v_worker_count := jsonb_array_length(p_workers);
  v_period_count := jsonb_array_length(p_periods);
  IF v_worker_count = 0 OR v_period_count = 0 THEN
    RAISE EXCEPTION 'Snapshot vazio; o banco não foi alterado.';
  END IF;

  -- O lock transacional impede duas réplicas do Lovable de reconciliarem a mesma origem ao
  -- mesmo tempo, mesmo que o lock em memória de cada processo não enxergue a outra réplica.
  PERFORM pg_advisory_xact_lock(hashtextextended('mysteptime:drake:histogram:' || p_source, 0));

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_workers) AS input(
      worker_key text,
      matricula text,
      nome text,
      empresa text
    )
    WHERE NULLIF(btrim(input.worker_key), '') IS NULL
       OR NULLIF(btrim(input.matricula), '') IS NULL
       OR NULLIF(btrim(input.nome), '') IS NULL
       OR NULLIF(btrim(input.empresa), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Snapshot contém trabalhador sem identidade completa.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_workers) AS input(worker_key text)
    GROUP BY input.worker_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Snapshot contém chaves de trabalhador duplicadas.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_periods) AS input(event_key text)
    GROUP BY input.event_key
    HAVING input.event_key IS NULL OR count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Snapshot contém chaves de evento ausentes ou duplicadas.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_periods) AS input(
      worker_key text,
      data_inicio date,
      data_fim date
    )
    WHERE input.worker_key IS NULL
       OR input.data_inicio IS NULL
       OR input.data_fim IS NULL
       OR input.data_inicio > input.data_fim
       OR input.data_fim < p_window_start
       OR input.data_inicio > p_window_end
  ) THEN
    RAISE EXCEPTION 'Snapshot contém evento inválido ou fora da janela solicitada.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_periods) AS period_input(worker_key text)
    LEFT JOIN jsonb_to_recordset(p_workers) AS worker_input(worker_key text)
      ON worker_input.worker_key = period_input.worker_key
    WHERE worker_input.worker_key IS NULL
  ) THEN
    RAISE EXCEPTION 'Snapshot contém evento sem trabalhador correspondente.';
  END IF;

  SELECT count(*)
  INTO v_existing_workers
  FROM jsonb_to_recordset(p_workers) AS input(
    worker_key text,
    matricula text,
    empresa text
  )
  JOIN public.hist_novo_colaboradores worker
    ON worker.drake_worker_key = input.worker_key
    OR (
      worker.drake_worker_key IS NULL
      AND upper(btrim(worker.matricula)) = upper(btrim(input.matricula))
      AND upper(btrim(COALESCE(worker.empresa, ''))) = upper(btrim(COALESCE(input.empresa, '')))
    );

  -- Vincula uma linha legada somente quando empresa + matrícula coincidem exatamente. Nunca
  -- usa matrícula isolada e, portanto, não troca dados entre empresas diferentes.
  UPDATE public.hist_novo_colaboradores worker
  SET drake_worker_key = input.worker_key,
      nome = input.nome,
      empresa = input.empresa,
      funcao = COALESCE(input.funcao, worker.funcao),
      funcao_operacao = COALESCE(input.funcao_operacao, worker.funcao_operacao)
  FROM jsonb_to_recordset(p_workers) AS input(
    worker_key text,
    matricula text,
    nome text,
    empresa text,
    funcao text,
    funcao_operacao text
  )
  WHERE worker.drake_worker_key IS NULL
    AND upper(btrim(worker.matricula)) = upper(btrim(input.matricula))
    AND upper(btrim(COALESCE(worker.empresa, ''))) = upper(btrim(COALESCE(input.empresa, '')));

  INSERT INTO public.hist_novo_colaboradores (
    drake_worker_key,
    matricula,
    nome,
    empresa,
    funcao,
    funcao_operacao
  )
  SELECT
    input.worker_key,
    input.matricula,
    input.nome,
    input.empresa,
    input.funcao,
    input.funcao_operacao
  FROM jsonb_to_recordset(p_workers) AS input(
    worker_key text,
    matricula text,
    nome text,
    empresa text,
    funcao text,
    funcao_operacao text
  )
  ON CONFLICT (drake_worker_key) WHERE drake_worker_key IS NOT NULL
  DO UPDATE SET
    matricula = EXCLUDED.matricula,
    nome = EXCLUDED.nome,
    empresa = EXCLUDED.empresa,
    funcao = COALESCE(EXCLUDED.funcao, hist_novo_colaboradores.funcao),
    funcao_operacao = COALESCE(
      EXCLUDED.funcao_operacao,
      hist_novo_colaboradores.funcao_operacao
    );

  SELECT count(DISTINCT concat_ws(
    chr(31),
    period.colaborador_id::text,
    COALESCE(period.unidade_operacional, ''),
    COALESCE(period.centro_de_custo, ''),
    period.tipo,
    period.data_inicio::text,
    period.data_fim::text,
    COALESCE(period.source_event_name, '')
  ))
  INTO v_existing_periods
  FROM public.hist_novo_periodos period
  WHERE period.origem = p_source
    AND period.data_fim >= p_window_start
    AND period.data_inicio <= p_window_end;

  -- Um arquivo abruptamente muito menor costuma indicar exportação parcial. Nesse caso é
  -- mais seguro manter o último snapshot íntegro e interromper antes de remover qualquer linha.
  IF v_existing_periods >= 100 AND v_period_count * 2 < v_existing_periods THEN
    RAISE EXCEPTION
      'O snapshot recebido caiu de % para % eventos; o banco não foi alterado.',
      v_existing_periods,
      v_period_count;
  END IF;

  INSERT INTO public.hist_novo_periodos (
    colaborador_id,
    unidade_operacional,
    centro_de_custo,
    tipo,
    data_inicio,
    data_fim,
    dias,
    origem,
    drake_event_key,
    drake_sync_token,
    drake_synced_at,
    source_event_name
  )
  SELECT
    worker.id,
    input.unidade_operacional,
    input.centro_de_custo,
    input.tipo,
    input.data_inicio,
    input.data_fim,
    input.dias,
    p_source,
    input.event_key,
    v_sync_token,
    clock_timestamp(),
    input.source_event_name
  FROM jsonb_to_recordset(p_periods) AS input(
    event_key text,
    worker_key text,
    unidade_operacional text,
    centro_de_custo text,
    tipo text,
    data_inicio date,
    data_fim date,
    dias integer,
    source_event_name text
  )
  JOIN public.hist_novo_colaboradores worker
    ON worker.drake_worker_key = input.worker_key
  ON CONFLICT (drake_event_key) WHERE drake_event_key IS NOT NULL
  DO UPDATE SET
    colaborador_id = EXCLUDED.colaborador_id,
    unidade_operacional = EXCLUDED.unidade_operacional,
    centro_de_custo = EXCLUDED.centro_de_custo,
    tipo = EXCLUDED.tipo,
    data_inicio = EXCLUDED.data_inicio,
    data_fim = EXCLUDED.data_fim,
    dias = EXCLUDED.dias,
    origem = EXCLUDED.origem,
    drake_sync_token = EXCLUDED.drake_sync_token,
    drake_synced_at = EXCLUDED.drake_synced_at,
    source_event_name = EXCLUDED.source_event_name;

  SELECT count(*)
  INTO v_synchronized_periods
  FROM public.hist_novo_periodos period
  WHERE period.origem = p_source
    AND period.drake_sync_token = v_sync_token;

  IF v_synchronized_periods <> v_period_count THEN
    RAISE EXCEPTION
      'O banco confirmou % de % eventos; a sincronização inteira foi cancelada.',
      v_synchronized_periods,
      v_period_count;
  END IF;

  -- O período permanece com o mesmo id quando o Drake corrige seus campos. Só referências de
  -- eventos que realmente sumiram do snapshot são desvinculadas; o timesheet do usuário não é
  -- apagado nem reescrito.
  UPDATE public.timesheet_embarques timesheet
  SET periodo_id = NULL
  WHERE timesheet.periodo_id IN (
    SELECT period.id
    FROM public.hist_novo_periodos period
    WHERE period.origem = p_source
      AND period.data_fim >= p_window_start
      AND period.data_inicio <= p_window_end
      AND period.drake_sync_token IS DISTINCT FROM v_sync_token
  );

  DELETE FROM public.hist_novo_periodos period
  WHERE period.origem = p_source
    AND period.data_fim >= p_window_start
    AND period.data_inicio <= p_window_end
    AND period.drake_sync_token IS DISTINCT FROM v_sync_token;
  GET DIAGNOSTICS v_removed_stale = ROW_COUNT;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('event_key', period.drake_event_key, 'id', period.id)
      ORDER BY period.drake_event_key
    ),
    '[]'::jsonb
  )
  INTO v_periods
  FROM public.hist_novo_periodos period
  WHERE period.origem = p_source
    AND period.drake_sync_token = v_sync_token;

  RETURN jsonb_build_object(
    'created_workers', GREATEST(v_worker_count - v_existing_workers, 0),
    'updated_workers', LEAST(v_worker_count, v_existing_workers),
    'synchronized_events', v_period_count,
    'removed_stale_events', v_removed_stale,
    'periods', v_periods
  );
END
$$;

REVOKE ALL ON FUNCTION public.try_acquire_drake_histogram_sync(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_drake_histogram_sync(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_drake_histogram_snapshot(text, date, date, jsonb, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.try_acquire_drake_histogram_sync(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_drake_histogram_sync(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_drake_histogram_snapshot(text, date, date, jsonb, jsonb) TO authenticated;
