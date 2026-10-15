-- Backfill de data_lancamento pra quem já estava lançado antes desse campo existir — só pra
-- lançamentos manuais, mesmo critério usado em hospedagens (migração 20261015140000): a
-- importação da planilha de custos histórica não representa a data real de lançamento, só
-- quando o arquivo foi importado no sistema.
--
-- Distingue manual de importado pelos campos que só a importação preenche (ver
-- ImportCustosPassagensDialog/buildPassagemRows em passagens-aereas.tsx): status_lancamento,
-- usuario_faturamento e cobrado=true. O salvar() manual nunca grava esses três — ficam no
-- padrão neutro (null/false) do banco. created_at é confiável como "o dia certinho" porque a
-- tabela nunca é apagada e reinserida em lote (só INSERT de linha nova, nunca DELETE em massa).
update public.passagens_aereas
set data_lancamento = created_at::date
where data_lancamento is null
  and status_lancamento is null
  and usuario_faturamento is null
  and cobrado is distinct from true;
