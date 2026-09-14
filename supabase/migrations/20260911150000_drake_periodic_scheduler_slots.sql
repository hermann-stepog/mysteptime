-- Reserva persistente das janelas do scheduler Drake. A chave única impede que
-- duas instâncias do Lovable executem a mesma atualização periódica.
CREATE TABLE public.drake_scheduler_slots (
  slot_key TEXT PRIMARY KEY,
  scheduled_for TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  error_message TEXT
);

CREATE INDEX drake_scheduler_slots_scheduled_for_idx
  ON public.drake_scheduler_slots(scheduled_for DESC);

ALTER TABLE public.drake_scheduler_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_drake_scheduler_slots_all"
  ON public.drake_scheduler_slots
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
