// Integração externa READ-ONLY para o Sistema SMS. Lógica pura (sem imports de servidor),
// para poder ser testada isoladamente. Nenhuma escrita: só lê colunas explícitas.

export const SMS_EMPLOYEE_COLUMNS = "matricula, nome, empresa, funcao, funcao_operacao, ativo";
export const SMS_DRAKE_WORKER_COLUMNS =
  "drake_worker_id, registration, job_name, current_operational_unit_name, worker_state, worker_type";
export const SMS_QUALIFICATION_COLUMNS =
  "drake_worker_id, qualification_id, qualification_name, indicated_course_id, indicated_course_name, issue_date, expiration_date";

export type SmsSourceRow = {
  matricula: string;
  nome: string;
  empresa: string | null;
  funcao: string | null;
  funcao_operacao: string | null;
  ativo: boolean;
};

export type SmsDrakeWorkerRow = {
  drake_worker_id: string;
  registration: string;
  job_name: string | null;
  current_operational_unit_name: string | null;
  worker_state: string | null;
  worker_type: string | null;
};

export type SmsQualification = {
  drake_worker_id: string;
  qualification_id: string;
  qualification_name: string;
  indicated_course_id: string | null;
  indicated_course_name: string | null;
  issue_date: string | null;
  expiration_date: string | null;
};

export type SmsEmployee = {
  source_id: string;
  company: string | null;
  registration: string;
  full_name: string;
  job_title: string | null;
  operational_function: string | null;
  active: boolean;
  drake_worker_id: string | null;
  drake_job_name: string | null;
  current_operational_unit_name: string | null;
  worker_state: string | null;
  worker_type: string | null;
};

// Uma matrícula pode ter mais de um registro no Drake: prefere "Ativo", depois menor id.
export function indexDrakeWorkers(rows: SmsDrakeWorkerRow[]): Map<string, SmsDrakeWorkerRow> {
  const map = new Map<string, SmsDrakeWorkerRow>();
  for (const w of rows) {
    const key = (w.registration ?? "").trim();
    if (!key) continue;
    const ex = map.get(key);
    const rank = (x: SmsDrakeWorkerRow) => ((x.worker_state ?? "").trim().toLowerCase() === "ativo" ? 0 : 1);
    if (!ex || rank(w) < rank(ex) || (rank(w) === rank(ex) && w.drake_worker_id < ex.drake_worker_id)) {
      map.set(key, w);
    }
  }
  return map;
}

export function mapSmsEmployee(r: SmsSourceRow, drake?: SmsDrakeWorkerRow | null): SmsEmployee {
  const empresa = r.empresa?.trim() || null;
  const matricula = (r.matricula ?? "").trim();
  return {
    source_id: `${empresa ?? ""}::${matricula}`,
    company: empresa,
    registration: matricula,
    full_name: r.nome,
    job_title: r.funcao ?? null,
    operational_function: r.funcao_operacao ?? null,
    active: r.ativo,
    drake_worker_id: drake?.drake_worker_id ?? null,
    drake_job_name: drake?.job_name ?? null,
    current_operational_unit_name: drake?.current_operational_unit_name ?? null,
    worker_state: drake?.worker_state ?? null,
    worker_type: drake?.worker_type ?? null,
  };
}

export function mapSmsQualification(q: SmsQualification): SmsQualification {
  return {
    drake_worker_id: q.drake_worker_id,
    qualification_id: q.qualification_id,
    qualification_name: q.qualification_name,
    indicated_course_id: q.indicated_course_id ?? null,
    indicated_course_name: q.indicated_course_name ?? null,
    issue_date: q.issue_date ?? null,
    expiration_date: q.expiration_date ?? null,
  };
}

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: HEADERS });

// Valida o token; devolve Response de erro ou null quando autorizado.
export function authorizeSmsRequest(request: Request, secretRaw: string | undefined): Response | null {
  const secret = secretRaw?.trim();
  if (!secret) return json({ error: "Integração não configurada." }, 503);
  const token = request.headers.get("x-sms-sync-token") ?? "";
  if (!token || !safeEqual(token, secret)) return json({ error: "Não autorizado." }, 401);
  return null;
}

export async function handleSmsEmployeesRequest(
  request: Request,
  deps: {
    secret: string | undefined;
    fetchRows: () => Promise<SmsSourceRow[]>;
    fetchDrakeWorkers?: () => Promise<SmsDrakeWorkerRow[]>;
    now?: () => Date;
  },
): Promise<Response> {
  const denied = authorizeSmsRequest(request, deps.secret);
  if (denied) return denied;
  try {
    const [rows, drake] = await Promise.all([deps.fetchRows(), deps.fetchDrakeWorkers?.() ?? Promise.resolve([])]);
    const idx = indexDrakeWorkers(drake);
    // Matrícula repetida entre registros ativos = match Drake ambíguo: não associa nenhum.
    const regCount = new Map<string, number>();
    for (const r of rows) {
      const k = (r.matricula ?? "").trim();
      regCount.set(k, (regCount.get(k) ?? 0) + 1);
    }
    const employees = rows.map((r) => {
      const k = (r.matricula ?? "").trim();
      const drakeRow = k && regCount.get(k) === 1 ? idx.get(k) ?? null : null;
      return mapSmsEmployee(r, drakeRow);
    });
    return json({ generated_at: (deps.now?.() ?? new Date()).toISOString(), count: employees.length, employees }, 200);
  } catch {
    return json({ error: "Falha ao consultar colaboradores." }, 500);
  }
}

export async function handleSmsQualificationsRequest(
  request: Request,
  deps: { secret: string | undefined; fetchRows: () => Promise<SmsQualification[]>; now?: () => Date },
): Promise<Response> {
  const denied = authorizeSmsRequest(request, deps.secret);
  if (denied) return denied;
  try {
    const qualifications = (await deps.fetchRows()).map(mapSmsQualification);
    return json(
      { generated_at: (deps.now?.() ?? new Date()).toISOString(), count: qualifications.length, qualifications },
      200,
    );
  } catch {
    return json({ error: "Falha ao consultar qualificações." }, 500);
  }
}
