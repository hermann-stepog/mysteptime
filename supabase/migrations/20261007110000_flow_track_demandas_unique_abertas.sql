-- Ajuste na Etapa 1 (pedido dela, 2026-10-07): a trava "uma demanda por regra+registro" não
-- pode valer pra sempre — uma nomeação pode "parar" (NOM_PARADA), ser cobrada, andar, e parar
-- de novo meses depois; isso precisa gerar uma demanda nova, não ficar bloqueado pela antiga já
-- concluída. Troca a UNIQUE normal por um índice único parcial, que só vale enquanto a demanda
-- está aberta.
ALTER TABLE public.flow_track_demandas DROP CONSTRAINT flow_track_demandas_regra_id_registro_id_key;

CREATE UNIQUE INDEX flow_track_demandas_regra_registro_aberta_idx
  ON public.flow_track_demandas (regra_id, registro_id)
  WHERE status = 'aberta';
