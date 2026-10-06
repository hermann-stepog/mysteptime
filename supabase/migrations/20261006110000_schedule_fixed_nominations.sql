-- Agenda a criação automática das solicitações de equipes fixas (Edge Function
-- create-fixed-nominations) todo dia às 06:00 de Brasília. Reaproveita o mesmo segredo
-- app.cron_secret das outras funções agendadas (ver migration 20260929000000).
select cron.schedule(
  'daily-create-fixed-nominations',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://lzahnaekoiervgqxmouv.functions.supabase.co/create-fixed-nominations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
