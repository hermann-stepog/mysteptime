import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Roda 1x por dia via pg_cron (ver migration 20260929000000_schedule_planejamento_snapshot.sql).
// Garante a "foto" diária do Planejamento de Embarque (planejamento_embarque_snapshots) mesmo
// que ninguém abra a aba naquele dia — antes essa foto só era tirada pelo navegador de quem
// visitasse a tela (ver useCapturarSnapshotDiarioPlanejamento em PlanejamentoEmbarqueTab.tsx),
// o que deixava o histórico de "Taxa de Ocupação por mês" vulnerável a dias sem ninguém logado.
// Mesma lógica daquele hook, só que rodando sozinha, sem precisar de ninguém com a tela aberta.
function todayUtcStr(): string {
  return new Date().toISOString().slice(0, 10);
}

serve(async (req) => {
  // Proteção simples contra chamada externa não autorizada — o job do pg_cron manda esse
  // header (ver migration); sem ele, recusa. Não é verify_jwt normal porque quem chama é o
  // Postgres via pg_net, não um usuário logado.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "SUPABASE_URL/SERVICE_ROLE_KEY não configurados" }), { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const hoje = todayUtcStr();

  // Já tem foto de hoje (ex.: alguém abriu a aba antes do cron rodar) — não faz nada, evita
  // sobrescrever com um retrato mais tardio do dia sem necessidade.
  const { count, error: countErr } = await supabase
    .from("planejamento_embarque_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("snapshot_date", hoje);
  if (countErr) {
    return new Response(JSON.stringify({ error: countErr.message }), { status: 500 });
  }
  if (count && count > 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "ja_existe", linhas: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  const { data: registros, error: fetchErr } = await supabase
    .from("planejamento_embarque")
    .select("nome, status, unidade, bsp, funcao, embarque, desembarque");
  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 });
  }
  if (!registros || registros.length === 0) {
    return new Response(JSON.stringify({ ok: true, linhas: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  const linhas = registros.map((r: any) => ({
    snapshot_date: hoje,
    colaborador_nome: r.nome,
    status: r.status,
    unidade: r.unidade,
    bsp: r.bsp,
    funcao: r.funcao,
    embarque: r.embarque,
    desembarque: r.desembarque,
  }));

  const { error: upsertErr } = await supabase
    .from("planejamento_embarque_snapshots")
    .upsert(linhas, { onConflict: "snapshot_date,colaborador_nome" });
  if (upsertErr) {
    return new Response(JSON.stringify({ error: upsertErr.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, linhas: linhas.length }), { headers: { "Content-Type": "application/json" } });
});
