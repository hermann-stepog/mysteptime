-- Histórico de alterações do Planejamento de Embarque (quem mexeu, quando e o que mudou) —
-- painel lateral pedido por ela, aberto a partir do indicador "Última atualização" no
-- cabeçalho da aba. Gravado explicitamente pelo app em cada ação (import, cadastro, edição de
-- célula/registro, exclusão), não por gatilho — assim a descrição fica legível em português
-- em vez de um diff genérico de colunas.
CREATE TABLE public.planejamento_embarque_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     UUID REFERENCES public.profiles(id),
  descricao   TEXT NOT NULL
);

CREATE INDEX planejamento_embarque_log_created_at_idx ON public.planejamento_embarque_log(created_at DESC);

ALTER TABLE public.planejamento_embarque_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_planejamento_embarque_log_select" ON public.planejamento_embarque_log
  FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "operators_planejamento_embarque_log_insert" ON public.planejamento_embarque_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()) AND (user_id = auth.uid() OR user_id IS NULL));
