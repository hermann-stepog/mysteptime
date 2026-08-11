-- Unifica no quadro de logs as atualizacoes do Drake e as importacoes da planilha da base.
ALTER TABLE public.drake_sync_runs
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'drake'
    CHECK (source_type IN ('drake', 'base')),
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS base_inserted INTEGER,
  ADD COLUMN IF NOT EXISTS base_ignored INTEGER,
  ADD COLUMN IF NOT EXISTS base_not_found INTEGER;

CREATE INDEX IF NOT EXISTS drake_sync_runs_source_finished_idx
  ON public.drake_sync_runs(source_type, finished_at DESC);
