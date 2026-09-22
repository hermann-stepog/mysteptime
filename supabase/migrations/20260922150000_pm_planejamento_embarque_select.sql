-- Planejamento de Embarque só tinha policy pra operador (20260916140000) — como a tabela virou
-- fonte de várias telas que o Solicitante (pm) também usa dentro de /pm (Dashboard do
-- Histograma Offshore, Equipes Embarcadas/Aptidão/Linha do Tempo de Nomeações, cruzamento em
-- Lançamentos), sem essa policy tudo que vem dessa tabela aparecia vazio pro pm, mesmo com o
-- resto da tela funcionando. Só leitura — pm continua sem poder editar/importar (isso é
-- exclusivo do operador, aba Planejamento de Embarque nem aparece pra ele).
CREATE POLICY "pm_planejamento_embarque_select" ON public.planejamento_embarque
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'pm'));
