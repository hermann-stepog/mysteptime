-- O Solicitante (papel "pm") precisa ler hist_novo_periodos (cascata Unidade→BSP) e
-- hist_novo_colaboradores (fallback de função quando não existe em
-- colaborador_funcoes_historico, ex.: "CALDEIREIRO") pra conseguir preencher a própria
-- Solicitação — sem isso, os dois campos ficam vazios pra sempre e a criação é impossível
-- (achado testando o fluxo real de ponta a ponta com uma conta de solicitante).
CREATE POLICY "pm_hist_novo_periodos_select" ON public.hist_novo_periodos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));

CREATE POLICY "pm_hist_novo_colaboradores_select" ON public.hist_novo_colaboradores
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));
