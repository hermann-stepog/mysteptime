import { describe, expect, it, vi } from "vitest";
import { handleSmsEmployeesRequest, SMS_EMPLOYEE_COLUMNS } from "./smsEmployees";

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
    expect(Object.keys(body.employees[0]).sort()).toEqual(
      ["active", "company", "full_name", "job_title", "operational_function", "registration", "source_id"],
    );
    expect(body.employees[0].source_id).toBe("STEP::123");
    expect(JSON.stringify(body)).not.toMatch(/observacoes|rh_bloqueado/);
  });

  it("seleciona apenas colunas explícitas", () => {
    expect(SMS_EMPLOYEE_COLUMNS).not.toContain("*");
    expect(SMS_EMPLOYEE_COLUMNS.split(",").map((c) => c.trim())).toEqual(["matricula", "nome", "empresa", "funcao", "funcao_operacao", "ativo"]);
  });
});
