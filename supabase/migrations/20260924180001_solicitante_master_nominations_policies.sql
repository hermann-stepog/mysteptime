-- Solicitante Master (Paulo Nunes): enxerga o quadro inteiro de Nomeações (todas as etapas, só
-- leitura fora da própria), igual Aprovação Técnica/Qualidade/RH/SMS já têm (ver
-- stage_roles_nominations_select em 20260812000001), mas só grava (adicionar/remover nomeado,
-- avançar o card) enquanto a solicitação está na etapa Simulação.

CREATE POLICY "solicitante_master_nominations_select" ON public.nominations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_nominations_update" ON public.nominations
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'solicitante_master') AND current_status = 'simulacao')
  WITH CHECK (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_nominees_select" ON public.nomination_nominees
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_nominees_write" ON public.nomination_nominees
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'solicitante_master') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'simulacao'
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'solicitante_master') AND EXISTS (
      SELECT 1 FROM public.nominations n
      WHERE n.id = nomination_id AND n.current_status = 'simulacao'
    )
  );

CREATE POLICY "solicitante_master_history_select" ON public.nomination_status_history
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_history_insert" ON public.nomination_status_history
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

-- Mesmo acesso de leitura ao Histograma Offshore que os outros papéis de etapa já têm (ver
-- 20260821000002_non_operator_shared_access.sql) — sem isso a aba Histograma Offshore/Dashboard
-- fica vazia pra ele, já que o menu (STAGE_ROLES em admin/route.tsx) inclui essa aba.
CREATE POLICY "solicitante_master_hist_novo_colaboradores_select" ON public.hist_novo_colaboradores
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_hist_novo_periodos_select" ON public.hist_novo_periodos
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_timesheet_embarques_select" ON public.timesheet_embarques
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

CREATE POLICY "solicitante_master_timesheet_semanas_select" ON public.timesheet_semanas
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));

-- Leitura do Planejamento de Embarque (mesmo alcance que "pm" já tem, ver
-- 20260922150000_pm_planejamento_embarque_select.sql) — é de lá que a aba Simulação lista quem
-- pode ser adicionado como candidato.
CREATE POLICY "solicitante_master_planejamento_embarque_select" ON public.planejamento_embarque
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'solicitante_master'));
