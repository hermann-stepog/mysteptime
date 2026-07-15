-- Acesso do papel "Visitante" — só leitura no Histograma Offshore Novo (Dashboard) e no
-- Timesheet Offshore; em Transporte pode ver todas as solicitações e criar as próprias
-- (igual quem já usa essa aba hoje), mas não pode alterar status (Programar/Cancelar
-- fica restrito a operador — não criamos policy de UPDATE aqui de propósito).

CREATE POLICY "visitante_hist_novo_colaboradores_select" ON public.hist_novo_colaboradores
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_hist_novo_periodos_select" ON public.hist_novo_periodos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_timesheet_embarques_select" ON public.timesheet_embarques
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_timesheet_semanas_select" ON public.timesheet_semanas
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_timesheet_dias_select" ON public.timesheet_dias
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_solicitations_select_all" ON public.transport_solicitations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_solicitations_insert" ON public.transport_solicitations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'visitante') AND user_id = auth.uid());
