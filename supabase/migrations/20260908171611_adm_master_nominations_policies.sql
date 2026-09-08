-- RLS: adm_master tem acesso total às tabelas de Nomeações, em qualquer etapa — mesmo
-- alcance que as policies "operators_*_all" (is_operator), só que por papel específico em vez
-- de por is_operator(), pra não misturar com os outros módulos que dependem de is_operator().
CREATE POLICY "adm_master_nominations_all" ON public.nominations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'adm_master'))
  WITH CHECK (public.has_role(auth.uid(), 'adm_master'));

CREATE POLICY "adm_master_nomination_nominees_all" ON public.nomination_nominees
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'adm_master'))
  WITH CHECK (public.has_role(auth.uid(), 'adm_master'));

CREATE POLICY "adm_master_nomination_history_all" ON public.nomination_status_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'adm_master'))
  WITH CHECK (public.has_role(auth.uid(), 'adm_master'));
