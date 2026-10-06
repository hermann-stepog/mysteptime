-- Equipes fixas de nomeação (pedido dela, 2026-10-06): ao criar uma solicitação manual marcada
-- como "fixa", o sistema guarda a equipe e a data da próxima troca de turma. Um job diário cria
-- a próxima solicitação sozinho 7 dias úteis antes dessa troca e avança a data em um ciclo
-- (14 dias), mantendo a equipe sempre repetida enquanto estiver ativa.
CREATE TABLE public.nomination_fixed_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcao text NOT NULL,
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade >= 1),
  unidade text NOT NULL,
  bsp text NOT NULL,
  client text,
  notes text,
  periodo_dias integer CHECK (periodo_dias IS NULL OR periodo_dias >= 0),
  pm_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pm_name text,
  proxima_troca date NOT NULL,
  ciclo_dias integer NOT NULL DEFAULT 14 CHECK (ciclo_dias > 0),
  antecedencia_dias_uteis integer NOT NULL DEFAULT 7 CHECK (antecedencia_dias_uteis >= 0),
  ativo boolean NOT NULL DEFAULT true,
  ultima_nomeacao_id uuid REFERENCES public.nominations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER nomination_fixed_teams_updated_at
  BEFORE UPDATE ON public.nomination_fixed_teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nomination_fixed_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fixed_teams_select" ON public.nomination_fixed_teams
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'solicitante_master') OR public.is_operator(auth.uid()));

CREATE POLICY "fixed_teams_insert" ON public.nomination_fixed_teams
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'solicitante_master') OR public.is_operator(auth.uid()));

CREATE POLICY "fixed_teams_update" ON public.nomination_fixed_teams
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'solicitante_master') OR public.is_operator(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'solicitante_master') OR public.is_operator(auth.uid()));
