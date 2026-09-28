-- RLS de "Diretoria" — espelha exatamente o que "Visitante" já tem (mesmas 10 policies), só
-- que checando o papel 'diretoria' em vez de 'visitante'.

CREATE POLICY "diretoria_hist_novo_colaboradores_select" ON public.hist_novo_colaboradores
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_hist_novo_periodos_select" ON public.hist_novo_periodos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_timesheet_embarques_select" ON public.timesheet_embarques
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_timesheet_semanas_select" ON public.timesheet_semanas
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_timesheet_dias_select" ON public.timesheet_dias
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_solicitations_select_all" ON public.transport_solicitations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_solicitations_insert" ON public.transport_solicitations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'diretoria') AND user_id = auth.uid());

CREATE POLICY "diretoria_board_nominations_select" ON public.nominations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_board_history_select" ON public.nomination_status_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));

CREATE POLICY "diretoria_board_nominees_select" ON public.nomination_nominees
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'diretoria'));
