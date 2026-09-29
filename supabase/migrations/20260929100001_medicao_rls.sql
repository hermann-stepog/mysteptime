-- RLS do papel "Medição" — acesso completo (igual Logística de Pessoal/is_operator) só nas
-- tabelas de Boletim de Medição, Transporte, Passagens Aéreas e Rates (pedido dela). Não mexe em
-- nenhuma policy existente nem no is_operator() (que dá acesso a dezenas de outras tabelas fora
-- desse escopo) — só ADICIONA uma policy nova por tabela, então quem já tem acesso via
-- is_operator() continua exatamente igual.

-- ── Boletim de Medição ──────────────────────────────────────────────────────────────────────
CREATE POLICY "medicao_bms_all" ON public.bms
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_status_history_all" ON public.bm_status_history
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_lines_mo_all" ON public.bm_lines_mo
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_lines_logistica_all" ON public.bm_lines_logistica
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_lines_materiais_all" ON public.bm_lines_materiais
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_medicoes_all" ON public.bm_medicoes
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_mob_desmob_costs_all" ON public.bm_mob_desmob_costs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_mob_desmob_markups_all" ON public.bm_mob_desmob_markups
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_bm_timesheet_dias_all" ON public.bm_timesheet_dias
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));

-- ── Transporte ──────────────────────────────────────────────────────────────────────────────
CREATE POLICY "medicao_transport_solicitations_all" ON public.transport_solicitations
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_requests_all" ON public.transport_requests
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_columns_all" ON public.transport_columns
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_tags_all" ON public.transport_tags
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_trips_all" ON public.transport_trips
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_trip_collaborators_all" ON public.transport_trip_collaborators
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_trip_materials_all" ON public.transport_trip_materials
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
CREATE POLICY "medicao_transport_trip_tags_all" ON public.transport_trip_tags
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));

-- ── Passagens Aéreas ────────────────────────────────────────────────────────────────────────
CREATE POLICY "medicao_passagens_aereas_all" ON public.passagens_aereas
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));

-- ── Rates ───────────────────────────────────────────────────────────────────────────────────
CREATE POLICY "medicao_rates_all" ON public.rates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'medicao')) WITH CHECK (public.has_role(auth.uid(), 'medicao'));
