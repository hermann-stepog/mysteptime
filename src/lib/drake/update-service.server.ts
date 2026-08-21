import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDrakeApiContextFromAuthenticatedSession,
  isSessionExpiredError,
} from "./api-session.server";
import {
  EnvironmentCredentialsDrakeAuthProvider,
  type AuthProgressStage,
} from "./auth/environment-credentials-auth.server";
import { clearSessionCache } from "./auth/session-cache.server";
import { env } from "./config.server";
import { DrakeIntegrationError, toDrakeIntegrationError } from "./integration-error.server";
import { persistIntegrationFailure } from "./last-error.server";
import { recordDrakeSyncRun } from "./sync-runs.server";
import {
  createExecutionId,
  getDrakeLogContext,
  logger,
  patchDrakeLogContext,
  runWithDrakeLogContext,
} from "./logger";
import { getDrakeUpdateWindow, type DrakeUpdateScope } from "./update-scope";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import { sanitizeError } from "./sanitize-error.server";
import { synchronizeCurrentDrakeAnnualPositions } from "./annual-position-sync.server";
import { API_REPORT_1 } from "./report-contracts";
import { runSingleApiReport } from "./report-api-runner.server";
import { openDrakeSignalRSession } from "./signalr-session.server";
import { parseDrakeWorkbook } from "@/lib/histograma/import-drake";
import {
  DRAKE_ANNUAL_POSITION_SYNC_FAILED,
  DRAKE_STAGE_MESSAGE,
  DRAKE_STAGE_PROGRESS,
  type DrakeProgressCallback,
  type DrakeReportStatus,
  type DrakeUpdateResult,
  type DrakeUpdateStage,
} from "./update-types";

type DbClient = SupabaseClient;

export interface DrakeUpdateTrigger {
  triggeredBy: string | null;
  triggeredByLabel: string | null;
}

/**
 * Atualiza o Histograma Offshore pelas fichas anuais do Drake. Status e datas
 * vêm da Ficha Anual; unidade e BSP de E/D vêm do relatório oficial de
 * embarque por centro de custo.
 */
export async function updateDrakeData(
  db: DbClient,
  onProgress: DrakeProgressCallback,
  trigger: DrakeUpdateTrigger,
  scope: DrakeUpdateScope = "full",
): Promise<DrakeUpdateResult> {
  const existing = getDrakeLogContext();
  const executionId = existing?.executionId ?? createExecutionId();
  const startedAtMs = existing?.startedAtMs ?? Date.now();

  if (existing) return updateDrakeDataInner(db, onProgress, startedAtMs, trigger, scope);
  return runWithDrakeLogContext({ executionId, startedAtMs, stage: "queued", progress: 0 }, () =>
    updateDrakeDataInner(db, onProgress, startedAtMs, trigger, scope),
  );
}

async function updateDrakeDataInner(
  db: DbClient,
  onProgress: DrakeProgressCallback,
  startedAtMs: number,
  trigger: DrakeUpdateTrigger,
  scope: DrakeUpdateScope,
): Promise<DrakeUpdateResult> {
  let apiContext: DrakeHttpClient | null = null;
  let renewedOnce = false;
  let currentStage: DrakeUpdateStage = "queued";
  let currentProgress = 0;
  let annualStatus: DrakeReportStatus = "waiting";

  const emit = async (
    stage: DrakeUpdateStage,
    patch?: { status?: DrakeReportStatus; progress?: number; message?: string },
  ): Promise<void> => {
    if (patch?.status) annualStatus = patch.status;
    currentStage = stage;
    currentProgress = patch?.progress ?? DRAKE_STAGE_PROGRESS[stage];
    patchDrakeLogContext({ stage, progress: currentProgress, reportCode: undefined });
    await onProgress({
      type: "progress",
      stage,
      progress: currentProgress,
      message: patch?.message ?? DRAKE_STAGE_MESSAGE[stage],
      // Mantidos em paralelo para não quebrar consumidores antigos do stream.
      embarkationStatus: annualStatus,
      availabilityStatus: annualStatus,
    });
  };

  async function authenticate(force = false): Promise<void> {
    const authStarted = Date.now();
    if (force) {
      await clearSessionCache();
      renewedOnce = true;
    }
    const provider = new EnvironmentCredentialsDrakeAuthProvider(async (stage: AuthProgressStage) =>
      emit(stage),
    );
    const result = await provider.authenticate();
    const context = apiContext as DrakeHttpClient | null;
    apiContext = null;
    if (context) await context.dispose().catch(() => undefined);
    apiContext = await createDrakeApiContextFromAuthenticatedSession(result.authenticatedSession);
    logger.info("drake-authentication", "Integracao Drake validada", {
      stage: "authenticating",
      durationMs: Date.now() - authStarted,
    });
  }

  async function withSessionRetry<T>(operation: (ctx: DrakeHttpClient) => Promise<T>): Promise<T> {
    if (!apiContext) throw new Error("Contexto HTTP do Drake ausente.");
    try {
      return await operation(apiContext);
    } catch (error: unknown) {
      if (!renewedOnce && isSessionExpiredError(error)) {
        logger.warn("drake-authentication", "Sessao expirada; renovando automaticamente uma vez", {
          stage: currentStage,
        });
        await authenticate(true);
        return operation(apiContext!);
      }
      throw error;
    }
  }

  try {
    await emit("queued");
    await authenticate(false);

    const period = getDrakeUpdateWindow(scope, env.DRAKE_TIMEZONE);
    const year = Number(period.startDate.slice(0, 4));
    await emit("preparing-period", { status: "processing" });
    const embarkationRows = await withSessionRetry(async (ctx) => {
      const signalR = await openDrakeSignalRSession(ctx);
      try {
        const report = await runSingleApiReport(ctx, API_REPORT_1, {
          signalRSession: signalR,
          period: { startDate: period.startDate, endDate: period.endDate },
        });
        return parseDrakeWorkbook(report.buffer);
      } finally {
        await signalR.close().catch(() => undefined);
      }
    });
    await emit("loading-workers", { status: "processing" });

    const syncStarted = Date.now();
    let lastEmittedWorkerProgress = -1;
    let lastEmittedTimesheetProgress = -1;
    const summary = await withSessionRetry((ctx) =>
      synchronizeCurrentDrakeAnnualPositions(
        db,
        ctx,
        year,
        period.startDate,
        embarkationRows,
        {
          onWorkersLoaded: async (totalWorkers) => {
            await emit("loading-annual-positions", {
              status: "downloading",
              message: `Carregando fichas anuais de ${totalWorkers} colaboradores...`,
            });
          },
          onWorkerProgress: async ({ completedWorkers, totalWorkers }) => {
            const progress = 25 + Math.floor((completedWorkers / totalWorkers) * 59);
            if (progress === lastEmittedWorkerProgress && completedWorkers < totalWorkers) return;
            lastEmittedWorkerProgress = progress;
            await emit("loading-annual-positions", {
              status: "downloading",
              progress,
              message: `Carregando fichas anuais (${completedWorkers}/${totalWorkers})...`,
            });
          },
          onPositionsLoaded: async () => {
            await emit("validating-annual-position", { status: "validating" });
          },
          onBeforeDatabaseSync: async () => {
            await emit("synchronizing-annual-position", { status: "importing" });
          },
          onTimesheetSyncProgress: async ({ completedWorkers, totalWorkers }) => {
            const progress = Math.min(
              97,
              92 + Math.floor((completedWorkers / totalWorkers) * 5),
            );
            if (
              progress === lastEmittedTimesheetProgress &&
              completedWorkers < totalWorkers
            ) return;
            lastEmittedTimesheetProgress = progress;
            await emit("synchronizing-annual-position", {
              status: "importing",
              progress,
              message: `Sincronizando timesheets (${completedWorkers}/${totalWorkers} colaboradores)...`,
            });
          },
        },
        period.asOfDate,
        period.endDate,
      ),
    );

    await emit("annual-position-completed", { status: "completed" });
    await emit("finalizing", { status: "completed" });

    const result: DrakeUpdateResult = {
      scope,
      created: summary.createdWorkers,
      updated: summary.updatedWorkers,
      annualPositionEvents: summary.synchronizedEvents,
      annualPositionWorkers: summary.processedWorkers,
      removedStaleEvents: summary.removedStaleEvents,
      totalDurationMs: Date.now() - startedAtMs,
      skipped: summary.skippedExistingDays,
    };

    logger.info("drake-update", "Atualizacao da ficha anual Drake concluida", {
      stage: "completed",
      totalDurationMs: result.totalDurationMs,
      syncDurationMs: Date.now() - syncStarted,
      workers: summary.processedWorkers,
      events: summary.synchronizedEvents,
      removedStaleEvents: summary.removedStaleEvents,
      preservedExistingEvents: summary.preservedExistingEvents,
      skippedExistingDays: summary.skippedExistingDays,
    });
    await recordDrakeSyncRun(db, {
      startedAtMs,
      status: "success",
      triggeredBy: trigger.triggeredBy,
      triggeredByLabel: trigger.triggeredByLabel,
      embarquesCriados: summary.createdWorkers,
      embarquesAtualizados: summary.updatedWorkers,
      embarquesEventos: summary.synchronizedEvents,
      skipped: summary.skippedExistingDays,
    });
    return result;
  } catch (error: unknown) {
    const safe = sanitizeError(error);
    const integration =
      error instanceof DrakeIntegrationError
        ? error
        : toDrakeIntegrationError(error, {
            code: DRAKE_ANNUAL_POSITION_SYNC_FAILED,
            stage: currentStage,
            progress: currentProgress,
          });

    logger.error("drake-update", "Atualizacao da ficha anual interrompida", {
      stage: integration.stage,
      errorCode: integration.code,
      errorName: safe.name,
      sanitizedMessage: integration.message,
      sanitizedStack: env.DRAKE_LOG_LEVEL === "debug" ? safe.stack : undefined,
      causeCode: safe.code,
      progress: integration.progress ?? currentProgress,
      elapsedMs: Date.now() - startedAtMs,
      details: integration.details,
    });
    await persistIntegrationFailure(integration).catch(() => undefined);
    await recordDrakeSyncRun(db, {
      startedAtMs,
      status: "error",
      triggeredBy: trigger.triggeredBy,
      triggeredByLabel: trigger.triggeredByLabel,
      skipped: 0,
      errorMessage: integration.message,
    });

    (
      integration as DrakeIntegrationError & { embarkationStatus?: DrakeReportStatus }
    ).embarkationStatus = "failed";
    (
      integration as DrakeIntegrationError & { availabilityStatus?: DrakeReportStatus }
    ).availabilityStatus = "failed";
    throw integration;
  } finally {
    const context = apiContext as DrakeHttpClient | null;
    apiContext = null;
    if (context) await context.dispose().catch(() => undefined);
  }
}

/** @deprecated Use updateDrakeData */
export const runDrakeDataUpdate = updateDrakeData;
