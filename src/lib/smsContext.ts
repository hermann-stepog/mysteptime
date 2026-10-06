// Integração externa READ-ONLY para o Sistema SMS — datasets de contexto.
// Lógica pura (sem imports de servidor); a rota injeta o acesso ao banco.
import { authorizeSmsRequest } from "./smsEmployees";

type Row = Record<string, any>;

export const PRESENCE_CLASS: Record<string, string> = {
  E: "OFFSHORE", DB: "OFFSHORE",
  BASE: "ONSHORE", TE: "ONSHORE",
  TR: "TRAINING", FIT: "TRAINING",
  HTL: "ACCOMMODATION", FIH: "ACCOMMODATION",
  STB: "AVAILABLE", DI: "AVAILABLE", AD: "AVAILABLE",
  DES: "TRANSITION", DDN: "TRANSITION",
  F: "UNAVAILABLE", FI: "UNAVAILABLE", FIF: "UNAVAILABLE", FIC: "UNAVAILABLE", FIE: "UNAVAILABLE",
  FE: "UNAVAILABLE", AT: "UNAVAILABLE", AFA: "UNAVAILABLE", FT: "UNAVAILABLE", NS: "UNAVAILABLE",
  LM: "UNAVAILABLE", LMV: "UNAVAILABLE",
  CANC: "CANCELLED",
};
export const presenceClass = (tipo: string | null | undefined) =>
  PRESENCE_CLASS[(tipo ?? "").trim().toUpperCase()] ?? "OTHER";

const KEEP_STATUS = ["EMBARCADO", "PROGRAMADO", "DISPONIVEL", "BASE", "TRABALHO EXTERNO", "TERCEIRIZADO"];
export function sanitizeStatus(s: string | null | undefined): string | null {
  if (s == null || !s.trim()) return null;
  const n = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  if (KEEP_STATUS.includes(n)) return n;
  if (n.startsWith("BASE")) return "BASE";
  return "INDISPONIVEL";
}

const empKey = (c: Row | null | undefined) =>
  c && c.matricula != null ? `${(c.empresa ?? "").trim()}::${String(c.matricula).trim()}` : null;

export type DatasetDef = {
  table: string;
  select: string;
  order: string[];
  map: (r: Row, ctx: { activeRegCount: Map<string, { count: number; sourceId: string }> }) => Row;
  needsActiveEmployees?: boolean;
};

const EMP = "colaborador:hist_novo_colaboradores!inner(empresa, matricula)";

export const SMS_DATASETS: Record<string, DatasetDef> = {
  operational_periods: {
    table: "hist_novo_periodos",
    select: `id, unidade_operacional, centro_de_custo, data_inicio, data_fim, dias, origem, bsp, drake_event_key, tipo, ${EMP}`,
    order: ["data_inicio", "id"],
    map: (r) => ({
      source_record_id: r.id, employee_source_id: empKey(r.colaborador), operational_unit: r.unidade_operacional,
      cost_center: r.centro_de_custo, start_date: r.data_inicio, end_date: r.data_fim, days: r.dias,
      source_origin: r.origem, bsp: r.bsp, drake_event_key: r.drake_event_key, presence_class: presenceClass(r.tipo),
    }),
  },
  embarkations: {
    table: "timesheet_embarques",
    select: `id, periodo_id, unidade_operacional, funcao_embarque, data_inicio_embarque, data_fim_embarque, status_entrega, bsp, bsp_2, source_event_key, ${EMP}`,
    order: ["data_inicio_embarque", "id"],
    map: (r) => ({
      source_record_id: r.id, employee_source_id: empKey(r.colaborador), period_source_id: r.periodo_id,
      operational_unit: r.unidade_operacional, embarkation_function: r.funcao_embarque,
      start_date: r.data_inicio_embarque, end_date: r.data_fim_embarque, delivery_status: r.status_entrega,
      bsp: r.bsp, bsp_2: r.bsp_2, source_event_key: r.source_event_key,
    }),
  },
  function_history: {
    table: "colaborador_funcoes_historico",
    select: `id, funcao, embarcacao, data_inicio, data_fim, cod_alocacao, ${EMP}`,
    order: ["data_inicio", "id"],
    map: (r) => ({
      source_record_id: r.id, employee_source_id: empKey(r.colaborador), job_function: r.funcao,
      vessel: r.embarcacao, start_date: r.data_inicio, end_date: r.data_fim, allocation_code: r.cod_alocacao,
    }),
  },
  embarkation_planning: {
    table: "planejamento_embarque",
    select: "id, matricula, unidade, bsp, funcao, especialidade, embarque, desembarque, duracao_embarque_dias, status",
    order: ["id"],
    needsActiveEmployees: true,
    map: (r, { activeRegCount }) => {
      const reg = (r.matricula ?? "").trim();
      const hit = reg ? activeRegCount.get(reg) : undefined;
      return {
        source_record_id: r.id, employee_source_id: hit && hit.count === 1 ? hit.sourceId : null,
        registration: reg || null, operational_unit: r.unidade, bsp: r.bsp, job_function: r.funcao,
        specialty: r.especialidade, embark_date: r.embarque, disembark_date: r.desembarque,
        duration_days: r.duracao_embarque_dias, operational_status: sanitizeStatus(r.status),
      };
    },
  },
  planning_snapshots: {
    table: "planejamento_embarque_snapshots",
    select: "id, snapshot_date, colaborador_nome, status, unidade, bsp, funcao, embarque, desembarque",
    order: ["snapshot_date", "id"],
    map: (r) => ({
      source_record_id: r.id, snapshot_date: r.snapshot_date, collaborator_name: r.colaborador_nome,
      operational_status: sanitizeStatus(r.status), operational_unit: r.unidade, bsp: r.bsp,
      job_function: r.funcao, embark_date: r.embarque, disembark_date: r.desembarque,
    }),
  },
  nominations: {
    table: "nominations",
    select: "id, created_at, updated_at, colaborador_nome, funcao, project, client, weld_type, period_start, period_end, current_status, requires_quality_validation, quality_validated, briefing_sms_realizado, unidade, bsp, weld_material, outcome, quantidade",
    order: ["created_at", "id"],
    map: (r) => ({
      source_record_id: r.id, created_at: r.created_at, updated_at: r.updated_at, collaborator_name: r.colaborador_nome,
      job_function: r.funcao, project: r.project, client: r.client, weld_type: r.weld_type,
      period_start: r.period_start, period_end: r.period_end, current_status: r.current_status,
      requires_quality_validation: r.requires_quality_validation, quality_validated: r.quality_validated,
      safety_briefing_completed: r.briefing_sms_realizado, operational_unit: r.unidade, bsp: r.bsp,
      weld_material: r.weld_material, outcome: r.outcome, quantity: r.quantidade,
    }),
  },
  nomination_sms_checks: {
    table: "nomination_nominees",
    select: "id, nomination_id, colaborador_nome, is_active, pm_decision, aptidao_checked, rh_validated, sms_aso_checked, sms_aso_checked_at, sms_aso_em_dia, rh_documentacao_ok, quality_apto_solda, quality_checked_at",
    order: ["created_at", "id"],
    map: (r) => ({
      source_record_id: r.id, nomination_source_id: r.nomination_id, collaborator_name: r.colaborador_nome,
      is_active: r.is_active, pm_decision: r.pm_decision, aptitude_checked: r.aptidao_checked,
      hr_validated: r.rh_validated, aso_checked: r.sms_aso_checked, aso_checked_at: r.sms_aso_checked_at,
      aso_current: r.sms_aso_em_dia, hr_documentation_ok: r.rh_documentacao_ok,
      welding_quality_fit: r.quality_apto_solda, quality_checked_at: r.quality_checked_at,
    }),
  },
  nomination_status_history: {
    table: "nomination_status_history",
    select: "id, nomination_id, nominee_id, status, changed_at",
    order: ["changed_at", "id"],
    map: (r) => ({
      source_record_id: r.id, nomination_source_id: r.nomination_id, nominee_source_id: r.nominee_id,
      status: r.status, changed_at: r.changed_at,
    }),
  },
  clients: {
    table: "clients", select: "id, name, active", order: ["id"],
    map: (r) => ({ source_record_id: r.id, name: r.name, active: r.active }),
  },
  projects: {
    table: "projects", select: "id, client_id, code, name, active", order: ["id"],
    map: (r) => ({ source_record_id: r.id, client_source_id: r.client_id, code: r.code, name: r.name, active: r.active }),
  },
  nomination_functions: {
    table: "nomination_funcao_catalog", select: "funcao", order: ["funcao"],
    map: (r) => ({ job_function: r.funcao }),
  },
  weld_types: {
    table: "weld_type_config", select: "id, weld_type_name, requires_quality_validation", order: ["id"],
    map: (r) => ({ source_record_id: r.id, weld_type_name: r.weld_type_name, requires_quality_validation: r.requires_quality_validation }),
  },
  weld_materials: {
    table: "weld_material_config", select: "id, material_name", order: ["id"],
    map: (r) => ({ source_record_id: r.id, material_name: r.material_name }),
  },
  timesheet_context: {
    table: "timesheet_dias",
    select: "id, data, descricao_tarefa, numero_tarefa, horas_normais, horas_extras, total_horas, evento, bsp, semana:timesheet_semanas!inner(embarque:timesheet_embarques!inner(colaborador:hist_novo_colaboradores!inner(empresa, matricula)))",
    order: ["data", "id"],
    map: (r) => ({
      source_record_id: r.id, employee_source_id: empKey(r.semana?.embarque?.colaborador), work_date: r.data,
      task_description: r.descricao_tarefa, task_number: r.numero_tarefa, normal_hours: r.horas_normais,
      overtime_hours: r.horas_extras, total_hours: r.total_horas, event: r.evento, bsp: r.bsp,
    }),
  },
  qualification_contexts: {
    table: "drake_qualification_contexts",
    select: "context_key, matrix_id, matrix_name, operational_unit_name, job_name", order: ["context_key"],
    map: (r) => ({ context_key: r.context_key, matrix_id: r.matrix_id, matrix_name: r.matrix_name, operational_unit_name: r.operational_unit_name, job_name: r.job_name }),
  },
  qualification_requirements: {
    table: "drake_qualification_requirements",
    select: "context_key, qualification_id, qualification_name, indicated_course_id, indicated_course_name, qualification_need_type_id, qualification_need_type_name, relationship_set_id, relationship_set_name, is_mandatory",
    order: ["context_key", "qualification_id", "relationship_set_id"],
    map: (r) => ({
      context_key: r.context_key, qualification_id: r.qualification_id, qualification_name: r.qualification_name,
      indicated_course_id: r.indicated_course_id, indicated_course_name: r.indicated_course_name,
      qualification_need_type_id: r.qualification_need_type_id, qualification_need_type_name: r.qualification_need_type_name,
      relationship_set_id: r.relationship_set_id, relationship_set_name: r.relationship_set_name, is_mandatory: r.is_mandatory,
    }),
  },
  qualification_options: {
    table: "drake_qualification_options",
    select: "domain_identifier, option_id, option_name, sort_order", order: ["domain_identifier", "sort_order", "option_id"],
    map: (r) => ({ domain_identifier: r.domain_identifier, option_id: r.option_id, option_name: r.option_name, sort_order: r.sort_order }),
  },
  qualification_sync_state: {
    table: "drake_qualification_sync_state",
    select: "last_success_at, source_row_count, worker_count, context_count, requirement_count, qualification_count, option_count",
    order: ["last_success_at"],
    map: (r) => ({
      last_success_at: r.last_success_at, source_row_count: r.source_row_count, worker_count: r.worker_count,
      context_count: r.context_count, requirement_count: r.requirement_count,
      qualification_count: r.qualification_count, option_count: r.option_count,
    }),
  },
};

// nomination_nominees ordena por created_at, mas created_at não está no SELECT — o PostgREST aceita.

export type SmsContextDeps = {
  secret: string | undefined;
  fetchPage: (def: DatasetDef, from: number, to: number) => Promise<{ rows: Row[]; count: number }>;
  fetchActiveEmployees: () => Promise<{ empresa: string | null; matricula: string }[]>;
  now?: () => Date;
};

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function handleSmsContextRequest(request: Request, deps: SmsContextDeps): Promise<Response> {
  const denied = authorizeSmsRequest(request, deps.secret);
  if (denied) return denied;
  const url = new URL(request.url);
  const name = url.searchParams.get("dataset") ?? "";
  const def = Object.prototype.hasOwnProperty.call(SMS_DATASETS, name) ? SMS_DATASETS[name] : undefined;
  if (!def) return json({ error: "Dataset inválido.", allowed: Object.keys(SMS_DATASETS) }, 400);
  const cursorRaw = url.searchParams.get("cursor") ?? "0";
  const limitRaw = url.searchParams.get("limit") ?? "1000";
  if (!/^\d+$/.test(cursorRaw) || !/^\d+$/.test(limitRaw)) return json({ error: "cursor/limit inválidos." }, 400);
  const cursor = Number(cursorRaw);
  const limit = Number(limitRaw);
  if (limit < 1 || limit > 1000) return json({ error: "limit deve estar entre 1 e 1000." }, 400);
  try {
    const activeRegCount = new Map<string, { count: number; sourceId: string }>();
    if (def.needsActiveEmployees) {
      for (const e of await deps.fetchActiveEmployees()) {
        const reg = (e.matricula ?? "").trim();
        if (!reg) continue;
        const ex = activeRegCount.get(reg);
        activeRegCount.set(reg, { count: (ex?.count ?? 0) + 1, sourceId: `${(e.empresa ?? "").trim()}::${reg}` });
      }
    }
    const { rows, count } = await deps.fetchPage(def, cursor, cursor + limit - 1);
    const records = rows.map((r) => def.map(r, { activeRegCount }));
    const next = cursor + records.length;
    return json({
      dataset: name, generated_at: (deps.now?.() ?? new Date()).toISOString(), count, cursor,
      next_cursor: records.length === limit && next < count ? next : null, records,
    }, 200);
  } catch {
    return json({ error: "Falha ao consultar dataset." }, 500);
  }
}
