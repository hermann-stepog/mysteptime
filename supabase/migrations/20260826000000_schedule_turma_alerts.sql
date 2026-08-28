-- Agenda a checagem diária de "troca de turma em 5 dias" (Edge Function
-- check-turma-alerts), que avisa logisticapessoal@step-og.com por e-mail. pg_cron/pg_net
-- não têm CREATE EXTENSION IF NOT EXISTS habilitado por padrão em todo projeto Supabase —
-- em geral já vêm ativados no plano hospedado, mas o IF NOT EXISTS aqui cobre o caso de já
-- estarem ligados por outra migration/uso anterior.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- O segredo do header (x-cron-secret, ver supabase/functions/check-turma-alerts/index.ts e
-- CRON_SECRET nos secrets da função) NÃO fica no código/migration — é lido de uma
-- configuração do próprio banco, ajustada manualmente uma única vez pelo SQL Editor do painel
-- Supabase (não é possível automatizar isso daqui, pois exigiria commitar o segredo em texto
-- puro no git):
--   alter database postgres set app.cron_secret = 'um-valor-aleatorio-qualquer';
-- Use esse MESMO valor ao rodar `supabase secrets set CRON_SECRET=...` pra função.
select cron.schedule(
  'daily-turma-alert',
  '0 9 * * *', -- todo dia às 09:00 UTC (06:00 no horário de Brasília)
  $$
  select net.http_post(
    url := 'https://lzahnaekoiervgqxmouv.functions.supabase.co/check-turma-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
