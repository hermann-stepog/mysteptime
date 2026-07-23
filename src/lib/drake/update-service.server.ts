import "@tanstack/react-start/server-only";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDrakeApiContextFromAuthenticatedSession, isSessionExpiredError } from "./api-session.server";
import {
  EnvironmentCredentialsDrakeAuthProvider,
  type AuthProgressStage,
} from "./auth/environment-credentials-auth.server";
import {
  DrakeAuthError,
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  DRAKE_INTERACTIVE_AUTH_REQUIRED,
} from "./auth/errors";
import { clearSessionCache } from "./auth/session-cache.server";
import type { StorageState } from "./auth/types";
import { env } from "./config.server";
import {
  cleanupDrakeRunFiles,
  createDrakeRunFiles,
  isTempStorageError,
  removeFileIfExists,
  runWithDrakeFiles,
  type DrakeRunFiles,
} from "./drake-files.server";
import { DrakeIntegrationError, toDrakeIntegrationError } from "./integration-error.server";
import { persistIntegrationFailure } from "./last-error.server";
import {
  createExecutionId,
  getDrakeLogContext,
  logger,
  patchDrakeLogContext,
  runWithDrakeLogContext,
} from "./logger";
import { getApiPeriodDates } from "./report-parameter-builder";
import { API_REPORT_1, API_REPORT_14 } from "./report-contracts";
import { runSingleApiReport } from "./report-api-runner.server";
import { openDrakeSignalRSession, type DrakeSignalRSession } from "./signalr-session.server";
import { sanitizeError } from "./sanitize-error.server";
import { importDrakeEmbarkationFromBuffer } from "@/lib/histograma/import-drake";
import { importDisponibilidadeFromBuffer } from "@/lib/histograma/import-disponibilidade";
import {
  DRAKE_AVAILABILITY_IMPORT_FAILED,
  DRAKE_EMBARKATION_EXPORT_FAILED,
  DRAKE_EMBARKATION_IMPORT_FAILED,
  DRAKE_AVAILABILITY_EXPORT_FAILED,
  DRAKE_STAGE_MESSAGE,
  DRAKE_STAGE_PROGRESS,
  DRAKE_TEMP_STORAGE_ERROR,
  type DrakeProgressCallback,
  type DrakeReportStatus,
  type DrakeUpdateResult,
  type DrakeUpdateStage,
} from "./update-types";

type DbClient = SupabaseClient;

/**
 * Orquestra autenticação Drake, download HTTP e importadores.
 * Progresso é emitido via callback (stream NDJSON) — sem gravar em tabela.
 */
export async function updateDrakeData(
  db: DbClient,
  onProgress: DrakeProgressCallback,
): Promise<DrakeUpdateResult> {
  const existing = getDrakeLogContext();
  const executionId = existing?.executionId ?? createExecutionId();
  const startedAtMs = existing?.startedAtMs ?? Date.now();

  if (existing) {
    return updateDrakeDataInner(db, onProgress, startedAtMs);
  }

  return runWithDrakeLogContext({ executionId, startedAtMs, stage: "queued", progress: 0 }, () =>
    updateDrakeDataInner(db, onProgress, startedAtMs),
  );
}

async function updateDrakeDataInner(
  db: DbClient,
  onProgress: DrakeProgressCallback,
  startedAtMs: number,
): Promise<DrakeUpdateResult> {
  let apiContext: DrakeHttpClient | null = null;
  let storageState: StorageState | null = null;
  let signalRSession: DrakeSignalRSession | null = null;
  let renewedOnce = false;
  let runFiles: DrakeRunFiles | null = null;

  let embarkationStatus: DrakeReportStatus = "waiting";
  let availabilityStatus: DrakeReportStatus = "waiting";
  let currentStage: DrakeUpdateStage = "queued";
  let currentProgress = 0;
  let currentReportCode: number | undefined;

  let embarkationSummary:
    | {
        created?: number;
        updated?: number;
        insertedEvents?: number;
        skipped?: number;
        unchangedCount?: number;
        periodsUpdatedCount?: number;
        preservedReferencedCount?: number;
        deletedUnreferencedCount?: number;
      }
    | undefined;
  let availabilitySummary: { insertedEvents?: number; skipped?: number } | undefined;
  let report1Started = 0;
  let report1DurationMs = 0;
  let import1DurationMs = 0;
  let report14Started = 0;
  let report14DurationMs = 0;
  let import14DurationMs = 0;

  const emit = async (
    stage: DrakeUpdateStage,
    patch?: Partial<{
      embarkationStatus: DrakeReportStatus;
      availabilityStatus: DrakeReportStatus;
    }>,
  ) => {
    if (patch?.embarkationStatus) embarkationStatus = patch.embarkationStatus;
    if (patch?.availabilityStatus) availabilityStatus = patch.availabilityStatus;
    currentStage = stage;
    currentProgress = DRAKE_STAGE_PROGRESS[stage];
    patchDrakeLogContext({ stage, progress: currentProgress, reportCode: currentReportCode });
    await onProgress({
      type: "progress",
      stage,
      progress: currentProgress,
      message: DRAKE_STAGE_MESSAGE[stage],
      embarkationStatus,
      availabilityStatus,
    });
  };

  async function authenticate(force = false): Promise<void> {
    const authStarted = Date.now();
    if (force) {
      await clearSessionCache();
      renewedOnce = true;
    }
    const provider = new EnvironmentCredentialsDrakeAuthProvider(
      async (stage: AuthProgressStage) => {
        await emit(stage);
      },
    );
    const result = await provider.authenticate();
    storageState = result.storageState;
    const previous: DrakeHttpClient | null = apiContext;
    if (previous) await previous.dispose().catch(() => undefined);
    apiContext = await createDrakeApiContextFromAuthenticatedSession(result.authenticatedSession);
    logger.info("drake-authentication", "Integracao Drake validada", {
      stage: "authenticating",
      durationMs: Date.now() - authStarted,
    });
  }

  async function withSessionRetry<T>(
    operation: (ctx: DrakeHttpClient) => Promise<T>,
  ): Promise<T> {
    if (!apiContext) throw new Error("Contexto HTTP do Drake ausente.");
    try {
      return await operation(apiContext);
    } catch (error: unknown) {
      if (!renewedOnce && isSessionExpiredError(error)) {
        logger.warn("drake-authentication", "Sessao expirada; renovando uma vez", {
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
    logger.info("drake-update", "Validando credenciais Drake", { stage: "queued" });
    logger.info("drake-authentication", "Validando integracao Drake", {
      stage: "connecting-drake",
    });

    try {
      runFiles = await createDrakeRunFiles();
    } catch (error: unknown) {
      throw new DrakeIntegrationError({
        code: DRAKE_TEMP_STORAGE_ERROR,
        message: "Não foi possível preparar os arquivos temporários da atualização.",
        stage: currentStage,
        progress: currentProgress,
        cause: error,
      });
    }

    return await runWithDrakeFiles(runFiles, async () => {
      try {
        await authenticate(false);
      } catch (error: unknown) {
        if (error instanceof DrakeAuthError) throw error;
        if (
          error instanceof Error &&
          (error as Error & { code?: string }).code === DRAKE_CREDENTIALS_NOT_CONFIGURED
        ) {
          throw error;
        }
        if (
          error instanceof Error &&
          (error as Error & { code?: string }).code === DRAKE_INTERACTIVE_AUTH_REQUIRED
        ) {
          throw error;
        }
        if (isTempStorageError(error)) {
          throw new DrakeIntegrationError({
            code: DRAKE_TEMP_STORAGE_ERROR,
            message: "Não foi possível preparar os arquivos temporários da atualização.",
            stage: currentStage,
            progress: currentProgress,
            cause: error,
          });
        }
        throw error;
      }

      await emit("preparing-processing-channel");
      if (!apiContext) throw new Error("Contexto HTTP do Drake ausente.");
      signalRSession = await openDrakeSignalRSession(apiContext);

      const period = getApiPeriodDates(env.DRAKE_TIMEZONE);
      logger.info("drake-update", `Periodo ${period.human.startDate} — ${period.human.endDate}`, {
        stage: "preparing-period",
        humanStartDate: period.human.startDate,
        humanEndDate: period.human.endDate,
      });
      await emit("preparing-period");

      // ── Relatório 1 ─────────────────────────────────────────────────────────
      currentReportCode = 1;
      report1Started = Date.now();
      logger.info("drake-update", "Solicitando relatorio 1", {
        reportCode: 1,
        stage: "executing-embarkation-query",
      });
      await emit("executing-embarkation-query", { embarkationStatus: "processing" });
      await emit("waiting-embarkation-query", { embarkationStatus: "processing" });
      await emit("requesting-embarkation-report", { embarkationStatus: "processing" });
      await emit("waiting-embarkation-report", { embarkationStatus: "processing" });
      await emit("downloading-embarkation-report", { embarkationStatus: "downloading" });

      let embarkationPath: string | null = null;
      try {
        const downloaded = await withSessionRetry((ctx) =>
          runSingleApiReport(ctx, API_REPORT_1, { signalRSession: signalRSession! }),
        );
        embarkationPath = downloaded.filePath;
        report1DurationMs = Date.now() - report1Started;

        await emit("validating-embarkation-file", { embarkationStatus: "validating" });
        logger.info("drake-import", "Iniciando importacao do relatorio de embarque", {
          reportCode: 1,
          stage: "importing-embarkation",
          sizeBytes: downloaded.sizeBytes,
        });
        await emit("importing-embarkation", { embarkationStatus: "importing" });
        const importStarted = Date.now();
        embarkationSummary = await importDrakeEmbarkationFromBuffer(db, downloaded.buffer);
        import1DurationMs = Date.now() - importStarted;
        logger.info("drake-import", "Importacao do relatorio de embarque concluida", {
          reportCode: 1,
          stage: "embarkation-completed",
          durationMs: import1DurationMs,
          createdCount: embarkationSummary?.created,
          updatedCount: embarkationSummary?.updated,
          insertedCount: embarkationSummary?.insertedEvents,
          skippedCount: embarkationSummary?.skipped,
          unchangedCount: embarkationSummary?.unchangedCount,
          periodsUpdatedCount: embarkationSummary?.periodsUpdatedCount,
          preservedReferencedCount: embarkationSummary?.preservedReferencedCount,
          deletedUnreferencedCount: embarkationSummary?.deletedUnreferencedCount,
        });

        await emit("embarkation-completed", { embarkationStatus: "completed" });
      } catch (error: unknown) {
        const wrapped = toDrakeIntegrationError(error, {
          code: DRAKE_EMBARKATION_EXPORT_FAILED,
          stage: currentStage,
          reportCode: 1,
          progress: currentProgress,
        });
        if (
          /import|planilha|linha|colaborador/i.test(wrapped.message) &&
          !(error instanceof DrakeIntegrationError)
        ) {
          throw new DrakeIntegrationError({
            code: DRAKE_EMBARKATION_IMPORT_FAILED,
            message: wrapped.message,
            stage: currentStage,
            reportCode: 1,
            progress: currentProgress,
            cause: error,
            details: wrapped.details,
          });
        }
        throw wrapped;
      } finally {
        await removeFileIfExists(embarkationPath);
      }

      // ── Relatório 14 ────────────────────────────────────────────────────────
      currentReportCode = 14;
      report14Started = Date.now();
      logger.info("drake-update", "Solicitando relatorio 14", {
        reportCode: 14,
        stage: "requesting-availability-report",
      });
      await emit("executing-availability-query", { availabilityStatus: "processing" });
      await emit("waiting-availability-query", { availabilityStatus: "processing" });
      await emit("requesting-availability-report", { availabilityStatus: "processing" });
      await emit("waiting-availability-report", { availabilityStatus: "processing" });
      await emit("downloading-availability-report", { availabilityStatus: "downloading" });

      let availabilityPath: string | null = null;
      try {
        const downloaded = await withSessionRetry((ctx) =>
          runSingleApiReport(ctx, API_REPORT_14, { signalRSession: signalRSession! }),
        );
        availabilityPath = downloaded.filePath;
        report14DurationMs = Date.now() - report14Started;

        await emit("validating-availability-file", { availabilityStatus: "validating" });
        logger.info("drake-import", "Iniciando importacao do relatorio de disponibilidade", {
          reportCode: 14,
          stage: "importing-availability",
          sizeBytes: downloaded.sizeBytes,
        });
        await emit("importing-availability", { availabilityStatus: "importing" });
        const importStarted = Date.now();
        availabilitySummary = await importDisponibilidadeFromBuffer(db, downloaded.buffer);
        import14DurationMs = Date.now() - importStarted;
        logger.info("drake-import", "Importacao do relatorio de disponibilidade concluida", {
          reportCode: 14,
          stage: "availability-completed",
          durationMs: import14DurationMs,
          insertedCount: availabilitySummary?.insertedEvents,
          skippedCount: availabilitySummary?.skipped,
        });

        await emit("availability-completed", { availabilityStatus: "completed" });
      } catch (error: unknown) {
        const wrapped = toDrakeIntegrationError(error, {
          code: DRAKE_AVAILABILITY_EXPORT_FAILED,
          stage: currentStage,
          reportCode: 14,
          progress: currentProgress,
        });
        if (
          /import|planilha|linha|disponib|matr[ií]cula/i.test(wrapped.message) &&
          !(error instanceof DrakeIntegrationError)
        ) {
          throw new DrakeIntegrationError({
            code: DRAKE_AVAILABILITY_IMPORT_FAILED,
            message: wrapped.message,
            stage: currentStage,
            reportCode: 14,
            progress: currentProgress,
            cause: error,
            details: wrapped.details,
          });
        }
        throw wrapped;
      } finally {
        await removeFileIfExists(availabilityPath);
      }

      await emit("finalizing", {
        embarkationStatus: "completed",
        availabilityStatus: "completed",
      });

      const result: DrakeUpdateResult = {
        created: embarkationSummary?.created,
        updated: embarkationSummary?.updated,
        embarkationEvents: embarkationSummary?.insertedEvents,
        availabilityEvents: availabilitySummary?.insertedEvents,
        skipped: (embarkationSummary?.skipped ?? 0) + (availabilitySummary?.skipped ?? 0),
        report1DurationMs,
        import1DurationMs,
        report14DurationMs,
        import14DurationMs,
        totalDurationMs: Date.now() - startedAtMs,
      };

      logger.info("drake-update", "Atualizacao Drake concluida", {
        stage: "completed",
        totalDurationMs: result.totalDurationMs,
        report1DurationMs,
        import1DurationMs,
        report14DurationMs,
        import14DurationMs,
      });
      return result;
    });
  } catch (error: unknown) {
    const safe = sanitizeError(error);
    const integration =
      error instanceof DrakeIntegrationError
        ? error
        : toDrakeIntegrationError(error, {
            code: DRAKE_EMBARKATION_EXPORT_FAILED,
            stage: currentStage,
            reportCode: currentReportCode,
            progress: currentProgress,
          });

    logger.error("drake-update", "Atualizacao interrompida", {
      stage: integration.stage,
      reportCode: integration.reportCode ?? currentReportCode,
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

    // Anexar statuses atuais no erro para o mapper da rota
    (
      integration as DrakeIntegrationError & {
        embarkationStatus?: DrakeReportStatus;
        availabilityStatus?: DrakeReportStatus;
      }
    ).embarkationStatus = embarkationStatus;
    (
      integration as DrakeIntegrationError & {
        embarkationStatus?: DrakeReportStatus;
        availabilityStatus?: DrakeReportStatus;
      }
    ).availabilityStatus = availabilityStatus;

    throw integration;
  } finally {
    const session = signalRSession as DrakeSignalRSession | null;
    signalRSession = null;
    if (session) {
      await session.close().catch(() => undefined);
    }
    const ctx = apiContext as DrakeHttpClient | null;
    apiContext = null;
    if (ctx) await ctx.dispose().catch(() => undefined);
    storageState = null;
    if (runFiles) {
      await cleanupDrakeRunFiles(runFiles);
      runFiles = null;
    }
  }
}

/** @deprecated Use updateDrakeData */
export const runDrakeDataUpdate = updateDrakeData;
