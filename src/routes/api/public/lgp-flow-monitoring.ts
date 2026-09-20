// Endpoint somente leitura para o monitoramento externo (LGP Flow).
// Não altera nenhuma tabela nem lógica do app. Protegido por header
// x-lgp-flow-token comparado ao secret LGP_FLOW_ACCESS_TOKEN.
import { createFileRoute } from "@tanstack/react-router";

const STATUS_LABELS: Record<string, string> = {
  solicitacao: "Solicitação",
  recebido_logistica: "Recebido pela Logística",
  simulacao: "Simulação",
  aprovacao_tecnica: "Aprovação Técnica",
  nomeados: "Nomeados",
  validacao_qualidade: "Validação de Qualidade",
  aprovacao_pm: "Aprovação PM",
  aptidao: "Aptidão",
  validacao_sms_aso: "Validação SMS (ASO)",
  aptidao_rh: "Aptidão (RH)",
  validacao_rh: "Validação RH",
  briefing_sms: "Briefing",
  equipe_formada: "Equipe Formada",
};

const TRIP_STATUS_LABELS: Record<string, string> = {
  em_andamento: "Em Andamento",
  realizado: "Realizado",
  cancelado: "Cancelado",
  faturado: "Faturado",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handle(request: Request) {
  const expected = process.env["LGP_FLOW_ACCESS_TOKEN"];
  const provided = request.headers.get("x-lgp-flow-token");
  if (!expected || !provided || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const auditCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [nomsRes, histRes, tripsRes, colsRes, planRes, passRes, auditRes, profRes] = await Promise.all([
    supabaseAdmin
      .from("nominations")
      .select(
        "id, funcao, unidade, bsp, client, project, current_status, created_at, updated_at, period_start",
      )
      .is("outcome", null),
    supabaseAdmin
      .from("nomination_status_history")
      .select("nomination_id, changed_at")
      .order("changed_at", { ascending: false }),
    supabaseAdmin
      .from("transport_trips")
      .select(
        "id, column_id, tipo, scheduled_at, departure_time, origin, destination, status, cliente, bsp, car_number",
      )
      .order("scheduled_at", { ascending: false }),
    supabaseAdmin.from("transport_columns").select("id, name"),
    supabaseAdmin
      .from("planejamento_embarque")
      .select(
        "id, matricula, nome, funcao, especialidade, unidade, bsp, status, embarque, desembarque, duracao_embarque_dias, folga_inicio, folga_fim, ferias_inicio, ferias_fim, programado_1, programado_2, created_at, updated_at",
      )
      .order("nome"),
    supabaseAdmin
      .from("passagens_aereas")
      .select(
        "id, created_at, unidade, bsp, nome_usuario, companhia_aerea, origem, destino, data_ida, data_volta, tipo, valor, status, status_fluxo, motivo, solicitante, internacional, forma_pagamento, observacoes",
      )
      .order("data_ida", { ascending: false }),
    supabaseAdmin
      .from("lgp_flow_activity_log")
      .select(
        "id, tabela_origem, registro_id, usuario_id, acao, etapa_anterior, etapa_nova, criado_em",
      )
      .gte("criado_em", auditCutoff)
      .order("criado_em", { ascending: false }),
    supabaseAdmin.from("profiles").select("id, full_name, email"),
  ]);

  const firstError =
    nomsRes.error || histRes.error || tripsRes.error || colsRes.error || planRes.error || passRes.error;
  if (firstError) return json({ error: firstError.message }, 500);

  const lastChange = new Map<string, string>();
  for (const h of histRes.data ?? []) {
    if (!lastChange.has(h.nomination_id)) lastChange.set(h.nomination_id, h.changed_at);
  }
  const colNames = new Map((colsRes.data ?? []).map((c) => [c.id, c.name]));

  const nominations = (nomsRes.data ?? []).map((n) => ({
    id: n.id,
    funcao: n.funcao,
    unidade: n.unidade,
    bsp: n.bsp,
    cliente: n.client,
    projeto: n.project,
    etapa: STATUS_LABELS[n.current_status] ?? n.current_status,
    etapa_codigo: n.current_status,
    criado_em: n.created_at,
    data_prevista_embarque: n.period_start,
    ultima_mudanca_etapa: lastChange.get(n.id) ?? n.updated_at,
  }));

  const trips = (tripsRes.data ?? []).map((t) => ({
    id: t.id,
    coluna: t.column_id ? (colNames.get(t.column_id) ?? null) : null,
    tipo_transporte: t.tipo,
    data: t.scheduled_at,
    horario_partida: t.departure_time,
    origem: t.origin,
    destino: t.destination,
    status: TRIP_STATUS_LABELS[t.status] ?? t.status,
    status_codigo: t.status,
    cliente: t.cliente,
    bsp: t.bsp,
    carro: t.car_number,
  }));

  const histograma_offshore = (planRes.data ?? []).map((p) => ({
    id: p.id,
    matricula: p.matricula,
    nome: p.nome,
    funcao: p.funcao,
    especialidade: p.especialidade,
    unidade: p.unidade,
    bsp: p.bsp,
    status: p.status,
    embarque: p.embarque,
    desembarque: p.desembarque,
    duracao_embarque_dias: p.duracao_embarque_dias,
    folga_inicio: p.folga_inicio,
    folga_fim: p.folga_fim,
    ferias_inicio: p.ferias_inicio,
    ferias_fim: p.ferias_fim,
    programado_1: p.programado_1,
    programado_2: p.programado_2,
    criado_em: p.created_at,
    atualizado_em: p.updated_at,
  }));

  const passagens_aereas = (passRes.data ?? []).map((a) => ({
    id: a.id,
    criado_em: a.created_at,
    unidade: a.unidade,
    bsp: a.bsp,
    passageiro: a.nome_usuario,
    companhia_aerea: a.companhia_aerea,
    origem: a.origem,
    destino: a.destino,
    data_ida: a.data_ida,
    data_volta: a.data_volta,
    tipo: a.tipo,
    valor: a.valor,
    status: a.status,
    status_fluxo: a.status_fluxo,
    motivo: a.motivo,
    solicitante: a.solicitante,
    internacional: a.internacional,
    forma_pagamento: a.forma_pagamento,
    observacoes: a.observacoes,
  }));

  return json({
    generated_at: new Date().toISOString(),
    nominations_count: nominations.length,
    trips_count: trips.length,
    histograma_offshore_count: histograma_offshore.length,
    passagens_aereas_count: passagens_aereas.length,
    nominations,
    trips,
    histograma_offshore,
    passagens_aereas,
  });
}

export const Route = createFileRoute("/api/public/lgp-flow-monitoring")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
