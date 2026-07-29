-- Correção pontual de função só pra uma semana específica (quando o timesheet físico não bate
-- com a função que veio do Drake) — nula por padrão, continua puxando de
-- timesheet_embarques.funcao_embarque enquanto não for preenchida.
ALTER TABLE public.timesheet_semanas ADD COLUMN IF NOT EXISTS funcao_override TEXT;
