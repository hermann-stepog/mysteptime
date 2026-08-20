-- "Na Base" representa exclusivamente o retrato do dia em que a planilha foi importada.
-- Registros antigos podiam se estender por 365 dias; converte-os para a data local da
-- importação para impedir que continuem marcando o colaborador nos dias seguintes.
UPDATE public.hist_novo_periodos
SET
  data_inicio = (created_at AT TIME ZONE 'America/Sao_Paulo')::date,
  data_fim = (created_at AT TIME ZONE 'America/Sao_Paulo')::date,
  dias = 1
WHERE tipo = 'BASE';
