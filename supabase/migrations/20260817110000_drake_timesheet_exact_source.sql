-- Identidades estáveis dos registros vindos da Ficha Anual do Drake.
-- NULL continua permitido para períodos/timesheets manuais e importados de PDF.
ALTER TABLE public.hist_novo_periodos
  ADD COLUMN IF NOT EXISTS drake_event_key text;

-- Índice não parcial: o ON CONFLICT do PostgREST consegue inferi-lo. O PostgreSQL
-- continua permitindo várias linhas NULL para as demais origens.
CREATE UNIQUE INDEX IF NOT EXISTS hist_novo_periodos_drake_event_key_on_conflict_uidx
  ON public.hist_novo_periodos (drake_event_key);

ALTER TABLE public.timesheet_embarques
  ADD COLUMN IF NOT EXISTS source_event_key text;

CREATE UNIQUE INDEX IF NOT EXISTS timesheet_embarques_source_event_key_uidx
  ON public.timesheet_embarques (source_event_key)
  WHERE source_event_key IS NOT NULL;
