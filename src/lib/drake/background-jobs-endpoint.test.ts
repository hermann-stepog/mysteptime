import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import {
  BACKGROUND_JOBS_FALLBACK_PATH,
  BACKGROUND_JOBS_PRIMARY_PATH,
  displayDrakePath,
  preserveDrakeApiPath,
  probeBackgroundJobsEndpoint,
  resetBackgroundJobsRouteSelection,
  switchToAlternateBackgroundJobsRoute,
  getActiveBackgroundJobsPath,
} from "./background-jobs-endpoint.server";
import { sanitizePath } from "./drake-http.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { mapDrakeError } from "./map-drake-error.server";
import { DRAKE_BACKGROUND_JOB_NOT_CREATED, DRAKE_ERROR_MESSAGES } from "./update-types";
import { BACKGROUND_EXPORT_CODE } from "./report-contracts";

function mockResponse(args: {
  status?: number;
  json?: unknown;
  url?: string;
  contentType?: string;
}) {
  const body = args.json ?? [];
  const text = JSON.stringify(body);
  return {
    status: () => args.status ?? 200,
    statusText: () => "OK",
    headers: () => ({
      "content-type": args.contentType ?? "application/json",
      "content-length": String(text.length),
    }),
    json: async () => body,
    text: async () => text,
    url: () => args.url ?? `https://drake.bz${BACKGROUND_JOBS_PRIMARY_PATH}?code=5359`,
  };
}

function createApiMock(handlers: {
  primaryItems?: unknown[];
  fallbackItems?: unknown[];
  primaryStatus?: number;
  fallbackStatus?: number;
  onGet?: (path: string, options?: { params?: Record<string, string> }) => void;
}): DrakeHttpClient {
  return {
    get: vi.fn(async (path: string, options?: { params?: Record<string, string> }) => {
      handlers.onGet?.(path, options);
      const isPrimary = path.includes("/api/v2//");
      if (isPrimary) {
        return mockResponse({
          status: handlers.primaryStatus ?? 200,
          json: handlers.primaryItems ?? [],
          url: `https://drake.bz${path}?code=${options?.params?.code ?? ""}`,
        });
      }
      return mockResponse({
        status: handlers.fallbackStatus ?? 200,
        json: handlers.fallbackItems ?? [],
        url: `https://drake.bz${path}?code=${options?.params?.code ?? ""}`,
      });
    }),
  } as unknown as DrakeHttpClient;
}

describe("background jobs endpoint e polling vazio", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DRAKE_EMPTY_JOB_POLLS_BEFORE_FALLBACK = "3";
    process.env.DRAKE_EMPTY_JOB_POLLS_BEFORE_FAILURE = "5";
    process.env.DRAKE_INITIAL_JOB_APPEAR_TIMEOUT_MS = "800";
    process.env.DRAKE_EXPORT_TIMEOUT_MS = "600000";
    process.env.DRAKE_POLL_INTERVAL_MS = "10";
    process.env.DRAKE_TIMEOUT_MS = "5000";
    process.env.DRAKE_DEBUG_POLLING = "false";
    process.env.DRAKE_LOG_LEVEL = "error";
    resetBackgroundJobsRouteSelection();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetBackgroundJobsRouteSelection();
  });

  it("barra dupla e preservada nas constantes e helpers", () => {
    expect(BACKGROUND_JOBS_PRIMARY_PATH).toBe(
      "/api/v2//Core/BackgroundExecutionRequest/getRequestsByCodes",
    );
    expect(BACKGROUND_JOBS_FALLBACK_PATH).toBe(
      "/api/v2/Core/BackgroundExecutionRequest/getRequestsByCodes",
    );
    expect(preserveDrakeApiPath(BACKGROUND_JOBS_PRIMARY_PATH)).toContain("/api/v2//Core/");
    expect(displayDrakePath(BACKGROUND_JOBS_PRIMARY_PATH)).toContain("/api/v2//Core/");
    expect(sanitizePath(BACKGROUND_JOBS_PRIMARY_PATH)).toContain("/api/v2//Core/");
    expect(sanitizePath(`https://drake.bz${BACKGROUND_JOBS_PRIMARY_PATH}`)).toContain(
      "/api/v2//Core/",
    );
  });

  it("code=5359 e enviado e nao omitido", async () => {
    expect(BACKGROUND_EXPORT_CODE).toBe(5359);
    const seen: Array<{ path: string; code?: string }> = [];
    const api = createApiMock({
      onGet: (path, options) => {
        seen.push({ path, code: options?.params?.code });
      },
    });
    await probeBackgroundJobsEndpoint(api);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const call of seen) {
      expect(call.code).toBe("5359");
    }
    expect(seen.some((c) => c.path.includes("/api/v2//"))).toBe(true);
  });

  it("seleciona rota com itens; prioriza barra dupla", async () => {
    const job = {
      id: "job-1",
      status: "ReadyForDownload",
      requestDate: new Date().toISOString(),
      code: 5359,
    };
    const api = createApiMock({
      primaryItems: [job],
      fallbackItems: [job],
    });
    const probe = await probeBackgroundJobsEndpoint(api);
    expect(probe.selectedKind).toBe("primary-double-slash");
    expect(probe.selectedPath).toBe(BACKGROUND_JOBS_PRIMARY_PATH);
  });

  it("seleciona fallback quando apenas ele tem itens", async () => {
    const job = {
      id: "job-2",
      status: "ReadyForDownload",
      requestDate: new Date().toISOString(),
      code: 5359,
    };
    const api = createApiMock({
      primaryItems: [],
      fallbackItems: [job],
    });
    const probe = await probeBackgroundJobsEndpoint(api);
    expect(probe.selectedKind).toBe("fallback-single-slash");
    expect(probe.selectedPath).toBe(BACKGROUND_JOBS_FALLBACK_PATH);
  });

  it("rota alternativa e testada apos respostas vazias e selecionada com itens", async () => {
    resetBackgroundJobsRouteSelection();
    const apiEmpty = createApiMock({ primaryItems: [], fallbackItems: [] });
    await probeBackgroundJobsEndpoint(apiEmpty);
    expect(getActiveBackgroundJobsPath()).toBe(BACKGROUND_JOBS_PRIMARY_PATH);

    const apiWithFallback = createApiMock({
      primaryItems: [],
      fallbackItems: [
        {
          id: "alt-1",
          status: "Processing",
          requestDate: new Date().toISOString(),
          code: 5359,
        },
      ],
    });
    const switched = await switchToAlternateBackgroundJobsRoute(apiWithFallback);
    expect(switched?.itemCount).toBe(1);
    expect(getActiveBackgroundJobsPath()).toBe(BACKGROUND_JOBS_FALLBACK_PATH);
  });

  it("polling falha apos limite de vazios sem esperar timeout total", async () => {
    const { waitForExportJob } = await import("./background-job-poller.server");
    const { API_REPORT_1 } = await import("./report-contracts");
    const api = createApiMock({ primaryItems: [], fallbackItems: [] });
    await probeBackgroundJobsEndpoint(api);

    const started = Date.now();
    await expect(
      waitForExportJob(api, API_REPORT_1, new Set(), new Date(), 600_000, {
        exportHttpStatus: 200,
        exportHadBody: false,
        signalRProvided: false,
      }),
    ).rejects.toMatchObject({
      code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
      stage: "waiting-background-job-creation",
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(60_000);
  });

  it("exportacao 2xx sem job gera erro especifico", async () => {
    const mapped = mapDrakeError(
      new DrakeIntegrationError({
        code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
        message:
          "A exportacao foi aceita, mas nenhum job apareceu no endpoint de processamento em segundo plano.",
        stage: "waiting-background-job-creation",
        reportCode: 1,
        progress: 35,
      }),
      "processing",
      "waiting",
      35,
    );
    expect(mapped.code).toBe(DRAKE_BACKGROUND_JOB_NOT_CREATED);
    expect(mapped.embarkationStatus).toBe("failed");
    expect(mapped.availabilityStatus).toBe("not-started");
    expect(mapped.progress).toBe(35);
    expect(mapped.message).toContain("arquivo de embarque");
    expect(mapped.message).not.toBe(
      DRAKE_ERROR_MESSAGES.DRAKE_EXPORT_FAILED ?? "Não foi possível gerar um dos relatórios.",
    );
  });

  it("relatorio 14 fica not-started quando relatorio 1 falha", () => {
    const mapped = mapDrakeError(
      new DrakeIntegrationError({
        code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
        message: "sem job",
        stage: "waiting-background-job-creation",
        reportCode: 1,
        progress: 35,
      }),
      "failed",
      "not-started",
      35,
    );
    expect(mapped.embarkationStatus).toBe("failed");
    expect(mapped.availabilityStatus).toBe("not-started");
  });

  it("percentual nao volta para zero", () => {
    const mapped = mapDrakeError(
      new DrakeIntegrationError({
        code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
        message: "sem job",
        stage: "waiting-background-job-creation",
        reportCode: 1,
        progress: 35,
      }),
      "processing",
      "waiting",
      35,
    );
    expect(mapped.progress).toBe(35);
  });

  it("nenhum segredo aparece nos logs de path helpers", () => {
    const path = preserveDrakeApiPath(
      "https://user:pass@drake.bz/api/v2//Core/BackgroundExecutionRequest/getRequestsByCodes?token=abc",
    );
    expect(path).not.toMatch(/pass|token=abc|user:/);
    expect(path).toContain("/api/v2//Core/");
  });
});
