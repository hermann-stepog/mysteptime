-- Registra quem marcou uma semana como recebida ("Salvar semana"), pra alimentar o painel
-- de últimas atualizações no Timesheet Offshore. Só passa a valer a partir de agora — semanas
-- já recebidas antes desta coluna existir ficam com recebido_por/recebido_em em branco.
ALTER TABLE public.timesheet_semanas
  ADD COLUMN IF NOT EXISTS recebido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recebido_em TIMESTAMPTZ;
