-- O timesheet_embarque passa a ser lançado de forma independente do Histograma
-- (cruzamento com hist_novo_periodos agora é feito por comparação de datas, não FK obrigatória).
ALTER TABLE public.timesheet_embarques ALTER COLUMN periodo_id DROP NOT NULL;
