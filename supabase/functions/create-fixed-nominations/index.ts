import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Roda 1x por dia via pg_cron (ver migration 20261006110000_schedule_fixed_nominations.sql).
// Para cada equipe fixa ativa (nomination_fixed_teams), cria a solicitação de nomeação
// antecedencia_dias_uteis dias úteis antes da próxima troca de turma, avisa a Logística por
// e-mail e avança a próxima troca em ciclo_dias. Trocas que já passaram sem criação são só
// avançadas, sem gerar solicitação atrasada.

const FERIADOS_FIXOS = new Set(["01-01", "04-21", "05-01", "09-07", "11-02", "11-15", "12-25"]);

function ehDiaUtil(d: Date): boolean {
  const diaSemana = d.getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  if (FERIADOS_FIXOS.has(d.toISOString().slice(5, 10))) return false;
  if (d.getUTCMonth() === 7) {
    const primeiroDia = new Date(Date.UTC(d.getUTCFullYear(), 7, 1)).getUTCDay();
    const segundaSexta = 1 + ((5 - primeiroDia + 7) % 7) + 7;
    if (d.getUTCDate() === segundaSexta) return false;
  }
  return true;
}

function diaUtilAntes(dataIso: string, dias: number): string {
  let d = new Date(`${dataIso}T00:00:00Z`);
  let restantes = dias;
  while (restantes > 0) {
    d = new Date(d.getTime() - 86400000);
    if (ehDiaUtil(d)) restantes--;
  }
  return d.toISOString().slice(0, 10);
}

function addDias(dataIso: string, n: number): string {
  return new Date(Date.parse(`${dataIso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

function ehSoldador(funcao: string): boolean {
  const f = funcao.toLowerCase();
  return f.includes("soldador") || f.includes("welder") || f.includes("weld.") || f.includes("welding");
}

function formatBr(dataIso: string): string {
  return dataIso.split("-").reverse().join("/");
}

async function enviarEmailLogistica(
  supabase: ReturnType<typeof createClient>,
  nomination: { funcao: string; unidade: string; bsp: string; period_start: string; period_end: string | null },
  troca: string,
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM");
  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY/RESEND_FROM não configurados — e-mail da equipe fixa não enviado");
    return;
  }
  const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "logistics_operator");
  const ids = (roles ?? []).map((r: { user_id: string }) => r.user_id);
  if (ids.length === 0) return;
  const { data: profiles } = await supabase.from("profiles").select("email").in("id", ids);
  const emails = (profiles ?? [])
    .map((p: { email: string | null }) => p.email)
    .filter((e: string | null): e is string => !!e);
  if (emails.length === 0) return;

  const periodo = nomination.period_end
    ? `${formatBr(nomination.period_start)} a ${formatBr(nomination.period_end)}`
    : formatBr(nomination.period_start);
  const html = `<p>Solicitação de nomeação criada automaticamente (equipe fixa).</p>
<ul>
<li><strong>Função:</strong> ${nomination.funcao}</li>
<li><strong>Unidade:</strong> ${nomination.unidade}</li>
<li><strong>BSP:</strong> ${nomination.bsp}</li>
<li><strong>Troca de turma:</strong> ${formatBr(troca)}</li>
<li><strong>Período:</strong> ${periodo}</li>
</ul>
<p>Este é um alerta automático do My Step Time referente ao andamento de uma nomeação.</p>`;
  const text = `Solicitação de nomeação criada automaticamente (equipe fixa).\nFunção: ${nomination.funcao}\nUnidade: ${nomination.unidade}\nBSP: ${nomination.bsp}\nTroca de turma: ${formatBr(troca)}\nPeríodo: ${periodo}`;

  const resposta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: emails[0],
      ...(emails.length > 1 ? { cc: emails.slice(1) } : {}),
      subject: `[Nomeações] Solicitação criada (equipe fixa) — ${nomination.funcao}`,
      html,
      text,
    }),
  });
  if (!resposta.ok) {
    console.warn(`Resend recusou o envio (${resposta.status}): ${await resposta.text().catch(() => "")}`);
  }
}

serve(async (req) => {
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

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: equipes, error: errEquipes } = await supabase
    .from("nomination_fixed_teams")
    .select("*")
    .eq("ativo", true);
  if (errEquipes) {
    return new Response(JSON.stringify({ error: errEquipes.message }), { status: 500 });
  }

  let criadas = 0;
  let avancadasSemCriar = 0;
  const erros: string[] = [];

  for (const equipe of equipes ?? []) {
    try {
      let troca: string = equipe.proxima_troca;
      if (troca < hoje) {
        while (troca < hoje) troca = addDias(troca, equipe.ciclo_dias);
        await supabase.from("nomination_fixed_teams").update({ proxima_troca: troca }).eq("id", equipe.id);
        avancadasSemCriar++;
        continue;
      }

      const entrada = diaUtilAntes(troca, equipe.antecedencia_dias_uteis);
      if (entrada > hoje) continue;

      const periodoEnd = equipe.periodo_dias != null ? addDias(troca, equipe.periodo_dias) : null;
      const { data: nomination, error: errNom } = await supabase
        .from("nominations")
        .insert({
          pm_user_id: equipe.pm_user_id,
          pm_name: equipe.pm_name,
          request_group_id: crypto.randomUUID(),
          funcao: equipe.funcao,
          quantidade: equipe.quantidade,
          unidade: equipe.unidade,
          bsp: equipe.bsp,
          weld_type: null,
          weld_material: null,
          scope_document_path: null,
          scope_document_name: null,
          period_start: troca,
          period_end: periodoEnd,
          project: null,
          client: equipe.client,
          notes: equipe.notes,
          requires_quality_validation: ehSoldador(equipe.funcao),
          current_status: "solicitacao",
        })
        .select()
        .single();
      if (errNom) throw new Error(errNom.message);

      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id,
        status: "solicitacao",
        changed_by_name: "Sistema (equipe fixa)",
        notes: `Solicitação criada automaticamente — equipe fixa, troca de turma em ${formatBr(troca)}`,
      });

      await supabase
        .from("nomination_fixed_teams")
        .update({ proxima_troca: addDias(troca, equipe.ciclo_dias), ultima_nomeacao_id: nomination.id })
        .eq("id", equipe.id);

      await enviarEmailLogistica(supabase, nomination, troca);
      criadas++;
    } catch (err) {
      erros.push(`${equipe.id}: ${(err as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, criadas, avancadasSemCriar, erros }), {
    headers: { "Content-Type": "application/json" },
  });
});
