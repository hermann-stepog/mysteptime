-- Índices aditivos para os filtros e relacionamentos usados nas telas de Histograma e
-- Timesheet. Nenhum dado ou índice existente é removido.
CREATE INDEX IF NOT EXISTS hist_novo_periodos_data_fim_id_idx
  ON public.hist_novo_periodos (data_fim, id);

CREATE INDEX IF NOT EXISTS timesheet_embarques_data_fim_id_idx
  ON public.timesheet_embarques (data_fim_embarque, id);

CREATE INDEX IF NOT EXISTS timesheet_embarques_colaborador_datas_idx
  ON public.timesheet_embarques (colaborador_id, data_inicio_embarque, data_fim_embarque);

CREATE INDEX IF NOT EXISTS timesheet_semanas_data_fim_id_idx
  ON public.timesheet_semanas (data_fim_semana, id);

CREATE INDEX IF NOT EXISTS timesheet_semanas_embarque_id_idx
  ON public.timesheet_semanas (embarque_id);

CREATE INDEX IF NOT EXISTS timesheet_dias_semana_id_idx
  ON public.timesheet_dias (semana_id);
