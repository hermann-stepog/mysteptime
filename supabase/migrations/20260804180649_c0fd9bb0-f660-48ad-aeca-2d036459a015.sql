CREATE TABLE IF NOT EXISTS public.drake_qualification_workers (
  drake_worker_id                 TEXT PRIMARY KEY,
  registration                    TEXT NOT NULL,
  full_name                       TEXT NOT NULL,
  job_name                        TEXT,
  worker_type                     TEXT,
  worker_state                    TEXT,
  current_operational_unit_name   TEXT,
  sync_id                         UUID NOT NULL,
  synced_at                       TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.drake_qualification_contexts (
  context_key                     TEXT PRIMARY KEY,
  matrix_id                       TEXT NOT NULL,
  matrix_name                     TEXT NOT NULL,
  operational_unit_name           TEXT NOT NULL,
  job_name                        TEXT NOT NULL,
  sync_id                         UUID NOT NULL,
  synced_at                       TIMESTAMPTZ NOT NULL,
  UNIQUE (matrix_id, operational_unit_name, job_name)
);

CREATE TABLE IF NOT EXISTS public.drake_qualification_requirements (
  context_key                     TEXT NOT NULL
    REFERENCES public.drake_qualification_contexts(context_key) ON DELETE CASCADE,
  qualification_id                TEXT NOT NULL,
  qualification_name              TEXT NOT NULL,
  indicated_course_id             TEXT,
  indicated_course_name           TEXT,
  qualification_need_type_id      TEXT,
  qualification_need_type_name    TEXT NOT NULL,
  relationship_set_id             TEXT,
  relationship_set_name           TEXT,
  is_mandatory                     BOOLEAN NOT NULL,
  sync_id                          UUID NOT NULL,
  synced_at                        TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (context_key, qualification_id)
);

CREATE TABLE IF NOT EXISTS public.drake_worker_qualifications (
  drake_worker_id                 TEXT NOT NULL
    REFERENCES public.drake_qualification_workers(drake_worker_id) ON DELETE CASCADE,
  qualification_id                TEXT NOT NULL,
  qualification_name              TEXT NOT NULL,
  indicated_course_id             TEXT,
  indicated_course_name           TEXT,
  expiration_date                 DATE,
  sync_id                          UUID NOT NULL,
  synced_at                        TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (drake_worker_id, qualification_id)
);

CREATE TABLE IF NOT EXISTS public.drake_qualification_sync_state (
  singleton                       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_success_at                 TIMESTAMPTZ NOT NULL,
  source_row_count                INTEGER NOT NULL,
  worker_count                    INTEGER NOT NULL,
  context_count                   INTEGER NOT NULL,
  requirement_count               INTEGER NOT NULL,
  qualification_count             INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS drake_qualification_workers_job_idx
  ON public.drake_qualification_workers(job_name, worker_state);
CREATE INDEX IF NOT EXISTS drake_qualification_workers_registration_idx
  ON public.drake_qualification_workers(registration);
CREATE INDEX IF NOT EXISTS drake_qualification_contexts_filters_idx
  ON public.drake_qualification_contexts(operational_unit_name, job_name, matrix_name);
CREATE INDEX IF NOT EXISTS drake_qualification_requirements_context_idx
  ON public.drake_qualification_requirements(context_key);
CREATE INDEX IF NOT EXISTS drake_worker_qualifications_worker_idx
  ON public.drake_worker_qualifications(drake_worker_id);
CREATE INDEX IF NOT EXISTS drake_worker_qualifications_qualification_idx
  ON public.drake_worker_qualifications(qualification_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.drake_qualification_workers,
  public.drake_qualification_contexts,
  public.drake_qualification_requirements,
  public.drake_worker_qualifications,
  public.drake_qualification_sync_state
TO authenticated;

GRANT ALL ON
  public.drake_qualification_workers,
  public.drake_qualification_contexts,
  public.drake_qualification_requirements,
  public.drake_worker_qualifications,
  public.drake_qualification_sync_state
TO service_role;

ALTER TABLE public.drake_qualification_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drake_qualification_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drake_qualification_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drake_worker_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drake_qualification_sync_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_qualification_workers'
      AND policyname = 'operators_drake_qualification_workers_all'
  ) THEN
    EXECUTE 'CREATE POLICY "operators_drake_qualification_workers_all"
      ON public.drake_qualification_workers FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_qualification_contexts'
      AND policyname = 'operators_drake_qualification_contexts_all'
  ) THEN
    EXECUTE 'CREATE POLICY "operators_drake_qualification_contexts_all"
      ON public.drake_qualification_contexts FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_qualification_requirements'
      AND policyname = 'operators_drake_qualification_requirements_all'
  ) THEN
    EXECUTE 'CREATE POLICY "operators_drake_qualification_requirements_all"
      ON public.drake_qualification_requirements FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_worker_qualifications'
      AND policyname = 'operators_drake_worker_qualifications_all'
  ) THEN
    EXECUTE 'CREATE POLICY "operators_drake_worker_qualifications_all"
      ON public.drake_worker_qualifications FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_qualification_sync_state'
      AND policyname = 'operators_drake_qualification_sync_state_all'
  ) THEN
    EXECUTE 'CREATE POLICY "operators_drake_qualification_sync_state_all"
      ON public.drake_qualification_sync_state FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()))';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.drake_qualification_options (
  domain_identifier TEXT NOT NULL,
  option_id          TEXT NOT NULL,
  option_name        TEXT NOT NULL,
  sort_order         INTEGER NOT NULL,
  sync_id            UUID NOT NULL,
  synced_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (domain_identifier, option_id)
);

CREATE INDEX IF NOT EXISTS drake_qualification_options_lookup_idx
  ON public.drake_qualification_options(domain_identifier, sort_order, option_name);

ALTER TABLE public.drake_qualification_sync_state
  ADD COLUMN IF NOT EXISTS option_count INTEGER NOT NULL DEFAULT 0;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.drake_qualification_options
  TO authenticated;

GRANT ALL
  ON public.drake_qualification_options
  TO service_role;

ALTER TABLE public.drake_qualification_options ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'drake_qualification_options'
      AND policyname = 'operators_drake_qualification_options_all'
  ) THEN
    EXECUTE 'CREATE POLICY "operators_drake_qualification_options_all"
      ON public.drake_qualification_options FOR ALL TO authenticated
      USING (public.is_operator(auth.uid()))
      WITH CHECK (public.is_operator(auth.uid()))';
  END IF;
END
$$;