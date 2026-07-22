import "@tanstack/react-start/server-only";
import type { APIRequestContext } from "playwright";
import { env } from "./config.server";
import { describeResponseShape } from "./drake-http.server";
import {
  ensureBackgroundJobsRoute,
  getActiveBackgroundJobsPath,
  getLastBackgroundJobsProbe,
  requestBackgroundJobs,
  resetBackgroundJobsRouteSelection,
  switchToAlternateBackgroundJobsRoute,
} from "./background-jobs-endpoint.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger, shortId } from "./logger";
import { BACKGROUND_EXPORT_CODE } from "./report-contracts";
import { sanitizeSensitiveText } from "./sanitize-error.server";
import { normalizeText } from "./text";
import type { BackgroundExecutionRequestItem, DrakeApiReportDefinition } from "./api-report-types";
import {
  DRAKE_BACKGROUND_JOB_FAILED,
  DRAKE_BACKGROUND_JOB_NOT_CREATED,
  DRAKE_EXPORT_TIMEOUT,
  BACKGROUND_JOBS_INVALID_RESPONSE,
} from "./update-types";

export { resetBackgroundJobsRouteSelection };
export type JobRejectionReason =
  | "EXISTED_IN_BASELINE"
  | "CREATED_BEFORE_EXPORT"
  | "REPORT_CODE_MISMATCH"
  | "REPORT_NAME_MISMATCH"
  | "REQUEST_CONTEXT_MISMATCH"
  | "STATUS_NOT_FINAL"
  | "MISSING_FILE_REFERENCE"
  | "HAS_ERROR_OUTPUT"
  | "INVALID_DATE"
  | "UNKNOWN_STATUS"
  | "LOW_CONFIDENCE"
  | "OTHER_REPORT";

export interface JobEvaluation {
  idHash: string | null;
  requestDate: string;
  status: string;
  hasZipFile: boolean;
  hasZipFileName: boolean;
  hasErrorOutput: boolean;
  descriptionMatches: boolean;
  queryCodeMatches: boolean;
  queryNameMatches: boolean;
  requestContextMatches: boolean;
  createdAfterExport: boolean;
  createdAfterExportWithTolerance: boolean;
  existedInBaseline: boolean;
  score: number;
  accepted: boolean;
  rejectionReasons: JobRejectionReason[];
  clockSkewAppliedMs: number;
  exportStartedAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractJobArray(payload: unknown): { items: unknown[]; rootType: string; keys: string[] } {
  if (Array.isArray(payload)) {
    return { items: payload, rootType: "array", keys: [] };
  }
  if (isRecord(payload)) {
    const keys = Object.keys(payload);
    for (const key of ["items", "data", "results", "value", "requests"]) {
      const v = payload[key];
      if (Array.isArray(v)) {
        return { items: v, rootType: "object", keys };
      }
    }
    return { items: [], rootType: "object", keys };
  }
  return { items: [], rootType: typeof payload, keys: [] };
}

export function parseBackgroundItems(payload: unknown): BackgroundExecutionRequestItem[] {
  const { items: source } = extractJobArray(payload);
  const items: BackgroundExecutionRequestItem[] = [];
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const id = typeof entry["id"] === "string" ? entry["id"] : null;
    if (!id) continue;
    items.push({
      requestDate: String(entry["requestDate"] ?? ""),
      code: Number(entry["code"] ?? BACKGROUND_EXPORT_CODE),
      description: typeof entry["description"] === "string" ? entry["description"] : null,
      zipFile: typeof entry["zipFile"] === "string" ? entry["zipFile"] : null,
      zipFileName: typeof entry["zipFileName"] === "string" ? entry["zipFileName"] : null,
      zipFileIsTemporary:
        typeof entry["zipFileIsTemporary"] === "boolean" ? entry["zipFileIsTemporary"] : null,
      requestContext: typeof entry["requestContext"] === "string" ? entry["requestContext"] : null,
      status: String(entry["status"] ?? ""),
      errorOutput: typeof entry["errorOutput"] === "string" ? entry["errorOutput"] : null,
      requestContextArgs: entry["requestContextArgs"] ?? null,
      requestContextArgsType:
        typeof entry["requestContextArgsType"] === "string"
          ? entry["requestContextArgsType"]
          : null,
      id,
    });
  }
  return items;
}

export function assertBackgroundJobsPayload(payload: unknown): BackgroundExecutionRequestItem[] {
  const extracted = extractJobArray(payload);
  const shape = describeResponseShape(payload);
  if (
    extracted.rootType !== "array" &&
    !(extracted.rootType === "object" && extracted.items.length >= 0 && extracted.keys.length > 0)
  ) {
    throw new DrakeIntegrationError({
      code: BACKGROUND_JOBS_INVALID_RESPONSE,
      message: "Resposta inesperada do endpoint de background jobs.",
      stage: "polling-background-job",
      details: {
        rootType: extracted.rootType,
        keys: extracted.keys,
        responseShape: shape,
        preview: sanitizeSensitiveText(JSON.stringify(payload)).slice(0, 500),
      },
    });
  }
  // Objeto sem array conhecido e sem parecer lista vazia válida
  if (
    extracted.rootType === "object" &&
    extracted.items.length === 0 &&
    !extracted.keys.some((k) => ["items", "data", "results", "value", "requests"].includes(k)) &&
    extracted.keys.length > 0
  ) {
    throw new DrakeIntegrationError({
      code: BACKGROUND_JOBS_INVALID_RESPONSE,
      message: "Formato do endpoint de jobs nao reconhecido.",
      stage: "polling-background-job",
      details: {
        rootType: extracted.rootType,
        keys: extracted.keys,
        responseShape: shape,
      },
    });
  }
  return parseBackgroundItems(payload);
}

export async function fetchBackgroundJobs(
  request: APIRequestContext,
  options?: { reportCode?: number; stage?: string; path?: string },
): Promise<BackgroundExecutionRequestItem[]> {
  await ensureBackgroundJobsRoute(request);
  const path = options?.path ?? getActiveBackgroundJobsPath();
  const result = await requestBackgroundJobs(request, path, {
    stage: options?.stage ?? "fetch-background-jobs",
    reportCode: options?.reportCode,
  });
  if (!result.ok) {
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Falha ao consultar jobs de background (status ${result.status}).`,
      stage: options?.stage ?? "fetch-background-jobs",
      reportCode: options?.reportCode,
      details: {
        status: result.status,
        responseKind: result.responseKind,
        path: result.path,
        backgroundCode: BACKGROUND_EXPORT_CODE,
      },
    });
  }
  return assertBackgroundJobsPayload(result.json);
}

function defaultSuccessStatuses(): string[] {
  const configured = env.DRAKE_BACKGROUND_SUCCESS_STATUSES.map((s) => normalizeText(s));
  return configured.length > 0 ? configured : ["readyfordownload"];
}

function defaultFailureStatuses(): string[] {
  const configured = env.DRAKE_BACKGROUND_FAILURE_STATUSES.map((s) => normalizeText(s));
  return configured.length > 0
    ? configured
    : ["failed", "error", "cancelled", "canceled", "aborted"];
}

export function isTerminalSuccessStatus(status: string): boolean {
  return defaultSuccessStatuses().includes(normalizeText(status));
}

export function isTerminalFailureStatus(status: string): boolean {
  return defaultFailureStatuses().includes(normalizeText(status));
}

function matchSignals(
  item: BackgroundExecutionRequestItem,
  report: DrakeApiReportDefinition,
): {
  descriptionMatches: boolean;
  queryCodeMatches: boolean;
  queryNameMatches: boolean;
  requestContextMatches: boolean;
} {
  const desc = normalizeText(item.description ?? "");
  const zip = normalizeText(item.zipFileName ?? "");
  const ctx = normalizeText(item.requestContext ?? "");
  const blob = `${desc} ${zip} ${ctx}`;
  const name = normalizeText(report.name);
  const code = String(report.code);
  const queryIdNorm = normalizeText(report.queryId);

  const descriptionMatches = Boolean(name && desc.includes(name));
  const queryNameMatches = Boolean(name && blob.includes(name));
  const queryCodeMatches =
    blob.includes(` ${code} `) ||
    blob.startsWith(`${code}_`) ||
    blob.includes(`_${code}_`) ||
    zip.startsWith(`${code}_`) ||
    desc.startsWith(`${code}_`) ||
    desc.startsWith(`${code} `) ||
    new RegExp(`(^|[^0-9])${code}([^0-9]|$)`).test(blob);
  const requestContextMatches = Boolean(
    (queryIdNorm && ctx.includes(queryIdNorm.slice(0, 8))) ||
    (queryIdNorm && ctx.includes(queryIdNorm)),
  );

  return { descriptionMatches, queryCodeMatches, queryNameMatches, requestContextMatches };
}

export function evaluateJobCandidate(
  item: BackgroundExecutionRequestItem,
  baselineIds: Set<string>,
  report: DrakeApiReportDefinition,
  exportStartedAt: Date,
  baselineSnapshots?: Map<string, { requestDate: string; status: string }>,
): JobEvaluation {
  const clockSkewAppliedMs = env.DRAKE_JOB_CLOCK_SKEW_MS;
  const startedMs = exportStartedAt.getTime() - clockSkewAppliedMs;
  const requestMs = Date.parse(item.requestDate);
  const hasValidDate = Number.isFinite(requestMs);
  const createdAfterExportWithTolerance = hasValidDate ? requestMs >= startedMs : true;
  const createdAfterExport = hasValidDate ? requestMs >= exportStartedAt.getTime() : true;
  const existedInBaseline = baselineIds.has(item.id);
  const baselineSnap = baselineSnapshots?.get(item.id);
  const refreshedInPlace =
    Boolean(baselineSnap) &&
    ((baselineSnap!.requestDate &&
      item.requestDate &&
      item.requestDate !== baselineSnap!.requestDate &&
      createdAfterExportWithTolerance) ||
      (baselineSnap!.status &&
        item.status &&
        item.status !== baselineSnap!.status &&
        createdAfterExportWithTolerance));

  const signals = matchSignals(item, report);
  const rejectionReasons: JobRejectionReason[] = [];
  let score = 0;

  if (existedInBaseline && !refreshedInPlace) {
    rejectionReasons.push("EXISTED_IN_BASELINE");
  } else {
    score += 50;
  }

  if (!hasValidDate) {
    // data inválida não é rejeição absoluta — apenas não pontua tempo
  } else if (!createdAfterExportWithTolerance && !refreshedInPlace) {
    rejectionReasons.push("CREATED_BEFORE_EXPORT");
  } else {
    score += 30;
  }

  if (refreshedInPlace) {
    score += 40;
  }

  const hasZipFile = Boolean(item.zipFile);
  const hasZipFileName = Boolean(item.zipFileName);
  if (hasZipFile && hasZipFileName) score += 30;

  if (signals.descriptionMatches || signals.queryNameMatches) score += 20;
  if (signals.requestContextMatches) score += 20;
  if (signals.queryCodeMatches) score += 20;
  if (signals.queryNameMatches) score += 10;

  const hasErrorOutput = Boolean(item.errorOutput?.trim());
  if (hasErrorOutput) rejectionReasons.push("HAS_ERROR_OUTPUT");

  const otherCode = report.code === 1 ? 14 : 1;
  const zip = normalizeText(item.zipFileName ?? "");
  const desc = normalizeText(item.description ?? "");
  if (
    (zip.startsWith(`${otherCode}_`) || desc.startsWith(`${otherCode}_`)) &&
    !signals.queryCodeMatches &&
    !signals.queryNameMatches
  ) {
    rejectionReasons.push("OTHER_REPORT");
    rejectionReasons.push("REPORT_CODE_MISMATCH");
  }

  const absoluteReject =
    (existedInBaseline && !refreshedInPlace) ||
    rejectionReasons.includes("CREATED_BEFORE_EXPORT") ||
    hasErrorOutput ||
    rejectionReasons.includes("OTHER_REPORT");

  const looksLikeReport =
    signals.descriptionMatches ||
    signals.queryCodeMatches ||
    signals.queryNameMatches ||
    signals.requestContextMatches;

  if (!looksLikeReport && !absoluteReject) {
    rejectionReasons.push("LOW_CONFIDENCE");
  }

  const accepted = !absoluteReject && looksLikeReport && score >= 50;

  return {
    idHash: shortId(item.id),
    requestDate: item.requestDate,
    status: item.status,
    hasZipFile,
    hasZipFileName,
    hasErrorOutput,
    descriptionMatches: signals.descriptionMatches,
    queryCodeMatches: signals.queryCodeMatches,
    queryNameMatches: signals.queryNameMatches,
    requestContextMatches: signals.requestContextMatches,
    createdAfterExport,
    createdAfterExportWithTolerance,
    existedInBaseline,
    score,
    accepted,
    rejectionReasons: [...new Set(rejectionReasons)],
    clockSkewAppliedMs,
    exportStartedAt: exportStartedAt.toISOString(),
  };
}

export function findScoredExportJobs(
  items: BackgroundExecutionRequestItem[],
  baselineIds: Set<string>,
  report: DrakeApiReportDefinition,
  exportStartedAt: Date,
  baselineSnapshots?: Map<string, { requestDate: string; status: string }>,
): Array<{ item: BackgroundExecutionRequestItem; evaluation: JobEvaluation }> {
  const evaluated = items.map((item) => ({
    item,
    evaluation: evaluateJobCandidate(item, baselineIds, report, exportStartedAt, baselineSnapshots),
  }));
  return evaluated
    .filter((row) => row.evaluation.accepted)
    .sort((a, b) => {
      if (b.evaluation.score !== a.evaluation.score) return b.evaluation.score - a.evaluation.score;
      return Date.parse(b.item.requestDate) - Date.parse(a.item.requestDate);
    });
}

/** Compat: retorna o melhor candidato aceito. */
export function findNewExportJob(
  items: BackgroundExecutionRequestItem[],
  baselineIds: Set<string>,
  report: DrakeApiReportDefinition,
  exportStartedAt: Date,
  baselineSnapshots?: Map<string, { requestDate: string; status: string }>,
): BackgroundExecutionRequestItem | null {
  return (
    findScoredExportJobs(items, baselineIds, report, exportStartedAt, baselineSnapshots)[0]?.item ??
    null
  );
}

export interface PollingSummary {
  pollAttempts: number;
  elapsedMs: number;
  totalDistinctJobsObserved: number;
  newJobsObserved: number;
  candidateJobsObserved: number;
  lastObservedStatuses: string[];
  lastCandidateRejectionReasons: JobRejectionReason[];
  strategyUsed?: string;
}

export async function waitForExportJob(
  request: APIRequestContext,
  report: DrakeApiReportDefinition,
  baselineIds: Set<string>,
  exportStartedAt: Date,
  timeoutMs: number,
  options?: {
    strategyUsed?: string;
    baselineSnapshots?: Map<string, { requestDate: string; status: string }>;
    exportHttpStatus?: number | null;
    exportHadBody?: boolean;
    signalRProvided?: boolean;
    onNoNewJob?: () => Promise<{
      baselineIds: Set<string>;
      exportStartedAt: Date;
      baselineSnapshots: Map<string, { requestDate: string; status: string }>;
    } | null>;
  },
): Promise<BackgroundExecutionRequestItem> {
  await ensureBackgroundJobsRoute(request);
  const appearTimeoutMs = env.DRAKE_INITIAL_JOB_APPEAR_TIMEOUT_MS;
  const emptyBeforeFallback = env.DRAKE_EMPTY_JOB_POLLS_BEFORE_FALLBACK;
  const emptyBeforeFailure = env.DRAKE_EMPTY_JOB_POLLS_BEFORE_FAILURE;

  logger.info("drake-polling", `Exportacao do relatorio ${report.code} em processamento`, {
    reportCode: report.code,
    stage: "polling-background-job",
    timeoutMs,
    appearTimeoutMs,
    selectedRoute: getActiveBackgroundJobsPath(),
    strategyUsed: options?.strategyUsed,
  });

  // Deadline: se nunca aparecer job, usa appearTimeout; se aparecer, usa timeoutMs total.
  let deadline = Date.now() + Math.min(timeoutMs, appearTimeoutMs);
  let appearDeadline = Date.now() + appearTimeoutMs;
  let jobSeen = false;
  const started = Date.now();
  let pollAttempt = 0;
  let consecutiveEmptyPolls = 0;
  let triedAlternateRoute = false;
  let sawCandidate = false;
  let didRetryExport = false;
  let activeBaselineIds = baselineIds;
  let activeExportStartedAt = exportStartedAt;
  let activeSnapshots =
    options?.baselineSnapshots ?? new Map<string, { requestDate: string; status: string }>();
  const observedStatuses = new Set<string>();
  const observedIds = new Set<string>();
  const newIds = new Set<string>();
  const candidateIds = new Set<string>();
  let lastRejectionReasons: JobRejectionReason[] = [];
  let previousCandidateStatus: string | null = null;

  while (Date.now() < deadline) {
    pollAttempt += 1;
    const elapsedMs = Date.now() - started;
    const items = await fetchBackgroundJobs(request, {
      reportCode: report.code,
      stage: "polling-background-job",
    });

    if (items.length === 0) {
      consecutiveEmptyPolls += 1;
      const shouldLogEmpty =
        consecutiveEmptyPolls <= 3 ||
        consecutiveEmptyPolls % 5 === 0 ||
        consecutiveEmptyPolls === emptyBeforeFallback ||
        consecutiveEmptyPolls === emptyBeforeFailure;
      if (shouldLogEmpty) {
        logger.info("drake-polling", "Nenhum job retornado", {
          reportCode: report.code,
          stage: "waiting-background-job-creation",
          selectedRoute: getActiveBackgroundJobsPath(),
          pollAttempt,
          consecutiveEmptyPolls,
          elapsedMs,
          backgroundCode: BACKGROUND_EXPORT_CODE,
        });
      }

      if (!triedAlternateRoute && consecutiveEmptyPolls >= emptyBeforeFallback) {
        triedAlternateRoute = true;
        await switchToAlternateBackgroundJobsRoute(request);
      }

      if (
        consecutiveEmptyPolls >= emptyBeforeFailure ||
        (!jobSeen && Date.now() >= appearDeadline)
      ) {
        if (!didRetryExport && options?.onNoNewJob) {
          didRetryExport = true;
          logger.warn("drake-export", "Nenhum job apareceu; repetindo exportacao uma unica vez", {
            reportCode: report.code,
            consecutiveEmptyPolls,
            elapsedMs,
          });
          const refreshed = await options.onNoNewJob();
          if (refreshed) {
            activeBaselineIds = refreshed.baselineIds;
            activeExportStartedAt = refreshed.exportStartedAt;
            activeSnapshots = refreshed.baselineSnapshots;
            consecutiveEmptyPolls = 0;
            appearDeadline = Date.now() + appearTimeoutMs;
            deadline = Date.now() + appearTimeoutMs;
            await sleep(env.DRAKE_POLL_INTERVAL_MS);
            continue;
          }
        }

        const probe = getLastBackgroundJobsProbe();
        logger.error("drake-update", "Atualizacao interrompida", {
          reportCode: report.code,
          stage: "waiting-background-job-creation",
          errorCode: DRAKE_BACKGROUND_JOB_NOT_CREATED,
          exportHttpStatus: options?.exportHttpStatus ?? null,
          exportHadBody: options?.exportHadBody ?? null,
          signalRProvided: options?.signalRProvided ?? null,
          primaryRouteItemCount: probe?.primary.itemCount ?? null,
          fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
          pollAttempts: pollAttempt,
          consecutiveEmptyPolls,
          elapsedMs,
          selectedRoute: getActiveBackgroundJobsPath(),
        });
        throw new DrakeIntegrationError({
          code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
          message:
            "A exportacao foi aceita, mas nenhum job apareceu no endpoint de processamento em segundo plano.",
          stage: "waiting-background-job-creation",
          reportCode: report.code,
          details: {
            selectedRoute: getActiveBackgroundJobsPath(),
            primaryRouteItemCount: probe?.primary.itemCount ?? null,
            fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
            pollAttempts: pollAttempt,
            consecutiveEmptyPolls,
            elapsedMs,
            backgroundCode: BACKGROUND_EXPORT_CODE,
            strategyUsed: options?.strategyUsed,
            exportHttpStatus: options?.exportHttpStatus ?? null,
            exportHadBody: options?.exportHadBody ?? null,
            signalRProvided: options?.signalRProvided ?? null,
          },
        });
      }

      await sleep(env.DRAKE_POLL_INTERVAL_MS);
      continue;
    }

    consecutiveEmptyPolls = 0;
    if (!jobSeen) {
      jobSeen = true;
      // Job apareceu (ou há histórico): usar timeout total de conclusão.
      deadline = started + timeoutMs;
      logger.info("drake-polling", "Jobs presentes; aplicando timeout de conclusao", {
        reportCode: report.code,
        totalJobsReturned: items.length,
        timeoutMs,
      });
    }

    for (const item of items) {
      observedIds.add(item.id);
      const status = item.status || "(empty)";
      if (!observedStatuses.has(status)) {
        observedStatuses.add(status);
        logger.info("drake-polling", "Novo status de background job observado", {
          reportCode: report.code,
          stage: "polling-background-job",
          status: sanitizeSensitiveText(status).slice(0, 80),
          jobIdHash: shortId(item.id),
          hasFile: Boolean(item.zipFile && item.zipFileName),
          hasError: Boolean(item.errorOutput),
        });
      }
      if (!activeBaselineIds.has(item.id)) newIds.add(item.id);
    }

    const scored = items.map((item) => ({
      item,
      evaluation: evaluateJobCandidate(
        item,
        activeBaselineIds,
        report,
        activeExportStartedAt,
        activeSnapshots,
      ),
    }));
    const accepted = scored.filter((row) => row.evaluation.accepted);
    const rejectedNew = scored.filter((row) => !row.evaluation.accepted);

    for (const row of accepted) candidateIds.add(row.item.id);

    if (accepted.length > 0) sawCandidate = true;

    // Sem job novo aceito após appear timeout → retry/falha específica
    if (!sawCandidate && newIds.size === 0 && Date.now() >= appearDeadline) {
      if (!didRetryExport && options?.onNoNewJob) {
        didRetryExport = true;
        logger.warn(
          "drake-export",
          "Nenhum job novo apareceu; repetindo exportacao uma unica vez",
          { reportCode: report.code, elapsedMs, pollAttempt },
        );
        const refreshed = await options.onNoNewJob();
        if (refreshed) {
          activeBaselineIds = refreshed.baselineIds;
          activeExportStartedAt = refreshed.exportStartedAt;
          activeSnapshots = refreshed.baselineSnapshots;
          appearDeadline = Date.now() + appearTimeoutMs;
          deadline = Date.now() + appearTimeoutMs;
          jobSeen = false;
          await sleep(env.DRAKE_POLL_INTERVAL_MS);
          continue;
        }
      }
      const probe = getLastBackgroundJobsProbe();
      logger.error("drake-update", "Atualizacao interrompida", {
        reportCode: report.code,
        stage: "waiting-background-job-creation",
        errorCode: DRAKE_BACKGROUND_JOB_NOT_CREATED,
        exportHttpStatus: options?.exportHttpStatus ?? null,
        exportHadBody: options?.exportHadBody ?? null,
        signalRProvided: options?.signalRProvided ?? null,
        primaryRouteItemCount: probe?.primary.itemCount ?? null,
        fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
        pollAttempts: pollAttempt,
        consecutiveEmptyPolls,
        elapsedMs,
        selectedRoute: getActiveBackgroundJobsPath(),
      });
      throw new DrakeIntegrationError({
        code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
        message:
          "A exportacao foi aceita, mas nenhum job apareceu no endpoint de processamento em segundo plano.",
        stage: "waiting-background-job-creation",
        reportCode: report.code,
        details: {
          selectedRoute: getActiveBackgroundJobsPath(),
          primaryRouteItemCount: probe?.primary.itemCount ?? null,
          fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
          pollAttempts: pollAttempt,
          consecutiveEmptyPolls,
          elapsedMs,
          totalJobsReturned: items.length,
          newJobsObserved: newIds.size,
          lastCandidateRejectionReasons: lastRejectionReasons,
          backgroundCode: BACKGROUND_EXPORT_CODE,
          exportHttpStatus: options?.exportHttpStatus ?? null,
          exportHadBody: options?.exportHadBody ?? null,
          signalRProvided: options?.signalRProvided ?? null,
        },
      });
    }

    const shouldLogCycle =
      pollAttempt <= 3 || pollAttempt % 5 === 0 || accepted.length > 0 || env.DRAKE_DEBUG_POLLING;

    if (shouldLogCycle) {
      logger.info("drake-polling", `Ciclo ${pollAttempt}`, {
        reportCode: report.code,
        stage: "polling-background-job",
        pollAttempt,
        elapsedMs,
        selectedRoute: getActiveBackgroundJobsPath(),
        totalJobsReturned: items.length,
        newJobsSinceBaseline: items.filter((i) => !activeBaselineIds.has(i.id)).length,
        candidateJobs: accepted.length,
        rejectedJobs: rejectedNew.length,
        completedCandidates: accepted.filter((r) => isTerminalSuccessStatus(r.item.status)).length,
        failedCandidates: accepted.filter(
          (r) => isTerminalFailureStatus(r.item.status) || r.evaluation.hasErrorOutput,
        ).length,
      });
    }

    for (const row of [...accepted, ...rejectedNew].slice(0, 8)) {
      if (env.DRAKE_DEBUG_POLLING || row.evaluation.accepted || pollAttempt <= 3) {
        logger.info("drake-polling", "Job candidato avaliado", {
          reportCode: report.code,
          stage: "polling-background-job",
          ...row.evaluation,
          rejectionReasons: row.evaluation.rejectionReasons,
        });
      }
      lastRejectionReasons = row.evaluation.rejectionReasons;
    }

    for (const row of accepted) {
      const candidate = row.item;
      if (candidate.errorOutput?.trim()) {
        const sanitized = sanitizeSensitiveText(candidate.errorOutput).slice(0, 2000);
        logger.error(
          "drake-polling",
          `O Drake retornou erro durante a exportacao do relatorio ${report.code}`,
          {
            reportCode: report.code,
            stage: "polling-background-job",
            jobIdHash: shortId(candidate.id),
            status: candidate.status,
            sanitizedErrorOutput: sanitized,
          },
        );
        throw new DrakeIntegrationError({
          code: DRAKE_BACKGROUND_JOB_FAILED,
          message: `O Drake retornou erro durante a exportacao do relatorio ${report.code}.`,
          stage: "polling-background-job",
          reportCode: report.code,
          details: {
            jobIdHash: shortId(candidate.id),
            status: candidate.status,
            sanitizedErrorOutput: sanitized,
          },
        });
      }

      if (previousCandidateStatus && previousCandidateStatus !== candidate.status) {
        logger.info("drake-polling", "Status alterado", {
          reportCode: report.code,
          previous: previousCandidateStatus,
          current: candidate.status,
          jobIdHash: shortId(candidate.id),
        });
      }
      previousCandidateStatus = candidate.status;

      if (isTerminalSuccessStatus(candidate.status)) {
        if (candidate.zipFile && candidate.zipFileName) {
          logger.info("drake-polling", "Job de exportacao localizado", {
            reportCode: report.code,
            stage: "polling-background-job",
            jobIdHash: shortId(candidate.id),
            status: candidate.status,
            hasDocumentReference: true,
            fileNameExtension: candidate.zipFileName.includes(".")
              ? candidate.zipFileName.slice(candidate.zipFileName.lastIndexOf("."))
              : null,
            pollingDurationMs: Date.now() - started,
            score: row.evaluation.score,
          });
          return candidate;
        }
        logger.info("drake-polling", "Job candidato sem referencia de arquivo", {
          reportCode: report.code,
          status: candidate.status,
          rejectionReasons: ["MISSING_FILE_REFERENCE"],
        });
      } else if (isTerminalFailureStatus(candidate.status)) {
        throw new DrakeIntegrationError({
          code: DRAKE_BACKGROUND_JOB_FAILED,
          message: `Exportacao do relatorio ${report.code} falhou com status ${candidate.status}.`,
          stage: "polling-background-job",
          reportCode: report.code,
          details: { status: candidate.status, jobIdHash: shortId(candidate.id) },
        });
      }
    }

    await sleep(env.DRAKE_POLL_INTERVAL_MS);
  }

  const probe = getLastBackgroundJobsProbe();
  const summary: PollingSummary = {
    pollAttempts: pollAttempt,
    elapsedMs: Date.now() - started,
    totalDistinctJobsObserved: observedIds.size,
    newJobsObserved: newIds.size,
    candidateJobsObserved: candidateIds.size,
    lastObservedStatuses: [...observedStatuses],
    lastCandidateRejectionReasons: lastRejectionReasons,
    strategyUsed: options?.strategyUsed,
  };

  if (!sawCandidate || newIds.size === 0) {
    logger.error("drake-update", "Atualizacao interrompida", {
      reportCode: report.code,
      stage: "waiting-background-job-creation",
      errorCode: DRAKE_BACKGROUND_JOB_NOT_CREATED,
      exportHttpStatus: options?.exportHttpStatus ?? null,
      exportHadBody: options?.exportHadBody ?? null,
      signalRProvided: options?.signalRProvided ?? null,
      primaryRouteItemCount: probe?.primary.itemCount ?? null,
      fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
      pollAttempts: pollAttempt,
      consecutiveEmptyPolls,
      elapsedMs: summary.elapsedMs,
    });
    throw new DrakeIntegrationError({
      code: DRAKE_BACKGROUND_JOB_NOT_CREATED,
      message:
        "A exportacao foi aceita, mas nenhum job apareceu no endpoint de processamento em segundo plano.",
      stage: "waiting-background-job-creation",
      reportCode: report.code,
      details: {
        ...summary,
        selectedRoute: getActiveBackgroundJobsPath(),
        primaryRouteItemCount: probe?.primary.itemCount ?? null,
        fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
        consecutiveEmptyPolls,
        backgroundCode: BACKGROUND_EXPORT_CODE,
        exportHttpStatus: options?.exportHttpStatus ?? null,
        exportHadBody: options?.exportHadBody ?? null,
        signalRProvided: options?.signalRProvided ?? null,
      },
    });
  }

  logger.error("drake-polling", "Timeout aguardando exportacao", {
    reportCode: report.code,
    stage: "polling-background-job",
    timeoutMs,
    ...summary,
    selectedRoute: getActiveBackgroundJobsPath(),
    sawCandidate,
  });

  throw new DrakeIntegrationError({
    code: DRAKE_EXPORT_TIMEOUT,
    message: "Nenhum job concluido correspondente ao relatorio foi encontrado dentro do prazo.",
    stage: "polling-background-job",
    reportCode: report.code,
    details: {
      ...summary,
      selectedRoute: getActiveBackgroundJobsPath(),
      sawCandidate,
    },
  });
}

export async function summarizeBaseline(
  items: BackgroundExecutionRequestItem[],
  reportCode?: number,
): Promise<{
  totalJobs: number;
  validJobs: number;
  jobsWithError: number;
  jobsWithFile: number;
  newestRequestDate: string | null;
  baselineIdCount: number;
}> {
  const validJobs = items.filter((i) => Boolean(i.id)).length;
  const jobsWithError = items.filter((i) => Boolean(i.errorOutput)).length;
  const jobsWithFile = items.filter((i) => Boolean(i.zipFile && i.zipFileName)).length;
  const dates = items
    .map((i) => i.requestDate)
    .filter(Boolean)
    .sort()
    .reverse();
  const summary = {
    totalJobs: items.length,
    validJobs,
    jobsWithError,
    jobsWithFile,
    newestRequestDate: dates[0] ?? null,
    baselineIdCount: items.length,
  };
  const probe = getLastBackgroundJobsProbe();
  if (summary.totalJobs === 0) {
    logger.warn("drake-export", "Baseline de jobs vazio", {
      reportCode,
      stage: "baseline-background-jobs",
      primaryRouteItemCount: probe?.primary.itemCount ?? null,
      fallbackRouteItemCount: probe?.fallback.itemCount ?? null,
      selectedRoute: getActiveBackgroundJobsPath(),
      backgroundCode: BACKGROUND_EXPORT_CODE,
    });
  } else {
    logger.info("drake-export", "Baseline de jobs obtido", {
      reportCode,
      stage: "baseline-background-jobs",
      ...summary,
      selectedRoute: getActiveBackgroundJobsPath(),
    });
  }
  return summary;
}
