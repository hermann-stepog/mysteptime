import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { DrakeIntegrationError } from "@/lib/drake/integration-error.server";
import { toQualificationErrorEvent } from "./update-error.server";
import {
  DRAKE_QUALIFICATION_STORAGE_NOT_READY,
  QUALIFICATION_ERROR_MESSAGES,
  type QualificationProgressEvent,
} from "./update-types";

describe("qualification update boundaries", () => {
  it("mantém Lçamentos sem dependências de Aptidão", async () => {
    const [service, route, card, scheduler] = await Promise.all([
      readFile("src/lib/drake/update-service.server.ts", "utf8"),
      readFile("src/routes/api/integrations/drake/update.ts", "utf8"),
      readFile("src/components/histograma/DrakeUpdateCard.tsx", "utf8"),
      readFile("src/lib/drake/run-drake-update.server.ts", "utf8"),
    ]);

    for (const source of [service, route, card, scheduler]) {
      expect(source).not.toMatch(/qualification|aptidão|cursos/i);
    }
    expect(service).toMatch(/synchronizeCurrentDrakeAnnualPositions/);
    expect(service).not.toMatch(/syncDrakeQualificationNeeds/);
  });

  it("mantém a atualização de Aptidão fora do fluxo de relatórios", async () => {
    const [service, route, card, tab] = await Promise.all([
      readFile("src/lib/qualification-eligibility/update-service.server.ts", "utf8"),
      readFile("src/routes/api/integrations/drake/qualification-update.ts", "utf8"),
      readFile("src/components/nominations/QualificationUpdateCard.tsx", "utf8"),
      readFile("src/components/nominations/QualificationEligibilityTab.tsx", "utf8"),
    ]);

    expect(service).toMatch(/syncDrakeQualificationNeeds/);
    expect(service).not.toMatch(
      /runSingleApiReport|openDrakeSignalRSession|API_REPORT_1|API_REPORT_14/,
    );
    expect(route).toMatch(/runQualificationUpdate/);
    expect(card).toMatch(/\/api\/integrations\/drake\/qualification-update/);
    expect(tab).toMatch(/<QualificationUpdateCard \/>/);
    expect(tab).not.toMatch(/<DrakeUpdateCard \/>/);
  });

  it("exibe Aptidão somente dentro de Nomeações", async () => {
    const [nominations, histogram] = await Promise.all([
      readFile("src/routes/admin/nominations.tsx", "utf8"),
      readFile("src/routes/admin/histograma-novo.tsx", "utf8"),
    ]);

    expect(nominations).toMatch(/<TabsTrigger value="aptidao">Aptidão<\/TabsTrigger>/);
    expect(nominations).toMatch(/<QualificationEligibilityTab \/>/);
    expect(histogram).not.toMatch(/QualificationEligibilityTab|value="aptidao"/);
  });

  it("mapeia armazenamento ausente apenas como falha de Aptidão", () => {
    const event = toQualificationErrorEvent(
      new DrakeIntegrationError({
        code: DRAKE_QUALIFICATION_STORAGE_NOT_READY,
        message: "storage not ready",
        stage: "importing-qualification-data",
        progress: 85,
      }),
    );

    expect(event.message).toBe(QUALIFICATION_ERROR_MESSAGES[DRAKE_QUALIFICATION_STORAGE_NOT_READY]);
    expect(event.qualificationStatus).toBe("failed");
    expect(event.progress).toBe(85);
  });
});

describe("updateDrakeQualifications", () => {
  it("autentica, sincroniza e emite progresso exclusivamente de Aptidão", async () => {
    vi.resetModules();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn(
      async (
        _context: unknown,
        _db: unknown,
        callbacks: {
          onPage?: (progress: { loaded: number; total: number }) => Promise<void> | void;
          onBeforeImport?: () => Promise<void> | void;
        },
      ) => {
        await callbacks.onPage?.({ loaded: 10, total: 10 });
        await callbacks.onBeforeImport?.();
        return { sourceRows: 10, workers: 3, options: 20, qualifications: 8 };
      },
    );

    vi.doMock("@/lib/drake/auth/environment-credentials-auth.server", () => ({
      EnvironmentCredentialsDrakeAuthProvider: class {
        constructor(private readonly onProgress?: (stage: string) => Promise<void> | void) {}

        async authenticate() {
          await this.onProgress?.("validating-session");
          await this.onProgress?.("session-confirmed");
          return {
            authenticatedSession: {
              storageState: { cookies: [], origins: [] },
              cookieJar: { cookieNames: () => [] },
              requiredHeaders: {},
            },
          };
        }
      },
    }));
    vi.doMock("@/lib/drake/api-session.server", () => ({
      createDrakeApiContextFromAuthenticatedSession: vi.fn().mockResolvedValue({ dispose }),
      isSessionExpiredError: () => false,
    }));
    vi.doMock("./sync.server", () => ({
      QUALIFICATION_STORAGE_MIGRATIONS: ["one.sql", "two.sql"],
      QualificationStorageNotReadyError: class extends Error {},
      syncDrakeQualificationNeeds: sync,
    }));

    const events: QualificationProgressEvent[] = [];
    const { updateDrakeQualifications } = await import("./update-service.server");
    const result = await updateDrakeQualifications({} as never, (event) => {
      events.push(event);
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ sourceRows: 10, workers: 3, options: 20, qualifications: 8 });
    expect(events.some((event) => event.stage === "loading-qualification-data")).toBe(true);
    expect(events.some((event) => event.stage === "importing-qualification-data")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      stage: "completed",
      qualificationStatus: "completed",
      progress: 100,
    });

    vi.doUnmock("@/lib/drake/auth/environment-credentials-auth.server");
    vi.doUnmock("@/lib/drake/api-session.server");
    vi.doUnmock("./sync.server");
    vi.resetModules();
  });
});
