-- Acesso do papel "Solicitante" (pm) às abas Dashboard e Histograma do Histograma Offshore
-- (não à aba Lançamentos, restrita a operador — ver histograma-novo.tsx). hist_novo_periodos
-- e hist_novo_colaboradores já tinham policy de leitura pra pm (20260812000004); faltava
-- timesheet_embarques/timesheet_semanas, usadas só pela aba Histograma.
CREATE POLICY "pm_timesheet_embarques_select" ON public.timesheet_embarques
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));

CREATE POLICY "pm_timesheet_semanas_select" ON public.timesheet_semanas
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));
