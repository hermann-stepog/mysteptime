-- Catálogo dos dropdowns da Matriz de Qualificação.
-- Os requisitos são consultados sob demanda na API do Drake para a combinação
-- cliente/unidade + vaga + tipo de atuação selecionada na tela.

-- Migração idempotente e somente aditiva: não remove tabelas nem dados.

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
