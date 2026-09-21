-- Controla quem já recebeu o alerta de pendência de aptidão pra não reenviar o mesmo
-- aviso toda vez que alguém reabre a checagem de aptidão da mesma nomeação (pedido dela:
-- "automático, uma vez por nomeado"). Um registro aqui = já mandado, não manda de novo.
CREATE TABLE public.nomination_aptitude_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  nomination_id    UUID NOT NULL REFERENCES public.nominations(id) ON DELETE CASCADE,
  colaborador_nome TEXT NOT NULL,
  UNIQUE (nomination_id, colaborador_nome)
);

ALTER TABLE public.nomination_aptitude_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_nomination_aptitude_alerts_select" ON public.nomination_aptitude_alerts
  FOR SELECT TO authenticated
  USING (public.is_operator(auth.uid()));

CREATE POLICY "operators_nomination_aptitude_alerts_insert" ON public.nomination_aptitude_alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_operator(auth.uid()));
