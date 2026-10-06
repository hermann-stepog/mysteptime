import { describe, expect, it, vi } from "vitest";
import {
  handleSmsEmployeesRequest,
  handleSmsQualificationsRequest,
  SMS_DRAKE_WORKER_COLUMNS,
  SMS_EMPLOYEE_COLUMNS,
  SMS_QUALIFICATION_COLUMNS,
} from "./smsEmployees";

const EMP_KEYS = [
  "active", "company", "current_operational_unit_name", "drake_job_name", "drake_worker_id", "full_name",
  "job_title", "operational_function", "registration", "source_id", "worker_state", "worker_type",
];

const row = { matricula: " 123 ", nome: "Ana", empresa: " STEP ", funcao: "Soldador", funcao_operacao: "Op", ativo: true, observacoes: "x", rh_bloqueado: true } as any;
const req = (token?: string) => new Request("https://x/api/integrations/sms/employees", { headers: token ? { "x-sms-sync-token": token } : {} });

describe("SMS employees endpoint", () => {
  it("503 quando o secret não está configurado", async () => {
    const fetchRows = vi.fn();
    const res = await handleSmsEmployeesRequest(req("abc"), { secret: undefined, fetchRows });
    expect(res.status).toBe(503);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("401 sem token e com token incorreto", async () => {
    const fetchRows = vi.fn();
    expect((await handleSmsEmployeesRequest(req(), { secret: "s3cret", fetchRows })).status).toBe(401);
    expect((await handleSmsEmployeesRequest(req("errado"), { secret: "s3cret", fetchRows })).status).toBe(401);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("projeção sem campos extras e com no-store", async () => {
    const res = await handleSmsEmployeesRequest(req("s3cret"), { secret: "s3cret", fetchRows: async () => [row], now: () => new Date("2026-10-06T00:00:00Z") });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["count", "employees", "generated_at"]);
    expect(body.count).toBe(1);
    expect(Object.keys(body.employees[0]).sort()).toEqual(EMP_KEYS);
    expect(body.employees[0].source_id).toBe("STEP::123");
    expect(body.employees[0].drake_worker_id).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/observacoes|rh_bloqueado/);
  });

  it("seleciona apenas colunas explícitas", () => {
    expect(SMS_EMPLOYEE_COLUMNS).not.toContain("*");
    expect(SMS_EMPLOYEE_COLUMNS.split(",").map((c) => c.trim())).toEqual(["matricula", "nome", "empresa", "funcao", "funcao_operacao", "ativo"]);
    expect(SMS_DRAKE_WORKER_COLUMNS).not.toContain("*");
    expect(SMS_DRAKE_WORKER_COLUMNS).not.toMatch(/sync_id|synced_at/);
  });

  it("associa Drake por matrícula com trim e não vaza campos extras", async () => {
    const drake = { drake_worker_id: "D1", registration: "123 ", job_name: "SOLDADOR", current_operational_unit_name: "FPSO X", worker_state: "Ativo", worker_type: "Funcionario", sync_id: "s", synced_at: "t" } as any;
    const res = await handleSmsEmployeesRequest(req("s3cret"), { secret: "s3cret", fetchRows: async () => [row], fetchDrakeWorkers: async () => [drake] });
    const e = (await res.json()).employees[0];
    expect(Object.keys(e).sort()).toEqual(EMP_KEYS);
    expect(e.drake_worker_id).toBe("D1");
    expect(e.drake_job_name).toBe("SOLDADOR");
    expect(JSON.stringify(e)).not.toMatch(/sync_id|synced_at/);
  });
});

describe("SMS qualifications endpoint", () => {
  const q = { drake_worker_id: "D1", qualification_id: "Q1", qualification_name: "NR 35", indicated_course_id: null, indicated_course_name: "NR 35", issue_date: null, expiration_date: "2027-01-01", sync_id: "s" } as any;

  it("503 sem secret e 401 sem/errado token", async () => {
    const fetchRows = vi.fn();
    expect((await handleSmsQualificationsRequest(req("a"), { secret: undefined, fetchRows })).status).toBe(503);
    expect((await handleSmsQualificationsRequest(req(), { secret: "s3cret", fetchRows })).status).toBe(401);
    expect((await handleSmsQualificationsRequest(req("x"), { secret: "s3cret", fetchRows })).status).toBe(401);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("projeção exata, no-store e SELECT explícito", async () => {
    const res = await handleSmsQualificationsRequest(req("s3cret"), { secret: "s3cret", fetchRows: async () => [q] });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["count", "generated_at", "qualifications"]);
    expect(Object.keys(body.qualifications[0]).sort()).toEqual(
      ["drake_worker_id", "expiration_date", "indicated_course_id", "indicated_course_name", "issue_date", "qualification_id", "qualification_name"],
    );
    expect(SMS_QUALIFICATION_COLUMNS).not.toContain("*");
    expect(SMS_QUALIFICATION_COLUMNS.split(",").map((c) => c.trim())).toEqual(
      ["drake_worker_id", "qualification_id", "qualification_name", "indicated_course_id", "indicated_course_name", "issue_date", "expiration_date"],
    );
  });
});

describe("SMS employees — matrícula ambígua", () => {
  it("não associa Drake quando a matrícula se repete entre empresas", async () => {
    const a = { ...row, empresa: "A", matricula: "123" };
    const b = { ...row, empresa: "B", matricula: " 123" };
    const u = { ...row, empresa: "A", matricula: "999" };
    const drake = [
      { drake_worker_id: "D1", registration: "123", job_name: null, current_operational_unit_name: null, worker_state: "Ativo", worker_type: null },
      { drake_worker_id: "D9", registration: "999", job_name: null, current_operational_unit_name: null, worker_state: "Ativo", worker_type: null },
    ];
    const res = await handleSmsEmployeesRequest(req("s3cret"), { secret: "s3cret", fetchRows: async () => [a, b, u], fetchDrakeWorkers: async () => drake });
    const body = await res.json();
    const byId = Object.fromEntries(body.employees.map((e: any) => [e.source_id, e]));
    expect(byId["A::123"].drake_worker_id).toBeNull();
    expect(byId["B::123"].drake_worker_id).toBeNull();
    expect(byId["A::123"].worker_state).toBeNull();
    expect(byId["A::999"].drake_worker_id).toBe("D9");
  });
});
