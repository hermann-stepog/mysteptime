-- O endereço agendado antes apontava pra uma Edge Function (supabase/functions/...) que o
-- Lovable não deixa criar nesse formato nesse projeto. A sincronização virou uma rota do
-- próprio app (src/routes/api/public/flow-track-demandas-sync.ts), no mesmo padrão já usado em
-- lgp-flow-monitoring.ts. Reagenda o mesmo job (cron.schedule com o mesmo nome atualiza em vez
-- de duplicar) apontando pra URL nova, com um segredo próprio.
--
-- Adaptação: a ideia original era guardar o segredo numa configuração própria do banco
-- (alter database postgres set app.flow_track_sync_secret = ...), igual o app.cron_secret das
-- outras funções agendadas — mas o usuário do SQL Editor desse projeto não tem permissão pra
-- criar configurações novas (ERROR 42501: permission denied to set parameter). O segredo fica
-- direto no corpo do agendamento. A MESMA string precisa estar na variável de ambiente
-- FLOW_TRACK_SYNC_SECRET do app (Lovable), não nos secrets do Supabase.
select cron.schedule(
  'flow-track-demandas-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://mysteptime.lovable.app/api/public/flow-track-demandas-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-flow-track-sync-token', 'b18a4d2afd13fbe329b0355b15a6d62c63f5e4fe2071f92e93e805416f5c0384'
    ),
    body := '{}'::jsonb
  );
  $$
);
