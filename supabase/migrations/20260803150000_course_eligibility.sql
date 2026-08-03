-- Aptidao por cursos: snapshot normalizado das Necessidades Individuais do Drake.
-- As tabelas preservam os identificadores do Drake e nunca vinculam pessoas por nome.

CREATE TABLE public.drake_qualification_workers (
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

CREATE TABLE public.drake_qualification_contexts (
  context_key                     TEXT PRIMARY KEY,
  matrix_id                       TEXT NOT NULL,
  matrix_name                     TEXT NOT NULL,
  operational_unit_name           TEXT NOT NULL,
  job_name                        TEXT NOT NULL,
  sync_id                         UUID NOT NULL,
  synced_at                       TIMESTAMPTZ NOT NULL,
  UNIQUE (matrix_id, operational_unit_name, job_name)
);

CREATE TABLE public.drake_qualification_requirements (
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

CREATE TABLE public.drake_worker_qualifications (
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

CREATE TABLE public.drake_qualification_sync_state (
  singleton                       BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_success_at                 TIMESTAMPTZ NOT NULL,
  source_row_count                INTEGER NOT NULL,
  worker_count                    INTEGER NOT NULL,
  context_count                   INTEGER NOT NULL,
  requirement_count               INTEGER NOT NULL,
  qualification_count             INTEGER NOT NULL
);

CREATE INDEX drake_qualification_workers_job_idx
  ON public.drake_qualification_workers(job_name, worker_state);
CREATE INDEX drake_qualification_workers_registration_idx
  ON public.drake_qualification_workers(registration);
CREATE INDEX drake_qualification_contexts_filters_idx
  ON public.drake_qualification_contexts(operational_unit_name, job_name, matrix_name);
CREATE INDEX drake_qualification_requirements_context_idx
  ON public.drake_qualification_requirements(context_key);
CREATE INDEX drake_worker_qualifications_worker_idx
  ON public.drake_worker_qualifications(drake_worker_id);
CREATE INDEX drake_worker_qualifications_qualification_idx
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

CREATE POLICY "operators_drake_qualification_workers_all"
  ON public.drake_qualification_workers FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "operators_drake_qualification_contexts_all"
  ON public.drake_qualification_contexts FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "operators_drake_qualification_requirements_all"
  ON public.drake_qualification_requirements FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "operators_drake_worker_qualifications_all"
  ON public.drake_worker_qualifications FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE POLICY "operators_drake_qualification_sync_state_all"
  ON public.drake_qualification_sync_state FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
