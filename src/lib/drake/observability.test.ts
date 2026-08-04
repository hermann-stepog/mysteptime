import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBackgroundJobsPayload,
  evaluateJobCandidate,
  findScoredExportJobs,
  parseBackgroundItems,
} from "./background-job-poller.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { mapDrakeError, toErrorProgressEvent } from "./map-drake-error.server";
import {
  DRAKE_EMBARKATION_EXPORT_FAILED,
  DRAKE_ERROR_MESSAGES,
  DRAKE_EXPORT_TIMEOUT,
} from "./update-types";
import { API_REPORT_1 } from "./report-contracts";

describe("observabilidade e falhas Drake", () => {
  const originalEnv = { ...process.env };
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await mkdtemp(path.join(tmpdir(), "drake-obs-"));
    process.env.DRAKE_TEMP_DIR = testRoot;
    process.env.DRAKE_LAST_DIAGNOSTIC_DIR = path.join(testRoot, "last-error");
    process.env.DRAKE_LAST_ERROR_FILE_ENABLED = "true";
    process.env.DRAKE_LOG_LEVEL = "debug";
    process.env.DRAKE_JOB_CLOCK_SKEW_MS = "30000";
    vi.resetModules();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("falha tipada gera errorCode e stage", () => {
    const err = new DrakeIntegrationError({
      code: DRAKE_EXPORT_TIMEOUT,
      message: "Nenhum job concluido correspondente ao relatorio foi encontrado dentro do prazo.",
      stage: "polling-background-job",
      reportCode: 1,
      progress: 35,
      details: { pollAttempts: 3, lastObservedStatuses: ["Processing"] },
    });
    expect(err.code).toBe(DRAKE_EXPORT_TIMEOUT);
    expect(err.stage).toBe("polling-background-job");
    const mapped = mapDrakeError(err, "processing", "waiting", 35);
    expect(mapped.code).toBe(DRAKE_EMBARKATION_EXPORT_FAILED);
    expect(mapped.progress).toBe(35);
    expect(mapped.embarkationStatus).toBe("failed");
    expect(mapped.availabilityStatus).toBe("not-started");
    const event = toErrorProgressEvent(mapped);
    expect(event.progress).toBe(35);
    expect(JSON.stringify(event)).not.toMatch(/stack/i);
  });

  it("erro do relatorio 1 nao marca relatorio 14 como failed", () => {
    const mapped = mapDrakeError(
      new DrakeIntegrationError({
        code: DRAKE_EXPORT_TIMEOUT,
        message: "timeout",
        stage: "polling-background-job",
        reportCode: 1,
        progress: 35,
      }),
      "processing",
      "waiting",
      35,
    );
    expect(mapped.availabilityStatus).toBe("not-started");
    expect(mapped.message).toBe(DRAKE_ERROR_MESSAGES[DRAKE_EMBARKATION_EXPORT_FAILED]);
  });

  it("erro DRAKE_BACKGROUND_JOB_NOT_CREATED nao marca disponibilidade como falha", () => {
    const mapped = mapDrakeError(
      new DrakeIntegrationError({
        code: "DRAKE_BACKGROUND_JOB_NOT_CREATED",
        message: "sem job",
        stage: "waiting-background-job-creation",
        reportCode: 1,
        progress: 35,
      }),
      "processing",
      "waiting",
      35,
    );
    expect(mapped.code).toBe("DRAKE_BACKGROUND_JOB_NOT_CREATED");
    expect(mapped.embarkationStatus).toBe("failed");
    expect(mapped.availabilityStatus).toBe("not-started");
    expect(mapped.progress).toBe(35);
    expect(mapped.message).toMatch(/embarque/);
  });

  it("percentual nao volta para zero na falha", () => {
    const event = toErrorProgressEvent(
      mapDrakeError(
        new DrakeIntegrationError({
          code: DRAKE_EXPORT_TIMEOUT,
          message: "timeout",
          stage: "polling-background-job",
          reportCode: 1,
          progress: 35,
        }),
        "processing",
        "waiting",
        35,
      ),
    );
    expect(event.progress).toBe(35);
  });

  it("parse aceita array e { data: [] }", () => {
    const a = parseBackgroundItems([{ id: "abc", status: "ReadyForDownload", requestDate: "" }]);
    expect(a).toHaveLength(1);
    const b = parseBackgroundItems({
      data: [{ id: "def", status: "Processing", requestDate: "" }],
    });
    expect(b).toHaveLength(1);
    expect(() => assertBackgroundJobsPayload({ weird: true, foo: 1 })).toThrow(
      /BACKGROUND_JOBS_INVALID_RESPONSE|nao reconhecido|inesperada/i,
    );
  });

  it("margem de horario e aplicada na avaliacao", () => {
    process.env.DRAKE_JOB_CLOCK_SKEW_MS = "30000";
    const exportStartedAt = new Date("2026-07-17T12:00:00.000Z");
    const item = {
      id: "job-1",
      requestDate: "2026-07-17T11:59:45.000Z",
      code: 5359,
      description: "1_RELATORIO DE EMBARQUE",
      zipFile: null,
      zipFileName: null,
      zipFileIsTemporary: null,
      requestContext: null,
      status: "Processing",
      errorOutput: null,
      requestContextArgs: null,
      requestContextArgsType: null,
    };
    const evaluation = evaluateJobCandidate(item, new Set(), API_REPORT_1, exportStartedAt);
    expect(evaluation.createdAfterExportWithTolerance).toBe(true);
    expect(evaluation.clockSkewAppliedMs).toBe(30000);
    expect(evaluation.rejectionReasons).not.toContain("CREATED_BEFORE_EXPORT");
  });

  it("job correto nao e rejeitado por campo opcional ausente", () => {
    const exportStartedAt = new Date("2026-07-17T12:00:00.000Z");
    const item = {
      id: "job-new",
      requestDate: "2026-07-17T12:00:05.000Z",
      code: 5359,
      description: "1_RELATORIO DE EMBARQUE DE PESSOAL",
      zipFile: null,
      zipFileName: null,
      zipFileIsTemporary: null,
      requestContext: null,
      status: "Processing",
      errorOutput: null,
      requestContextArgs: null,
      requestContextArgsType: null,
    };
    const evaluation = evaluateJobCandidate(item, new Set(), API_REPORT_1, exportStartedAt);
    expect(evaluation.accepted).toBe(true);
    expect(evaluation.rejectionReasons).not.toContain("MISSING_FILE_REFERENCE");
  });

  it("candidatos registram rejectionReasons de baseline", () => {
    const exportStartedAt = new Date("2026-07-17T12:00:00.000Z");
    const item = {
      id: "old",
      requestDate: "2026-07-17T12:00:05.000Z",
      code: 5359,
      description: "1_RELATORIO",
      zipFile: "x",
      zipFileName: "1_file.xls",
      zipFileIsTemporary: true,
      requestContext: null,
      status: "ReadyForDownload",
      errorOutput: null,
      requestContextArgs: null,
      requestContextArgsType: null,
    };
    const evaluation = evaluateJobCandidate(item, new Set(["old"]), API_REPORT_1, exportStartedAt);
    expect(evaluation.rejectionReasons).toContain("EXISTED_IN_BASELINE");
    expect(evaluation.accepted).toBe(false);
  });

  it("errorOutput e sanitizado na mensagem tipada", () => {
    const err = new DrakeIntegrationError({
      code: "DRAKE_BACKGROUND_JOB_FAILED",
      message: "O Drake retornou erro durante a exportacao do relatorio 1.",
      stage: "polling-background-job",
      reportCode: 1,
      details: {
        sanitizedErrorOutput: "Cookie: ASP.NET_SessionId=abc123; falha",
      },
    });
    expect(err.details.sanitizedErrorOutput).toBeDefined();
    const text = String(err.details.sanitizedErrorOutput);
    // sanitizeDetails aplica sanitizeSensitiveText
    expect(text).not.toMatch(/abc123/);
  });

  it("last-error sobrescreve sem timestamp no nome", async () => {
    const { writeLastErrorFile } = await import("./last-error.server");
    const { getDrakeLastDiagnosticDir } = await import("./drake-files.server");
    await writeLastErrorFile({
      stage: "polling-background-job",
      errorCode: "DRAKE_EXPORT_TIMEOUT",
      message: "primeiro",
      reportCode: 1,
      progress: 35,
    });
    await writeLastErrorFile({
      stage: "polling-background-job",
      errorCode: "DRAKE_EXPORT_TIMEOUT",
      message: "segundo",
      reportCode: 1,
      progress: 35,
    });
    const dir = getDrakeLastDiagnosticDir();
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.includes("last-error"))).toEqual(["last-error.json"]);
    const raw = JSON.parse(await readFile(path.join(dir, "last-error.json"), "utf8"));
    expect(raw.message).toContain("segundo");
    expect(raw.errorCode).toBe("DRAKE_EXPORT_TIMEOUT");
  });

  it("scoring preferre job novo com arquivo", () => {
    const exportStartedAt = new Date("2026-07-17T12:00:00.000Z");
    const items = [
      {
        id: "a",
        requestDate: "2026-07-17T12:00:01.000Z",
        code: 5359,
        description: "1_RELATORIO",
        zipFile: null,
        zipFileName: null,
        zipFileIsTemporary: null,
        requestContext: null,
        status: "Processing",
        errorOutput: null,
        requestContextArgs: null,
        requestContextArgsType: null,
      },
      {
        id: "b",
        requestDate: "2026-07-17T12:00:02.000Z",
        code: 5359,
        description: "1_RELATORIO",
        zipFile: "doc",
        zipFileName: "1_file.xls",
        zipFileIsTemporary: true,
        requestContext: null,
        status: "ReadyForDownload",
        errorOutput: null,
        requestContextArgs: null,
        requestContextArgsType: null,
      },
    ];
    const scored = findScoredExportJobs(items, new Set(), API_REPORT_1, exportStartedAt);
    expect(scored[0]?.item.id).toBe("b");
    expect(scored[0]?.evaluation.score).toBeGreaterThan(scored[1]?.evaluation.score ?? 0);
  });

  it("card preserva progresso e status not-started", () => {
    const source = readFileSync(
      path.resolve("src/components/histograma/DrakeUpdateCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(/event\.type !== "error"/);
    const types = readFileSync(path.resolve("src/lib/drake/update-types.ts"), "utf8");
    expect(types).toMatch(/"not-started"/);
    expect(types).toMatch(/Não iniciado/);
  });
});
