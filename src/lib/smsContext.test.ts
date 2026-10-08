import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handleSmsContextRequest, presenceClass, sanitizeStatus, SMS_DATASETS } from "./smsContext";

const req = (qs: string, token: string | null = "s3cret") =>
  new Request(`https://x/api/integrations/sms/context?${qs}`, { headers: token ? { "x-sms-sync-token": token } : {} });

const deps = (rows: any[] = [], active: any[] = []) => ({
  secret: "s3cret",
  fetchPage: vi.fn(async () => ({ rows, count: rows.length })),
  fetchActiveEmployees: vi.fn(async () => active),
});

const FORBIDDEN = /tipo|observacoes|rh_bloque|justificativa|ferias|folga_|notes|cancel_reason|changed_by|_by"|pm_user|email|hora_entrada|hora_saida|sms_bloqueio_saude|aptidao_divergence|quality_apto_solda_obs|scope_document|sync_id|synced_at|updated_by|\bcusto\b|\bvalor\b/;

describe("SMS context endpoint", () => {
  it("503 sem secret e 401 sem/errado token", async () => {
    const d = deps();
    expect((await handleSmsContextRequest(req("dataset=clients"), { ...d, secret: undefined })).status).toBe(503);
    expect((await handleSmsContextRequest(req("dataset=clients", null), d)).status).toBe(401);
    expect((await handleSmsContextRequest(req("dataset=clients", "x"), d)).status).toBe(401);
    expect(d.fetchPage).not.toHaveBeenCalled();
  });

  it("dataset inválido => 400; limit > 1000 rejeitado", async () => {
    const d = deps();
    expect((await handleSmsContextRequest(req("dataset=profiles"), d)).status).toBe(400);
    expect((await handleSmsContextRequest(req("dataset=__proto__"), d)).status).toBe(400);
    expect((await handleSmsContextRequest(req("dataset=clients&limit=1001"), d)).status).toBe(400);
    expect((await handleSmsContextRequest(req("dataset=clients&limit=0"), d)).status).toBe(400);
    expect(d.fetchPage).not.toHaveBeenCalled();
  });

  it("nenhuma query usa SELECT * e nenhuma seleciona colunas proibidas além do tipo interno", () => {
    for (const [name, def] of Object.entries(SMS_DATASETS)) {
      expect(def.select, name).not.toContain("*");
      expect(def.select.replace(/\btipo\b/, ""), name).not.toMatch(FORBIDDEN);
    }
  });

  it("operational_periods sanitiza tipos sensíveis sem expor o código", async () => {
    for (const t of ["AT", "FE", "LM", "LMV", "AFA", "FT", "NS", "FI"]) expect(presenceClass(t)).toBe("UNAVAILABLE");
    expect(presenceClass("E")).toBe("OFFSHORE");
    expect(presenceClass("XYZ")).toBe("OTHER");
    const row = { id: "p1", tipo: "AT", unidade_operacional: "U", centro_de_custo: "C", data_inicio: "2026-01-01", data_fim: "2026-01-02", dias: 2, origem: "drake", bsp: null, drake_event_key: "k", colaborador: { empresa: " A ", matricula: " 1 " } };
    const res = await handleSmsContextRequest(req("dataset=operational_periods"), deps([row]));
    const body = await res.json();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body.records[0].presence_class).toBe("UNAVAILABLE");
    expect(body.records[0].employee_source_id).toBe("A::1");
    expect(JSON.stringify(body)).not.toMatch(/"tipo"|"AT"/);
  });

  it("embarkation_planning: matrícula ambígua não recebe employee_source_id e status é sanitizado", async () => {
    const rows = [
      { id: "1", matricula: "10", status: "FÉRIAS", observacoes: "x", rh_bloqueado: true },
      { id: "2", matricula: "20", status: "EMBARCADO" },
    ];
    const active = [{ empresa: "A", matricula: "10" }, { empresa: "B", matricula: "10" }, { empresa: "A", matricula: "20" }];
    const body = await (await handleSmsContextRequest(req("dataset=embarkation_planning"), deps(rows, active))).json();
    expect(body.records[0].employee_source_id).toBeNull();
    expect(body.records[0].operational_status).toBe("INDISPONIVEL");
    expect(body.records[1].employee_source_id).toBe("A::20");
    expect(JSON.stringify(body)).not.toMatch(/observacoes|rh_bloqueado/);
  });

  it("status sanitizado", () => {
    expect(sanitizeStatus("BLOQUEIO RH")).toBe("INDISPONIVEL");
    expect(sanitizeStatus("ATESTADO")).toBe("INDISPONIVEL");
    expect(sanitizeStatus("CASA")).toBe("INDISPONIVEL");
    expect(sanitizeStatus("BASE - HENRIQUE")).toBe("BASE");
    expect(sanitizeStatus("Disponível")).toBe("DISPONIVEL");
  });

  it("projeções não vazam campos extras do registro de origem", async () => {
    const leak = { notes: "n", cancel_reason: "c", pm_user_id: "u", sms_bloqueio_saude: true, aptidao_divergence_text: "t", hora_entrada: "08:00", email: "e", changed_by_name: "x" };
    for (const name of Object.keys(SMS_DATASETS)) {
      const body = await (await handleSmsContextRequest(req(`dataset=${name}`), deps([{ id: "1", ...leak }]))).json();
      expect(Object.keys(body).sort()).toEqual(["count", "cursor", "dataset", "generated_at", "next_cursor", "records"]);
      expect(JSON.stringify(body.records), name).not.toMatch(/notes|cancel_reason|pm_user|sms_bloqueio|divergence_text|hora_entrada|email|changed_by/);
    }
  });

  it("paginação: next_cursor", async () => {
    const d = { ...deps(), fetchPage: vi.fn(async () => ({ rows: [{ id: "1" }, { id: "2" }], count: 5 })) };
    const body = await (await handleSmsContextRequest(req("dataset=clients&cursor=0&limit=2"), d)).json();
    expect(body.next_cursor).toBe(2);
  });

  it("employee_documents e nomination_aptitude_alerts: sem file_url, sem SELECT *, projeção exata", async () => {
    expect(SMS_DATASETS.employee_documents.select).not.toMatch(/\*|file_url/);
    expect(SMS_DATASETS.nomination_aptitude_alerts.select).not.toContain("*");
    const doc = { id: "d", collaborator_id: "c", doc_type: "ASO", doc_name: "n", issued_at: "2026-01-01", expires_at: null, file_url: "http://x" };
    const b1 = await (await handleSmsContextRequest(req("dataset=employee_documents"), deps([doc]))).json();
    expect(JSON.stringify(b1)).not.toMatch(/file_url|http:\/\/x/);
    expect(Object.keys(b1.records[0]).sort()).toEqual(["document_name", "document_type", "employee_source_id", "expires_at", "issued_at", "source_profile_id", "source_record_id"]);
    expect(b1.records[0].employee_source_id).toBeNull();
    const b2 = await (await handleSmsContextRequest(req("dataset=nomination_aptitude_alerts"), deps([{ id: "a", nomination_id: "n", colaborador_nome: "X", created_at: "t", extra: 1 }]))).json();
    expect(Object.keys(b2.records[0]).sort()).toEqual(["collaborator_name", "created_at", "nomination_source_id", "source_record_id"]);
  });

  it("employee_documents: vínculo gera employee_source_id; sem vínculo null; endpoint só lê", async () => {
    const linked = { id: "d1", collaborator_id: "p1", hist_colaborador_id: "h1", hist: { empresa: " STEP ", matricula: " 123 " }, doc_type: "NR", doc_name: "x", issued_at: null, expires_at: null, file_url: "u" };
    const unlinked = { id: "d2", collaborator_id: "p2", hist_colaborador_id: null, hist: null, doc_type: "NR", doc_name: "y", issued_at: null, expires_at: null };
    const d = deps([linked, unlinked]);
    const body = await (await handleSmsContextRequest(req("dataset=employee_documents"), d)).json();
    expect(body.records[0].employee_source_id).toBe("STEP::123");
    expect(body.records[0].source_profile_id).toBe("p1");
    expect(body.records[1].employee_source_id).toBeNull();
    expect(JSON.stringify(body)).not.toContain("file_url");
    expect(Object.keys(d)).not.toContain("write");
    const src = readFileSync("src/routes/api/integrations/sms/context.ts", "utf8");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });


  it("rota é GET only", () => {
    const src = readFileSync("src/routes/api/integrations/sms/context.ts", "utf8");
    expect(src).toMatch(/GET:/);
    expect(src).not.toMatch(/\b(POST|PUT|PATCH|DELETE):/);
  });
});
