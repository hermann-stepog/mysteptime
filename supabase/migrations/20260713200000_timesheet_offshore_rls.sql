-- Garante RLS habilitado e políticas de operador nas tabelas do Timesheet Offshore,
-- que já existem no banco mas podem não ter policy configurada ainda.
ALTER TABLE public.timesheet_embarques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_semanas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_dias      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operators_timesheet_embarques_all" ON public.timesheet_embarques;
CREATE POLICY "operators_timesheet_embarques_all" ON public.timesheet_embarques
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "operators_timesheet_semanas_all" ON public.timesheet_semanas;
CREATE POLICY "operators_timesheet_semanas_all" ON public.timesheet_semanas
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

DROP POLICY IF EXISTS "operators_timesheet_dias_all" ON public.timesheet_dias;
CREATE POLICY "operators_timesheet_dias_all" ON public.timesheet_dias
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));
