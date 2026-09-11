-- Índices aditivos para as consultas operacionais mais frequentes.
-- Não altera linhas, regras, RLS, constraints ou resultados das consultas.

CREATE INDEX IF NOT EXISTS hist_novo_colaboradores_active_name_idx
  ON public.hist_novo_colaboradores (nome, id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS hist_novo_periodos_type_window_idx
  ON public.hist_novo_periodos (tipo, data_inicio, data_fim, colaborador_id);

CREATE INDEX IF NOT EXISTS hist_novo_periodos_end_id_idx
  ON public.hist_novo_periodos (data_fim, id);

CREATE INDEX IF NOT EXISTS colaborador_funcoes_historico_date_worker_idx
  ON public.colaborador_funcoes_historico (data_inicio DESC, colaborador_id);

CREATE INDEX IF NOT EXISTS timesheet_embarques_end_id_idx
  ON public.timesheet_embarques (data_fim_embarque, id);

CREATE INDEX IF NOT EXISTS timesheet_embarques_worker_window_idx
  ON public.timesheet_embarques (colaborador_id, data_inicio_embarque, data_fim_embarque);

CREATE INDEX IF NOT EXISTS timesheet_semanas_end_id_idx
  ON public.timesheet_semanas (data_fim_semana, id);

CREATE INDEX IF NOT EXISTS timesheet_dias_date_id_idx
  ON public.timesheet_dias (data, id);

CREATE INDEX IF NOT EXISTS nominations_created_at_idx
  ON public.nominations (created_at DESC);

CREATE INDEX IF NOT EXISTS nominations_status_created_at_idx
  ON public.nominations (current_status, created_at DESC);

CREATE INDEX IF NOT EXISTS nominations_period_idx
  ON public.nominations (period_start, period_end);

CREATE INDEX IF NOT EXISTS nomination_nominees_active_nomination_idx
  ON public.nomination_nominees (nomination_id, is_active);

CREATE INDEX IF NOT EXISTS nomination_status_history_nomination_created_idx
  ON public.nomination_status_history (nomination_id, created_at DESC);
