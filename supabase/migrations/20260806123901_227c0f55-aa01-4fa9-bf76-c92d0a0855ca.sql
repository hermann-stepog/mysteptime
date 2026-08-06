CREATE TABLE public.bm_timesheet_dias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_dia_id uuid UNIQUE,
  colaborador_id uuid,
  colaborador_nome text NOT NULL DEFAULT '',
  funcao text,
  unidade_operacional text,
  bsp text,
  data date NOT NULL,
  dia_semana text,
  evento text,
  descricao_tarefa text,
  numero_tarefa text,
  hora_entrada text,
  hora_saida text,
  hora_entrada_extra text,
  hora_saida_extra text,
  horas_normais numeric,
  horas_extras numeric,
  total_horas numeric,
  adicional_noturno boolean NOT NULL DEFAULT false,
  feriado boolean NOT NULL DEFAULT false,
  original jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bm_timesheet_dias TO authenticated;
GRANT ALL ON public.bm_timesheet_dias TO service_role;

ALTER TABLE public.bm_timesheet_dias ENABLE ROW LEVEL SECURITY;

CREATE POLICY operators_bm_timesheet_dias_all ON public.bm_timesheet_dias
  FOR ALL TO authenticated
  USING (public.is_operator(auth.uid()))
  WITH CHECK (public.is_operator(auth.uid()));

CREATE INDEX bm_timesheet_dias_data_idx ON public.bm_timesheet_dias (data);
CREATE INDEX bm_timesheet_dias_bsp_idx ON public.bm_timesheet_dias (bsp);

CREATE TRIGGER bm_timesheet_dias_updated_at
  BEFORE UPDATE ON public.bm_timesheet_dias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();