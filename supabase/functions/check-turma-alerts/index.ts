import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

// Roda 1x por dia via pg_cron (ver migration 20260826000000_schedule_turma_alerts.sql).
// Avisa logisticapessoal@step-og.com quando alguma equipe embarcada está a exatamente 5 dias
// de precisar de troca de turma (timesheet_embarques.data_fim_embarque = hoje + 5) — mesma
// noção de "Próxima Troca de Turma" já mostrada na aba Equipes Embarcadas de Nomeações
// (src/routes/admin/nominations.tsx), só que aqui roda sozinha, sem precisar de ninguém com a
// tela aberta.
const ALERT_TO = "logisticapessoal@step-og.com";
const DIAS_ANTECEDENCIA = 5;

function todayUtcStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
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

  const targetDate = addDaysStr(todayUtcStr(), DIAS_ANTECEDENCIA);

  const { data: embarques, error: embErr } = await supabase
    .from("timesheet_embarques")
    .select("colaborador_id, unidade_operacional, bsp, funcao_embarque, data_fim_embarque")
    .eq("data_fim_embarque", targetDate);
  if (embErr) {
    return new Response(JSON.stringify({ error: embErr.message }), { status: 500 });
  }
  if (!embarques || embarques.length === 0) {
    return new Response(JSON.stringify({ ok: true, alertas: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  const colaboradorIds = Array.from(new Set(embarques.map((e) => e.colaborador_id)));
  const { data: colaboradores, error: colErr } = await supabase
    .from("hist_novo_colaboradores")
    .select("id, nome")
    .in("id", colaboradorIds);
  if (colErr) {
    return new Response(JSON.stringify({ error: colErr.message }), { status: 500 });
  }
  const nomeById = new Map((colaboradores ?? []).map((c: any) => [c.id, c.nome as string]));

  // Agrupa por Unidade + BSP — mesma granularidade da "Próxima Troca de Turma" na tela.
  const grupos = new Map<string, { unidade: string; bsp: string; pessoas: string[] }>();
  embarques.forEach((e: any) => {
    const unidade = e.unidade_operacional?.trim() || "Unidade não informada";
    const bsp = e.bsp?.trim() || "BSP não informado";
    const key = `${unidade}::${bsp}`;
    if (!grupos.has(key)) grupos.set(key, { unidade, bsp, pessoas: [] });
    const nome = nomeById.get(e.colaborador_id) ?? "Colaborador não identificado";
    grupos.get(key)!.pessoas.push(`${nome} (${e.funcao_embarque || "função não informada"})`);
  });

  const linhas = Array.from(grupos.values())
    .sort((a, b) => a.unidade.localeCompare(b.unidade) || a.bsp.localeCompare(b.bsp))
    .map((g) => `${g.unidade} — ${g.bsp}:\n  ${g.pessoas.join("\n  ")}`);

  const corpo = [
    `As equipes abaixo estão a ${DIAS_ANTECEDENCIA} dias de precisar de troca de turma`,
    `(previsão de desembarque em ${targetDate.split("-").reverse().join("/")}):`,
    "",
    ...linhas,
  ].join("\n");

  const host = Deno.env.get("SMTP_HOST");
  const port = Deno.env.get("SMTP_PORT");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  const from = Deno.env.get("SMTP_FROM") || user;
  if (!host || !port || !user || !pass) {
    return new Response(JSON.stringify({ error: "Credenciais SMTP não configuradas nos secrets da função" }), { status: 500 });
  }

  const transporter = nodemailer.createTransport({
    host, port: Number(port), secure: Number(port) === 465, auth: { user, pass },
  });
  await transporter.sendMail({
    from, to: ALERT_TO,
    subject: `Troca de turma em ${DIAS_ANTECEDENCIA} dias — ${grupos.size} equipe(s)`,
    text: corpo,
  });

  return new Response(JSON.stringify({ ok: true, alertas: grupos.size }), { headers: { "Content-Type": "application/json" } });
});
