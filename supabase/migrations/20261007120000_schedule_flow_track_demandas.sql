-- Agenda a sincronização de demandas (Edge Function flow-track-demandas-sync) a cada 15 minutos.
-- Mesmo segredo app.cron_secret já configurado pras outras funções agendadas.
select cron.schedule(
  'flow-track-demandas-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://lzahnaekoiervgqxmouv.functions.supabase.co/flow-track-demandas-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
