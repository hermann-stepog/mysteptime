import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDrakeApiContextFromAuthenticatedSession,
  isSessionExpiredError,
} from "@/lib/drake/api-session.server";
import {
  EnvironmentCredentialsDrakeAuthProvider,
  type AuthProgressStage,
} from "@/lib/drake/auth/environment-credentials-auth.server";
import { DrakeAuthError, DRAKE_SESSION_EXPIRED } from "@/lib/drake/auth/errors";
import { clearSessionCache } from "@/lib/drake/auth/session-cache.server";
import type { DrakeHttpClient } from "@/lib/drake/http/drake-http-client.types.server";
import { DrakeIntegrationError } from "@/lib/drake/integration-error.server";
import { persistIntegrationFailure } from "@/lib/drake/last-error.server";
import {
  createExecutionId,
  getDrakeLogContext,
  logger,
  patchDrakeLogContext,
  runWithDrakeLogContext,
} from "@/lib/drake/logger";
import { sanitizeError } from "@/lib/drake/sanitize-error.server";
import {
  QUALIFICATION_STORAGE_MIGRATIONS,
  QualificationStorageNotReadyError,
  syncDrakeQualificationNeeds,
} from "./sync.server";
import {
  DRAKE_QUALIFICATION_IMPORT_FAILED,
  DRAKE_QUALIFICATION_STORAGE_NOT_READY,
  QUALIFICATION_STAGE_MESSAGE,
  QUALIFICATION_STAGE_PROGRESS,
  type QualificationProgressCallback,
  type QualificationUpdateResult,
  type QualificationUpdateStage,
  type QualificationUpdateStatus,
} from "./update-types";

export async function updateDrakeQualifications(
  db: SupabaseClient,
  onProgress: QualificationProgressCallback,
): Promise<QualificationUpdateResult> {
  const existing = getDrakeLogContext();
  const executionId = existing?.executionId ?? createExecutionId();
  const startedAtMs = existing?.startedAtMs ?? Date.now();

  if (existing) return updateQualificationsInner(db, onProgress, startedAtMs);
  return runWithDrakeLogContext({ executionId, startedAtMs, stage: "queued", progress: 0 }, () =>
    updateQualificationsInner(db, onProgress, startedAtMs),
  );
}

async function updateQualificationsInner(
  db: SupabaseClient,
  onProgress: QualificationProgressCallback,
  startedAtMs: number,
): Promise<QualificationUpdateResult> {
  let apiContext: DrakeHttpClient | null = null;
  let renewedOnce = false;
  let currentStage: QualificationUpdateStage = "queued";
  let currentProgress = 0;
  let qualificationStatus: QualificationUpdateStatus = "waiting";

  const emit = async (
    stage: QualificationUpdateStage,
    status: QualificationUpdateStatus = qualificationStatus,
    progressOverride?: number,
  ): Promise<void> => {
    currentStage = stage;
    qualificationStatus = status;
    currentProgress = Math.max(
      currentProgress,
      progressOverride ?? QUALIFICATION_STAGE_PROGRESS[stage],
    );
    patchDrakeLogContext({ stage, progress: currentProgress, reportCode: undefined });
    await onProgress({
      type: "progress",
      stage,
      progress: currentProgress,
      message: QUALIFICATION_STAGE_MESSAGE[stage],
      qualificationStatus,
    });
  };

  const authenticate = async (force = false): Promise<void> => {
    if (force) {
      await clearSessionCache();
      renewedOnce = true;
    }
    const provider = new EnvironmentCredentialsDrakeAuthProvider((stage: AuthProgressStage) =>
      emit(stage, "processing"),
    );
    const result = await provider.authenticate();
    await apiContext?.dispose().catch(() => undefined);
    apiContext = await createDrakeApiContextFromAuthenticatedSession(result.authenticatedSession);
  };

  const withSessionRetry = async <T>(
    operation: (context: DrakeHttpClient) => Promise<T>,
  ): Promise<T> => {
    if (!apiContext) throw new Error("Contexto HTTP do Drake ausente.");
    try {
      return await operation(apiContext);
    } catch (error: unknown) {
      if (!renewedOnce && isSessionExpiredError(error)) {
        logger.warn("drake-qualification", "Sessao expirada; renovando automaticamente", {
          stage: currentStage,
        });
        await authenticate(true);
        return operation(apiContext!);
      }
      throw error;
    }
  };

  try {
    await emit("queued", "waiting");
    logger.info("drake-qualification", "Atualizacao de aptidao iniciada", { stage: "queued" });
    await authenticate();
    await emit("loading-qualification-data", "processing");

    const summary = await withSessionRetry((context) =>
      syncDrakeQualificationNeeds(context, db, {
        onPage: ({ loaded, total }) => {
          const ratio = total > 0 ? Math.min(1, loaded / total) : 1;
          return emit("loading-qualification-data", "processing", 35 + Math.round(ratio * 45));
        },
        onBeforeImport: () => emit("importing-qualification-data", "importing"),
      }),
    );

    await emit("completed", "completed");
    const result: QualificationUpdateResult = {
      sourceRows: summary.sourceRows,
      workers: summary.workers,
      options: summary.options,
      qualifications: summary.qualifications,
      durationMs: Date.now() - startedAtMs,
    };
    logger.info("drake-qualification", "Atualizacao de aptidao concluida", {
      stage: "completed",
      ...result,
    });
    return result;
  } catch (error: unknown) {
    const integration = toQualificationIntegrationError(error, currentStage, currentProgress);
    const safe = sanitizeError(error);
    logger.error("drake-qualification", "Atualizacao de aptidao interrompida", {
      stage: integration.stage,
      progress: integration.progress ?? currentProgress,
      errorCode: integration.code,
      errorName: safe.name,
      sanitizedMessage: integration.message,
      details: integration.details,
    });
    await persistIntegrationFailure(integration).catch(() => undefined);
    throw integration;
  } finally {
    const context = apiContext as DrakeHttpClient | null;
    apiContext = null;
    if (context) await context.dispose().catch(() => undefined);
  }
}

function toQualificationIntegrationError(
  error: unknown,
  stage: QualificationUpdateStage,
  progress: number,
): DrakeIntegrationError {
  if (error instanceof DrakeIntegrationError) return error;
  if (error instanceof DrakeAuthError) {
    return new DrakeIntegrationError({
      code: error.code,
      message: error.message,
      stage,
      progress,
      cause: error,
    });
  }

  const storageNotReady = error instanceof QualificationStorageNotReadyError;
  const sessionExpired = isSessionExpiredError(error);
  const cause = sanitizeError(storageNotReady ? error.cause : error);
  return new DrakeIntegrationError({
    code: storageNotReady
      ? DRAKE_QUALIFICATION_STORAGE_NOT_READY
      : sessionExpired
        ? DRAKE_SESSION_EXPIRED
        : DRAKE_QUALIFICATION_IMPORT_FAILED,
    message: storageNotReady
      ? "O banco ainda não está preparado para armazenar os cursos e requisitos de aptidão."
      : sessionExpired
        ? "A sessão do Drake expirou e precisa ser conectada novamente."
        : "Não foi possível atualizar os cursos e requisitos de aptidão.",
    stage,
    progress,
    cause: error,
    details: {
      causeName: cause.name,
      causeCode: cause.code,
      causeMessage: cause.message,
      ...(storageNotReady ? { requiredMigrations: [...QUALIFICATION_STORAGE_MIGRATIONS] } : {}),
    },
  });
}
