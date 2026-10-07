-- O endereço agendado antes apontava pra uma Edge Function (supabase/functions/...) que o
-- Lovable não deixa criar nesse formato nesse projeto. A sincronização virou uma rota do
-- próprio app (src/routes/api/public/flow-track-demandas-sync.ts), no mesmo padrão já usado em
-- lgp-flow-monitoring.ts. Reagenda o mesmo job (cron.schedule com o mesmo nome atualiza em vez
-- de duplicar) apontando pra URL nova, com um segredo próprio.
--
-- Antes de rodar esta migration, configure o segredo (uma vez só):
--   alter database postgres set app.flow_track_sync_secret = '<valor combinado>';
-- E configure a MESMA string como variável de ambiente FLOW_TRACK_SYNC_SECRET no app (Lovable),
-- não nos secrets do Supabase — essa rota mora no app, não numa Edge Function.
select cron.schedule(
  'flow-track-demandas-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://mysteptime.lovable.app/api/public/flow-track-demandas-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-flow-track-sync-token', coalesce(current_setting('app.flow_track_sync_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
