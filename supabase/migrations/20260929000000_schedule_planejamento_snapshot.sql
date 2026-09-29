-- Agenda a "foto" diária do Planejamento de Embarque (Edge Function
-- capture-planejamento-snapshot) — garante que planejamento_embarque_snapshots sempre tenha o
-- dia de hoje registrado, mesmo que ninguém abra a aba de Planejamento de Embarque naquele dia
-- (antes disso só acontecia pelo navegador de quem visitasse a tela — ver
-- useCapturarSnapshotDiarioPlanejamento em PlanejamentoEmbarqueTab.tsx, que continua existindo
-- e simplesmente não faz nada se o cron já tiver tirado a foto primeiro). Isso é o que garante o
-- histórico usado em "Taxa de Ocupação por mês" a partir de Set/2026 (pedido dela).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Reaproveita o MESMO segredo (app.cron_secret) já configurado manualmente pra
-- daily-turma-alert (ver migration 20260826000000_schedule_turma_alerts.sql) — não precisa
-- configurar de novo, só rodar `supabase secrets set CRON_SECRET=...` (mesmo valor) pra essa
-- nova função também.
select cron.schedule(
  'daily-planejamento-embarque-snapshot',
  '0 9 * * *', -- todo dia às 09:00 UTC (06:00 no horário de Brasília)
  $$
  select net.http_post(
    url := 'https://lzahnaekoiervgqxmouv.functions.supabase.co/capture-planejamento-snapshot',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
