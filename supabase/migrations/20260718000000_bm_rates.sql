-- Tabela de rates (client + vessel + funcao) usada pelo módulo de Boletim de Medição
-- pra calcular Mão de Obra automaticamente a partir do Timesheet Offshore.
CREATE TABLE public.rates (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client                    TEXT NOT NULL,
  vessel                    TEXT NOT NULL,
  funcao                    TEXT NOT NULL,
  rate_embarque             NUMERIC(12,2),
  rate_dobra                NUMERIC(12,2),
  rate_hotel                NUMERIC(12,2),
  rate_hora_extra           NUMERIC(12,2),
  rate_adicional_noturno    NUMERIC(12,2),
  active                    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(client, vessel, funcao)
);

CREATE TRIGGER rates_updated_at
  BEFORE UPDATE ON public.rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operators_rates_all" ON public.rates
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

-- Qualquer usuário autenticado pode ler rates (necessário pra exibir "rate aplicado" em
-- telas read-only, ex.: visitante e a futura visão do PM).
CREATE POLICY "authenticated_rates_select" ON public.rates
  FOR SELECT TO authenticated USING (true);
