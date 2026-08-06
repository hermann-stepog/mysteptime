import { describe, expect, it, vi } from "vitest";
import type { DrakeHttpClient, DrakeHttpResponse } from "./http/drake-http-client.types.server";
import { fetchDrakeWorkers } from "./worker-annual-position-api.server";

function response(body: unknown, status = 200): DrakeHttpResponse {
  return {
    status: () => status,
    statusText: () => (status >= 200 && status < 300 ? "OK" : "ERROR"),
    headers: () => ({}),
    url: () => "https://drake.bz/api/v2/dqlfilter/executefilter",
    text: async () => JSON.stringify(body),
    json: async () => body,
    body: async () => Buffer.from(JSON.stringify(body)),
  };
}

function httpWithWorkers(items: unknown[]): DrakeHttpClient {
  return {
    post: vi.fn().mockResolvedValue(
      response({
        count: items.length,
        page: 1,
        limit: 5_000,
        items,
      }),
    ),
    get: vi.fn(),
    fetch: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Worker Dashboard da ficha anual", () => {
  it("retorna somente colaboradores ativos antes de buscar as fichas anuais", async () => {
    const http = httpWithWorkers([
      {
        id: "worker-inactive",
        name: "INATIVO TESTE",
        registration: "100",
        status: "INATIVO",
        companyName: "STEP",
        jobDescription: null,
        payrollJobName: null,
      },
      {
        id: "worker-active-2",
        name: "ATIVO DOIS",
        registration: "102",
        status: " ativo ",
        companyName: "STEP",
        jobDescription: null,
        payrollJobName: null,
      },
      {
        id: "worker-active-1",
        name: "ATIVO UM",
        registration: "101",
        status: "ATIVO",
        companyName: "STEP",
        jobDescription: null,
        payrollJobName: null,
      },
    ]);

    const workers = await fetchDrakeWorkers(http);

    expect(workers.map((worker) => worker.id)).toEqual(["worker-active-1", "worker-active-2"]);
    expect(workers.every((worker) => worker.status.trim().toUpperCase() === "ATIVO")).toBe(true);
  });

  it("interrompe sem tocar no banco quando o Drake não devolve colaborador ativo", async () => {
    const http = httpWithWorkers([
      {
        id: "worker-inactive",
        name: "INATIVO TESTE",
        registration: "100",
        status: "DESLIGADO",
        companyName: "STEP",
        jobDescription: null,
        payrollJobName: null,
      },
    ]);

    await expect(fetchDrakeWorkers(http)).rejects.toThrow(/nenhum colaborador ativo/i);
  });
});
