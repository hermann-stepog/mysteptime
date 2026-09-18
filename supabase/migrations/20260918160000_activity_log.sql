-- Log de atividades genérico e compartilhado — mesmo mecanismo já criado só pra Planejamento
-- de Embarque (planejamento_embarque_log), generalizado aqui pra reaproveitar em Transporte
-- (Quadro Detalhado), Nomeações, Hospedagem e Passagens Aéreas sem duplicar tabela/RLS pra
-- cada módulo. "modulo" separa o histórico de cada tela; gravado explicitamente pelo app em
-- cada ação (create/edit/delete), não por gatilho, pra descrição sair legível em português.
CREATE TABLE public.activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     UUID REFERENCES public.profiles(id),
  modulo      TEXT NOT NULL,
  descricao   TEXT NOT NULL
);

CREATE INDEX activity_log_modulo_created_at_idx ON public.activity_log(modulo, created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_activity_log_select" ON public.activity_log
  FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "operators_activity_log_insert" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()) AND (user_id = auth.uid() OR user_id IS NULL));
