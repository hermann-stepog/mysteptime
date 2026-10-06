// Integração externa READ-ONLY para o Sistema SMS. Lógica pura (sem imports de servidor),
// para poder ser testada isoladamente. Nenhuma escrita: só lê colunas explícitas.

export const SMS_EMPLOYEE_COLUMNS = "matricula, nome, empresa, funcao, funcao_operacao, ativo";

export type SmsSourceRow = {
  matricula: string;
  nome: string;
  empresa: string | null;
  funcao: string | null;
  funcao_operacao: string | null;
  ativo: boolean;
};

export type SmsEmployee = {
  source_id: string;
  company: string | null;
  registration: string;
  full_name: string;
  job_title: string | null;
  operational_function: string | null;
  active: boolean;
};

export function mapSmsEmployee(r: SmsSourceRow): SmsEmployee {
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

export async function handleSmsEmployeesRequest(
  request: Request,
  deps: { secret: string | undefined; fetchRows: () => Promise<SmsSourceRow[]>; now?: () => Date },
): Promise<Response> {
  const secret = deps.secret?.trim();
  if (!secret) return new Response(JSON.stringify({ error: "Integração não configurada." }), { status: 503, headers: HEADERS });
  const token = request.headers.get("x-sms-sync-token") ?? "";
  if (!token || !safeEqual(token, secret)) {
    return new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401, headers: HEADERS });
  }
  try {
    const rows = await deps.fetchRows();
    const employees = rows.map(mapSmsEmployee);
    return new Response(
      JSON.stringify({ generated_at: (deps.now?.() ?? new Date()).toISOString(), count: employees.length, employees }),
      { status: 200, headers: HEADERS },
    );
  } catch {
    return new Response(JSON.stringify({ error: "Falha ao consultar colaboradores." }), { status: 500, headers: HEADERS });
  }
}
