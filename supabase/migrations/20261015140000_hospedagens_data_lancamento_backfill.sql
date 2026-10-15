-- Backfill de data_lancamento pra quem já estava lançado antes desse campo existir — só pra
-- lançamentos manuais (pedido dela: a importação da planilha de custos não representa a data
-- real de lançamento, só quando o arquivo foi importado no sistema).
--
-- Distingue manual de importado pelos campos que só a importação preenche (ver
-- ImportCustosHospedagemDialog/buildHospedagemRows em hospedagem.tsx): fornecedor,
-- status_lancamento, usuario_faturamento e cobrado=true. Lançamento manual novo sempre grava
-- esses quatro com o valor neutro (null/false) — ver comentário no payload de salvar() em
-- hospedagem.tsx. created_at é confiável como "o dia certinho" só pra quem bate nessa condição,
-- porque a tabela nunca é apagada e reinserida em lote (só INSERT de linha nova).
update public.hospedagens
set data_lancamento = created_at::date
where data_lancamento is null
  and fornecedor is null
  and status_lancamento is null
  and usuario_faturamento is null
  and cobrado is distinct from true;
