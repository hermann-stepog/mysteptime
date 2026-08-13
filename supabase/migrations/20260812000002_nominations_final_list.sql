-- Cartão "Equipe Formada" vira uma lista acumulativa de solicitações já processadas (concluídas
-- pelo fluxo normal ou canceladas a qualquer momento), numeradas sequencialmente (nunca reinicia)
-- na ordem em que chegam nesse estado terminal — não mais um kanban comum de cards soltos.
CREATE SEQUENCE IF NOT EXISTS public.nominations_sequence_seq START 1;

ALTER TABLE public.nominations
  ADD COLUMN IF NOT EXISTS sequence_number INTEGER,
  ADD COLUMN IF NOT EXISTS outcome        TEXT CHECK (outcome IN ('concluida', 'cancelada')),
  ADD COLUMN IF NOT EXISTS cancel_reason  TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS nominations_sequence_number_key
  ON public.nominations(sequence_number) WHERE sequence_number IS NOT NULL;

-- Atribui o número sequencial automaticamente na primeira vez que a solicitação chega em
-- "equipe_formada" (seja pelo fluxo normal — outcome='concluida' — seja por cancelamento a
-- qualquer momento — outcome='cancelada') — fica no trigger, não no app, pra não correr risco
-- de dois operadores cancelando/concluindo ao mesmo tempo pegarem o mesmo número.
CREATE OR REPLACE FUNCTION public.assign_nomination_sequence()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_status = 'equipe_formada' AND NEW.sequence_number IS NULL THEN
    NEW.sequence_number := nextval('public.nominations_sequence_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nominations_assign_sequence ON public.nominations;
CREATE TRIGGER nominations_assign_sequence
  BEFORE UPDATE ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.assign_nomination_sequence();
