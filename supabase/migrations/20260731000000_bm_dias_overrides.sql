-- Correção pontual de um dia de timesheet só pra efeito de medição do BM — não altera
-- timesheet_dias (o físico real continua intacto); guarda o valor efetivamente medido e a
-- justificativa de por que a medição divergiu do timesheet.
CREATE TABLE public.bm_dias_overrides (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bm_id             UUID NOT NULL REFERENCES public.bms(id) ON DELETE CASCADE,
  colaborador_id    UUID NOT NULL,
  data              DATE NOT NULL,
  evento            TEXT,
  horas_extras      NUMERIC,
  adicional_noturno BOOLEAN NOT NULL DEFAULT false,
  total_horas       NUMERIC,
  observacao        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX bm_dias_overrides_bm_id_idx ON public.bm_dias_overrides(bm_id);

ALTER TABLE public.bm_dias_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_bm_dias_overrides_all" ON public.bm_dias_overrides
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
