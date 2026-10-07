import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Roda a cada 15 minutos via pg_cron (ver migration 20261007120000_schedule_flow_track_demandas.sql).
// Etapa 2 de 4 do recurso "Alertas de Pendências de Demandas" (ver migration
// 20261007100000_flow_track_demandas.sql pras tabelas e regras-semente).
//
// Nesta etapa ficam ativas 5 das 7 regras: NOM_RECEBIDO, NOM_ETAPA_LOGISTICA, CUSTO_PASSAGEM,
// CUSTO_HOSPEDAGEM e NOM_PARADA. PLAN_EMBARQUE e TRANSPORTE ficam de fora por enquanto — elas
// precisam cruzar o nomeado (nomination_nominees.colaborador_nome) com o cadastro de
// Planejamento de Embarque (nome texto) e de Transporte (transport_trip_collaborators,
// ligado por id de colaborador formal) e eu não tenho confirmação de como esses três nomes de
// colaborador se equivalem hoje — melhor confirmar antes de criar regras que concluem sozinhas.

// ── Horas úteis (seg-sex, 08h-18h, horário de Brasília = UTC-3, sem horário de verão) ──
const FERIADOS_FIXOS = new Set(["01-01", "04-21", "05-01", "09-07", "11-02", "11-15", "12-25"]);
const INICIO_EXPEDIENTE = 8;
const FIM_EXPEDIENTE = 18;
const OFFSET_BRT_MS = 3 * 3600 * 1000;

function horaBrt(d: Date): number {
  return new Date(d.getTime() - OFFSET_BRT_MS).getUTCHours();
}

function diaUtilBrt(d: Date): boolean {
  const local = new Date(d.getTime() - OFFSET_BRT_MS);
  const diaSemana = local.getUTCDay();
  if (diaSemana === 0 || diaSemana === 6) return false;
  if (FERIADOS_FIXOS.has(local.toISOString().slice(5, 10))) return false;
  if (local.getUTCMonth() === 7) {
    const primeiroDia = new Date(Date.UTC(local.getUTCFullYear(), 7, 1)).getUTCDay();
    const segundaSexta = 1 + ((5 - primeiroDia + 7) % 7) + 7;
    if (local.getUTCDate() === segundaSexta) return false;
  }
  return true;
}

function comHoraBrt(d: Date, hora: number): Date {
  const local = new Date(d.getTime() - OFFSET_BRT_MS);
  local.setUTCHours(hora, 0, 0, 0);
  return new Date(local.getTime() + OFFSET_BRT_MS);
}

function proximoDiaUtilInicio(d: Date): Date {
  let dt = new Date(d);
  do {
    dt = new Date(dt.getTime() + 24 * 3600 * 1000);
  } while (!diaUtilBrt(dt));
  return comHoraBrt(dt, INICIO_EXPEDIENTE);
}

function ajustarParaExpediente(d: Date): Date {
  let dt = new Date(d);
  for (let i = 0; i < 400; i++) {
    if (!diaUtilBrt(dt)) {
      dt = proximoDiaUtilInicio(dt);
      continue;
    }
    const h = horaBrt(dt);
    if (h < INICIO_EXPEDIENTE) return comHoraBrt(dt, INICIO_EXPEDIENTE);
    if (h >= FIM_EXPEDIENTE) {
      dt = proximoDiaUtilInicio(dt);
      continue;
    }
    return dt;
  }
  return dt;
}

function somarHorasUteis(inicio: Date, horas: number): Date {
  let restamMinutos = horas * 60;
  let atual = ajustarParaExpediente(inicio);
  for (let i = 0; i < 400 && restamMinutos > 0; i++) {
    const fimDoDia = comHoraBrt(atual, FIM_EXPEDIENTE);
    const disponivel = (fimDoDia.getTime() - atual.getTime()) / 60000;
    if (restamMinutos <= disponivel) {
      atual = new Date(atual.getTime() + restamMinutos * 60000);
      restamMinutos = 0;
    } else {
      restamMinutos -= disponivel;
      atual = proximoDiaUtilInicio(fimDoDia);
    }
  }
  return atual;
}

// ── Util ──
// deno-lint-ignore no-explicit-any
type Supabase = any;

async function escolherResponsavel(supabase: Supabase, regraId: string): Promise<string | null> {
  const { data } = await supabase.rpc("flow_track_escolher_responsavel", { p_regra_id: regraId });
  return data ?? null;
}

async function concluirDemanda(
  supabase: Supabase,
  demandaId: string,
  prazoEm: string,
  concluidoEm: string,
): Promise<void> {
  const noPrazo = new Date(concluidoEm) <= new Date(prazoEm);
  await supabase
    .from("flow_track_demandas")
    .update({ concluido_em: concluidoEm, status: noPrazo ? "concluida_no_prazo" : "concluida_com_atraso" })
    .eq("id", demandaId);
}

// ── NOM_RECEBIDO: nomeação em "solicitacao" precisa ser marcada "Recebido pela Logística" ──
async function syncNomRecebido(supabase: Supabase, regra: { id: string; prazo_horas: number }) {
  let criadas = 0;
  let concluidas = 0;

  const { data: pendentes } = await supabase
    .from("nominations")
    .select("id, funcao, unidade, bsp, created_at")
    .eq("current_status", "solicitacao");

  for (const n of pendentes ?? []) {
    const responsavel = await escolherResponsavel(supabase, regra.id);
    const prazo = somarHorasUteis(new Date(n.created_at), regra.prazo_horas);
    const { error } = await supabase.from("flow_track_demandas").insert({
      regra_id: regra.id,
      modulo: "nomeacoes",
      registro_id: n.id,
      titulo: `Receber pela Logística — ${n.funcao} (${n.unidade ?? "—"}/${n.bsp ?? "—"})`,
      responsavel_user_id: responsavel,
      prazo_em: prazo.toISOString(),
      link_destino: `/admin/nominations?abrirNomeacao=${n.id}`,
    });
    if (!error) criadas++;
  }

  const { data: abertas } = await supabase
    .from("flow_track_demandas")
    .select("id, registro_id, prazo_em")
    .eq("regra_id", regra.id)
    .eq("status", "aberta");

  for (const d of abertas ?? []) {
    const { data: nom } = await supabase
      .from("nominations")
      .select("current_status")
      .eq("id", d.registro_id)
      .maybeSingle();
    if (!nom || nom.current_status !== "solicitacao") {
      const { data: hist } = await supabase
        .from("nomination_status_history")
        .select("changed_at")
        .eq("nomination_id", d.registro_id)
        .neq("status", "solicitacao")
        .order("changed_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      await concluirDemanda(supabase, d.id, d.prazo_em, hist?.changed_at ?? new Date().toISOString());
      concluidas++;
    }
  }
  return { criadas, concluidas };
}

// ── NOM_ETAPA_LOGISTICA: nomeação em "recebido_logistica" precisa avançar ──
// Premissa (a confirmar com ela): "etapa de responsabilidade da Logística" = o próprio estágio
// recebido_logistica — é aí que Rodrigo/Larissa precisam empurrar o cartão pra Simulação.
async function syncNomEtapaLogistica(supabase: Supabase, regra: { id: string; prazo_horas: number }) {
  let criadas = 0;
  let concluidas = 0;
  const STATUS = "recebido_logistica";

  const { data: pendentes } = await supabase
    .from("nominations")
    .select("id, funcao, unidade, bsp, created_at")
    .eq("current_status", STATUS);

  for (const n of pendentes ?? []) {
    const { data: hist } = await supabase
      .from("nomination_status_history")
      .select("changed_at")
      .eq("nomination_id", n.id)
      .eq("status", STATUS)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const desde = new Date(hist?.changed_at ?? n.created_at);
    const responsavel = await escolherResponsavel(supabase, regra.id);
    const prazo = somarHorasUteis(desde, regra.prazo_horas);
    const { error } = await supabase.from("flow_track_demandas").insert({
      regra_id: regra.id,
      modulo: "nomeacoes",
      registro_id: n.id,
      titulo: `Avançar etapa da Logística — ${n.funcao} (${n.unidade ?? "—"}/${n.bsp ?? "—"})`,
      responsavel_user_id: responsavel,
      prazo_em: prazo.toISOString(),
      link_destino: `/admin/nominations?abrirNomeacao=${n.id}`,
    });
    if (!error) criadas++;
  }

  const { data: abertas } = await supabase
    .from("flow_track_demandas")
    .select("id, registro_id, prazo_em")
    .eq("regra_id", regra.id)
    .eq("status", "aberta");

  for (const d of abertas ?? []) {
    const { data: nom } = await supabase
      .from("nominations")
      .select("current_status")
      .eq("id", d.registro_id)
      .maybeSingle();
    if (!nom || nom.current_status !== STATUS) {
      const { data: hist } = await supabase
        .from("nomination_status_history")
        .select("changed_at")
        .eq("nomination_id", d.registro_id)
        .neq("status", STATUS)
        .order("changed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      await concluirDemanda(supabase, d.id, d.prazo_em, hist?.changed_at ?? new Date().toISOString());
      concluidas++;
    }
  }
  return { criadas, concluidas };
}

// ── CUSTO_PASSAGEM: passagem sem valor lançado ──
async function syncCustoPassagem(supabase: Supabase, regra: { id: string; prazo_horas: number }) {
  let criadas = 0;
  let concluidas = 0;

  const { data: pendentes } = await supabase
    .from("passagens_aereas")
    .select("id, nome_usuario, origem, destino, created_at")
    .is("valor", null);

  for (const p of pendentes ?? []) {
    const responsavel = await escolherResponsavel(supabase, regra.id);
    const prazo = somarHorasUteis(new Date(p.created_at), regra.prazo_horas);
    const { error } = await supabase.from("flow_track_demandas").insert({
      regra_id: regra.id,
      modulo: "passagens_aereas",
      registro_id: p.id,
      titulo: `Custo de passagem — ${p.nome_usuario ?? "—"} (${p.origem ?? "—"} → ${p.destino ?? "—"})`,
      responsavel_user_id: responsavel,
      prazo_em: prazo.toISOString(),
      link_destino: `/admin/passagens-aereas?abrirPassagem=${p.id}`,
    });
    if (!error) criadas++;
  }

  const { data: abertas } = await supabase
    .from("flow_track_demandas")
    .select("id, registro_id, prazo_em")
    .eq("regra_id", regra.id)
    .eq("status", "aberta");

  for (const d of abertas ?? []) {
    const { data: reg } = await supabase
      .from("passagens_aereas")
      .select("valor")
      .eq("id", d.registro_id)
      .maybeSingle();
    if (!reg || reg.valor != null) {
      await concluirDemanda(supabase, d.id, d.prazo_em, new Date().toISOString());
      concluidas++;
    }
  }
  return { criadas, concluidas };
}

// ── CUSTO_HOSPEDAGEM: hospedagem sem valor lançado, prazo a partir do check-out ──
async function syncCustoHospedagem(supabase: Supabase, regra: { id: string; prazo_horas: number }) {
  let criadas = 0;
  let concluidas = 0;

  const { data: pendentes } = await supabase
    .from("hospedagens")
    .select("id, nome_usuario, fornecedor, check_out, created_at")
    .is("valor_total", null);

  for (const h of pendentes ?? []) {
    const responsavel = await escolherResponsavel(supabase, regra.id);
    const base = h.check_out ? new Date(`${h.check_out}T00:00:00Z`) : new Date(h.created_at);
    const prazo = somarHorasUteis(base, regra.prazo_horas);
    const { error } = await supabase.from("flow_track_demandas").insert({
      regra_id: regra.id,
      modulo: "hospedagem",
      registro_id: h.id,
      titulo: `Custo de hospedagem — ${h.nome_usuario ?? "—"} (${h.fornecedor ?? "—"})`,
      responsavel_user_id: responsavel,
      prazo_em: prazo.toISOString(),
      link_destino: `/admin/hospedagem?abrirHospedagem=${h.id}`,
    });
    if (!error) criadas++;
  }

  const { data: abertas } = await supabase
    .from("flow_track_demandas")
    .select("id, registro_id, prazo_em")
    .eq("regra_id", regra.id)
    .eq("status", "aberta");

  for (const d of abertas ?? []) {
    const { data: reg } = await supabase
      .from("hospedagens")
      .select("valor_total")
      .eq("id", d.registro_id)
      .maybeSingle();
    if (!reg || reg.valor_total != null) {
      await concluirDemanda(supabase, d.id, d.prazo_em, new Date().toISOString());
      concluidas++;
    }
  }
  return { criadas, concluidas };
}

// ── NOM_PARADA: cartão parado há mais de 24h úteis na mesma etapa → cobrar ──
// LIMITE_PARADA_HORAS é o gatilho (quando a demanda nasce); regra.prazo_horas é o prazo do
// próprio Gustavo pra agir depois que ela nasceu — são dois números diferentes de propósito,
// por isso o gatilho fica fixo aqui em vez de vir do cadastro de regras.
const LIMITE_PARADA_HORAS = 24;

async function syncNomParada(supabase: Supabase, regra: { id: string; prazo_horas: number }, agora: Date) {
  let criadas = 0;
  let concluidas = 0;

  const { data: emAndamento } = await supabase
    .from("nominations")
    .select("id, funcao, unidade, bsp, current_status, created_at")
    .neq("current_status", "equipe_formada");

  for (const n of emAndamento ?? []) {
    const { data: ultima } = await supabase
      .from("nomination_status_history")
      .select("changed_at")
      .eq("nomination_id", n.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const desde = new Date(ultima?.changed_at ?? n.created_at);
    const limite = somarHorasUteis(desde, LIMITE_PARADA_HORAS);
    if (agora < limite) continue;

    const responsavel = await escolherResponsavel(supabase, regra.id);
    const prazo = somarHorasUteis(agora, regra.prazo_horas);
    const { error } = await supabase.from("flow_track_demandas").insert({
      regra_id: regra.id,
      modulo: "nomeacoes",
      registro_id: n.id,
      titulo: `Cartão parado — ${n.funcao} (${n.unidade ?? "—"}/${n.bsp ?? "—"})`,
      responsavel_user_id: responsavel,
      prazo_em: prazo.toISOString(),
      link_destino: `/admin/nominations?abrirNomeacao=${n.id}`,
    });
    if (!error) criadas++;
  }

  const { data: abertas } = await supabase
    .from("flow_track_demandas")
    .select("id, registro_id, prazo_em, criado_em, cobranca_texto")
    .eq("regra_id", regra.id)
    .eq("status", "aberta");

  for (const d of abertas ?? []) {
    if (d.cobranca_texto) {
      await concluirDemanda(supabase, d.id, d.prazo_em, new Date().toISOString());
      concluidas++;
      continue;
    }
    const { data: ultima } = await supabase
      .from("nomination_status_history")
      .select("changed_at")
      .eq("nomination_id", d.registro_id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima && new Date(ultima.changed_at) > new Date(d.criado_em)) {
      await concluirDemanda(supabase, d.id, d.prazo_em, ultima.changed_at);
      concluidas++;
    }
  }
  return { criadas, concluidas };
}

async function marcarVencidas(supabase: Supabase, agora: Date): Promise<number> {
  const { data } = await supabase
    .from("flow_track_demandas")
    .update({ status: "vencida" })
    .eq("status", "aberta")
    .lt("prazo_em", agora.toISOString())
    .select("id");
  return data?.length ?? 0;
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
  const agora = new Date();

  const { data: regras, error: errRegras } = await supabase
    .from("flow_track_regras")
    .select("id, codigo, prazo_horas")
    .eq("ativo", true);
  if (errRegras) {
    return new Response(JSON.stringify({ error: errRegras.message }), { status: 500 });
  }
  const regraPorCodigo = new Map((regras ?? []).map((r: { codigo: string }) => [r.codigo, r]));

  const resultado: Record<string, { criadas: number; concluidas: number }> = {};
  try {
    if (regraPorCodigo.has("NOM_RECEBIDO")) {
      resultado.NOM_RECEBIDO = await syncNomRecebido(supabase, regraPorCodigo.get("NOM_RECEBIDO"));
    }
    if (regraPorCodigo.has("NOM_ETAPA_LOGISTICA")) {
      resultado.NOM_ETAPA_LOGISTICA = await syncNomEtapaLogistica(supabase, regraPorCodigo.get("NOM_ETAPA_LOGISTICA"));
    }
    if (regraPorCodigo.has("CUSTO_PASSAGEM")) {
      resultado.CUSTO_PASSAGEM = await syncCustoPassagem(supabase, regraPorCodigo.get("CUSTO_PASSAGEM"));
    }
    if (regraPorCodigo.has("CUSTO_HOSPEDAGEM")) {
      resultado.CUSTO_HOSPEDAGEM = await syncCustoHospedagem(supabase, regraPorCodigo.get("CUSTO_HOSPEDAGEM"));
    }
    if (regraPorCodigo.has("NOM_PARADA")) {
      resultado.NOM_PARADA = await syncNomParada(supabase, regraPorCodigo.get("NOM_PARADA"), agora);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message, resultadoParcial: resultado }), { status: 500 });
  }

  const vencidas = await marcarVencidas(supabase, agora);

  return new Response(JSON.stringify({ ok: true, resultado, vencidas }), {
    headers: { "Content-Type": "application/json" },
  });
});
