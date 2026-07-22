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
    await expect(validateSpreadsheetBuffer(xlsx, ".xlsx", "application/zip")).resolves.toMatchObject(
      {
        detectedFormat: "xlsx",
        signatureMatches: true,
      },
    );
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

  it("update-service usa bootstrap SignalR sem importar chromium", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    expect(src).not.toMatch(/\bchromium\b/);
    expect(src).toMatch(/openDrakeSignalRSession/);
  });

  it("servico nao acessa drake_data_updates", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    expect(src).not.toContain("drake_data_updates");
    expect(src).not.toMatch(/\bupdateId\b/);
    expect(src).toMatch(/onProgress/);
  });
});

describe("updateDrakeData ordem dos relatorios", () => {
  it("emite progressos e chama importadores na ordem 1 depois 14", async () => {
    vi.resetModules();

    const events: Array<{ stage: string; embarkationStatus: string; availabilityStatus: string }> =
      [];
    const importEmbark = vi.fn().mockResolvedValue({
      created: 1,
      updated: 2,
      insertedEvents: 3,
      skipped: 0,
    });
    const importAvail = vi.fn().mockResolvedValue({ insertedEvents: 4, skipped: 1 });

    vi.doMock("./auth/environment-credentials-auth.server", () => ({
      EnvironmentCredentialsDrakeAuthProvider: class {
        async authenticate() {
          return { storageState: { cookies: [], origins: [] }, renewed: false };
        }
      },
    }));
    vi.doMock("./api-session.server", () => ({
      createDrakeApiContextFromStorageState: vi.fn().mockResolvedValue({
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      isSessionExpiredError: () => false,
    }));
    vi.doMock("./report-api-runner.server", () => ({
      runSingleApiReport: vi
        .fn()
        .mockResolvedValueOnce({
          filePath: null,
          buffer: Buffer.from("xlsx-1"),
          sizeBytes: 6,
          extension: ".xlsx",
        })
        .mockResolvedValueOnce({
          filePath: null,
          buffer: Buffer.from("xlsx-14"),
          sizeBytes: 7,
          extension: ".xlsx",
        }),
    }));
    vi.doMock("./signalr-session.server", () => ({
      openDrakeSignalRSession: vi.fn().mockResolvedValue({
        connectionId: "test-connection-id",
        protocol: "aspnet-core-signalr",
        transport: "long-polling",
        hubPath: "https://example.invalid/api",
        armDownloadWatch: vi.fn(),
        waitForDownloadReady: vi.fn().mockResolvedValue({
          zipFile: "doc-id",
          zipFileName: "report.xls",
          status: "ReadyForDownload",
          backgroundCode: 5396,
          zipFileIsTemporary: true,
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    }));
    vi.doMock("@/lib/histograma/import-drake", () => ({
      importDrakeEmbarkationFromBuffer: importEmbark,
    }));
    vi.doMock("@/lib/histograma/import-disponibilidade", () => ({
      importDisponibilidadeFromBuffer: importAvail,
    }));

    const { updateDrakeData } = await import("./update-service.server");
    const result = await updateDrakeData({} as never, async (ev) => {
      events.push({
        stage: String(ev.stage),
        embarkationStatus: ev.embarkationStatus,
        availabilityStatus: ev.availabilityStatus,
      });
    });

    expect(importEmbark).toHaveBeenCalledTimes(1);
    expect(importEmbark.mock.calls[0]?.[1]).toEqual(Buffer.from("xlsx-1"));
    expect(importAvail).toHaveBeenCalledTimes(1);
    expect(importAvail.mock.calls[0]?.[1]).toEqual(Buffer.from("xlsx-14"));
    const embarkIdx = events.findIndex((e) => e.stage === "embarkation-completed");
    const availReqIdx = events.findIndex((e) => e.stage === "requesting-availability-report");
    expect(embarkIdx).toBeGreaterThanOrEqual(0);
    expect(availReqIdx).toBeGreaterThan(embarkIdx);
    expect(result.embarkationEvents).toBe(3);
    expect(result.availabilityEvents).toBe(4);

    const completedEmbark = events.find((e) => e.stage === "embarkation-completed");
    expect(completedEmbark?.embarkationStatus).toBe("completed");
    expect(completedEmbark?.availabilityStatus).toBe("waiting");
    expect(events.some((e) => e.stage === "preparing-processing-channel")).toBe(true);

    vi.resetModules();
    vi.doUnmock("./auth/environment-credentials-auth.server");
    vi.doUnmock("./api-session.server");
    vi.doUnmock("./report-api-runner.server");
    vi.doUnmock("./signalr-session.server");
    vi.doUnmock("@/lib/histograma/import-drake");
    vi.doUnmock("@/lib/histograma/import-disponibilidade");
  });
});
