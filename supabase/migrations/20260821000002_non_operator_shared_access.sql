-- Todo mundo que não é operador (Visitante, Solicitante e os 4 papéis de etapa de Nomeações)
-- tem acesso às mesmas 3 abas: Histograma Offshore (Dashboard + Histograma) e Nomeações
-- (board inteiro, todas as etapas). pm e visitante já tinham policy de leitura no Histograma
-- Offshore; faltava pros 4 papéis de etapa. nominations/histórico/nomeados já tinham policy
-- de leitura ampla pros papéis de etapa; faltava pro visitante.

-- Papéis de etapa (Aprovação Técnica/Qualidade/RH/SMS) — leitura no Histograma Offshore
-- (Dashboard + Histograma).
CREATE POLICY "stage_roles_hist_novo_colaboradores_select" ON public.hist_novo_colaboradores
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

CREATE POLICY "stage_roles_hist_novo_periodos_select" ON public.hist_novo_periodos
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

CREATE POLICY "stage_roles_timesheet_embarques_select" ON public.timesheet_embarques
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

CREATE POLICY "stage_roles_timesheet_semanas_select" ON public.timesheet_semanas
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'aprovacao_tecnica')
    OR public.has_role(auth.uid(), 'qualidade')
    OR public.has_role(auth.uid(), 'rh')
    OR public.has_role(auth.uid(), 'sms')
  );

-- Visitante — leitura do board de Nomeações inteiro (mesma amplitude que pm/papéis de etapa
-- já têm).
CREATE POLICY "visitante_board_nominations_select" ON public.nominations
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_board_history_select" ON public.nomination_status_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));

CREATE POLICY "visitante_board_nominees_select" ON public.nomination_nominees
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'visitante'));
