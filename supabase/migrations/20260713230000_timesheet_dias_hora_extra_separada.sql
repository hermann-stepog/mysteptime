-- A hora extra diária passa a ser lançada num período separado (entrada/saída próprios),
-- em vez de ser derivada automaticamente do que exceder 12h no turno normal.
ALTER TABLE public.timesheet_dias ADD COLUMN hora_entrada_extra text;
ALTER TABLE public.timesheet_dias ADD COLUMN hora_saida_extra text;
