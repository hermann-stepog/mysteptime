import { describe, expect, it, vi } from "vitest";
import { getApiPeriodDates } from "./report-parameter-builder";
import { validateSpreadsheetBuffer } from "./api-download.server";
import { sanitizeError, sanitizeSensitiveText } from "./sanitize-error.server";
import {
  DRAKE_STAGE_MESSAGE,
  DRAKE_STAGE_PROGRESS,
  DRAKE_REPORT_STATUS_LABEL,
} from "./update-types";
import { API_REPORT_1, API_REPORT_14, API_REQUIRED_REPORTS } from "./report-contracts";
import { getCurrentYearDateRange } from "./date-range";
import {
  tryAcquireDrakeUpdateLock,
  releaseDrakeUpdateLock,
  isDrakeUpdateLocked,
} from "./update-lock.server";

describe("Drake period", () => {
  it("calcula 01/01 ate hoje no fuso America/Sao_Paulo", () => {
    const now = new Date("2026-07-16T15:00:00.000Z");
    const period = getApiPeriodDates("America/Sao_Paulo", now);
    expect(period.human.startDate).toBe("01/01/2026");
    expect(period.apiStartDate).toBe("2026-01-01");
    expect(period.apiEndDate).toMatch(/^2026-07-1[67]$/);
    const range = getCurrentYearDateRange("America/Sao_Paulo", now);
    expect(range.startDate).toBe("01/01/2026");
    expect(range.year).toBe(2026);
  });
});

describe("Drake report order", () => {
  it("define relatorio 1 antes do 14", () => {
    expect(API_REQUIRED_REPORTS.map((r) => r.code)).toEqual([1, 14]);
    expect(API_REPORT_1.queryId).toBe("1ca9b1f3-e25b-ddda-b315-ad5112b51aea");
    expect(API_REPORT_14.queryId).toBe("911891b7-cbf5-a7fa-a3a0-7cd6593fed95");
  });
});

describe("Drake stages (streaming)", () => {
  it("mapeia progresso e mensagens sem tabela", () => {
    expect(DRAKE_STAGE_PROGRESS["importing-embarkation"]).toBe(58);
    expect(DRAKE_STAGE_MESSAGE["preparing-processing-channel"]).toContain("canal de processamento");
    expect(DRAKE_STAGE_PROGRESS["executing-embarkation-query"]).toBe(25);
    expect(DRAKE_STAGE_MESSAGE["connecting-drake"]).toContain("Acessando");
    expect(DRAKE_STAGE_PROGRESS.completed).toBe(100);
    expect(DRAKE_STAGE_PROGRESS["loading-annual-positions"]).toBe(25);
    expect(DRAKE_STAGE_MESSAGE["synchronizing-annual-position"]).toContain("Histograma Offshore");
    expect(DRAKE_STAGE_MESSAGE.completed).toBe("Dados atualizados com sucesso.");
    expect(DRAKE_REPORT_STATUS_LABEL.waiting).toBe("Aguardando");
    expect(DRAKE_REPORT_STATUS_LABEL.completed).toBe("Concluído");
  });
});

describe("lock em memoria", () => {
  it("bloqueia segundo clique e libera no finally", () => {
    releaseDrakeUpdateLock();
    expect(tryAcquireDrakeUpdateLock()).toBe(true);
    expect(isDrakeUpdateLocked()).toBe(true);
    expect(tryAcquireDrakeUpdateLock()).toBe(false);
    releaseDrakeUpdateLock();
    expect(tryAcquireDrakeUpdateLock()).toBe(true);
    releaseDrakeUpdateLock();
  });
});

describe("Excel validation", () => {
  it("rejeita HTML disfarçado de XLS", async () => {
    const html = Buffer.from("<!DOCTYPE html><html><body>login</body></html>");
    await expect(validateSpreadsheetBuffer(html, ".xls", "text/html")).rejects.toThrow();
  });

  it("aceita assinatura XLSX (PK)", async () => {
    const xlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    await expect(
      validateSpreadsheetBuffer(xlsx, ".xlsx", "application/zip"),
    ).resolves.toMatchObject({
      detectedFormat: "xlsx",
      signatureMatches: true,
    });
  });

  it("aceita assinatura XLS OLE", async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    await expect(
      validateSpreadsheetBuffer(xls, ".xls", "application/vnd.ms-excel"),
    ).resolves.toMatchObject({
      detectedFormat: "xls",
      signatureMatches: true,
    });
  });
});

describe("sanitize errors", () => {
  it("redige cookies e tokens", () => {
    const text = sanitizeSensitiveText(
      "Cookie: SapiensiaAuth=abc123; Authorization: Bearer secret-token",
    );
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("secret-token");
    expect(text).toContain("[REDACTED]");
  });

  it("sanitiza Error", () => {
    const safe = sanitizeError(new Error("falha com ASP.NET_SessionId=xyz"));
    expect(safe.message).not.toContain("xyz");
  });
});

describe("http-only imports", () => {
  it("modulos de exportacao nao importam chromium/Page", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files = [
      "report-api-runner.server.ts",
      "api-download.server.ts",
      "background-job-poller.server.ts",
    ];
    for (const file of files) {
      const src = await fs.readFile(path.resolve("src/lib/drake", file), "utf8");
      expect(src).not.toMatch(/\bchromium\b/);
      expect(src).not.toMatch(/\bBrowserContext\b/);
      expect(src).not.toMatch(/\btype Page\b/);
      expect(src).not.toMatch(/\{[^}]*\bPage\b[^}]*\} from ["']playwright["']/);
    }
  });

  it("update-service usa o relatório de BSP sem navegador", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    expect(src).not.toMatch(/\bchromium\b/);
    expect(src).toMatch(/openDrakeSignalRSession|runSingleApiReport/);
    expect(src).toMatch(/synchronizeCurrentDrakeAnnualPositions/);
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/bloqueio.*banco/i);
  });

  it("servico nao acessa drake_data_updates", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    expect(src).not.toContain("drake_data_updates");
    expect(src).not.toMatch(/\bupdateId\b/);
    expect(src).toMatch(/onProgress/);
  });
});

describe("updateDrakeData ficha anual", () => {
  it("emite progresso e sincroniza um único snapshot anual", async () => {
    vi.resetModules();

    const events: Array<{
      stage: string;
      embarkationStatus: string;
      availabilityStatus: string;
      progress: number;
      message: string;
    }> = [];
    const synchronizeAnnual = vi
      .fn()
      .mockImplementation(async (_db, _http, _year, _cutoffDate, _embarkationRows, hooks) => {
        await hooks.onWorkersLoaded(10);
        await hooks.onWorkerProgress({ completedWorkers: 10, totalWorkers: 10 });
        await hooks.onPositionsLoaded();
        await hooks.onBeforeDatabaseSync();
        await hooks.onTimesheetSyncProgress({ completedWorkers: 10, totalWorkers: 10 });
        return {
          createdWorkers: 1,
          updatedWorkers: 9,
          synchronizedEvents: 30,
          removedStaleEvents: 0,
          preservedExistingEvents: 2,
          skippedExistingDays: 4,
          processedWorkers: 10,
        };
      });

    vi.doMock("./auth/environment-credentials-auth.server", () => ({
      EnvironmentCredentialsDrakeAuthProvider: class {
        async authenticate() {
          return {
            authenticatedSession: {
              storageState: { cookies: [], origins: [] },
              requiredHeaders: {},
            },
            renewed: false,
          };
        }
      },
    }));
    vi.doMock("./api-session.server", () => ({
      createDrakeApiContextFromAuthenticatedSession: vi.fn().mockResolvedValue({
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      isSessionExpiredError: () => false,
    }));
    vi.doMock("./annual-position-sync.server", () => ({
      synchronizeCurrentDrakeAnnualPositions: synchronizeAnnual,
    }));
    vi.doMock("./signalr-session.server", () => ({
      openDrakeSignalRSession: vi.fn().mockResolvedValue({
        connectionId: "signal-test",
        close: vi.fn().mockResolvedValue(undefined),
      }),
    }));
    vi.doMock("./report-api-runner.server", () => ({
      runSingleApiReport: vi.fn().mockResolvedValue({ buffer: Buffer.from("report") }),
    }));
    vi.doMock("@/lib/histograma/import-drake", () => ({
      parseDrakeWorkbook: vi.fn().mockReturnValue([]),
    }));

    const { updateDrakeData } = await import("./update-service.server");
    const result = await updateDrakeData(
      {} as never,
      async (ev) => {
        events.push({
          stage: String(ev.stage),
          embarkationStatus: ev.embarkationStatus,
          availabilityStatus: ev.availabilityStatus,
          progress: ev.progress,
          message: ev.message,
        });
      },
      { triggeredBy: null, triggeredByLabel: "test" },
    );

    expect(synchronizeAnnual).toHaveBeenCalledTimes(1);
    expect(result.annualPositionWorkers).toBe(10);
    expect(result.annualPositionEvents).toBe(30);
    expect(result.removedStaleEvents).toBe(0);
    expect(result.skipped).toBe(4);
    expect(events.some((e) => e.stage === "loading-annual-positions")).toBe(true);
    expect(events.some((e) => e.stage === "synchronizing-annual-position")).toBe(true);
    expect(
      events.some(
        (e) =>
          e.stage === "synchronizing-annual-position" &&
          e.progress === 97 &&
          /10\/10 colaboradores/.test(e.message),
      ),
    ).toBe(true);
    const completed = events.find((e) => e.stage === "annual-position-completed");
    expect(completed?.embarkationStatus).toBe("completed");
    expect(completed?.availabilityStatus).toBe("completed");

    vi.resetModules();
    vi.doUnmock("./auth/environment-credentials-auth.server");
    vi.doUnmock("./api-session.server");
    vi.doUnmock("./annual-position-sync.server");
    vi.doUnmock("./signalr-session.server");
    vi.doUnmock("./report-api-runner.server");
    vi.doUnmock("@/lib/histograma/import-drake");
  });
});
