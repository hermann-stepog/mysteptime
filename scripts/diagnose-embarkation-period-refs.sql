-- Diagnóstico somente leitura: períodos de histograma referenciados por timesheet.
-- Não altera dados.

SELECT
  p.id AS periodo_id,
  COUNT(te.*) AS timesheets_vinculados
FROM hist_novo_periodos p
JOIN timesheet_embarques te
  ON te.periodo_id = p.id
GROUP BY p.id
ORDER BY COUNT(te.*) DESC;
