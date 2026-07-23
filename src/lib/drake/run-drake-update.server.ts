import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger, patchDrakeLogContext } from "./logger";
import {
  authenticateMyStepTimeAutomationUser,
  discardMyStepTimeAutomationAuthContext,
} from "./mysteptime-automation-auth.server";
import {
  tryAcquireDrakeUpdateLock,
  releaseDrakeUpdateLock,
} from "./update-lock.server";
import { updateDrakeData } from "./update-service.server";
import {
  DRAKE_UPDATE_ALREADY_RUNNING,
  type DrakeProgressCallback,
  type DrakeProgressEvent,
  type DrakeUpdateResult,
  type DrakeUpdateTrigger,
} from "./update-types";

export type RunDrakeUpdateOptions = {
  trigger: DrakeUpdateTrigger;
  /**
   * Cliente autenticado do MyStepTime.
   * Manual: authenticateAppRequest → createUserClient(token do usuário logado).
   * Agendado: createUserClient(token obtido via signInWithPassword da conta de automação).
   */
  db: SupabaseClient;
  onProgress?: DrakeProgressCallback;
  /**
   * Quando false, o caller já possui o lock (ex.: rota HTTP ou runScheduledDrakeUpdate).
   * Default true.
   */
  acquireLock?: boolean;
};

function defaultScheduledProgress(event: DrakeProgressEvent): void {
  logger.info("drake-scheduler", event.message, {
    stage: event.stage,
    progress: event.progress,
    embarkationStatus: event.embarkationStatus,
    availabilityStatus: event.availabilityStatus,
    eventType: event.type,
  });
}

/**
 * Ponto único de entrada para atualização Drake (manual e agendada).
 * Não duplica a lógica dos relatórios — delega a updateDrakeData.
 *
 * Agendamento automático Drake executado no processo Node.
 * Não utiliza endpoint HTTP, segredo próprio ou sessão de usuário do navegador.
 */
export async function runDrakeUpdate(
  options: RunDrakeUpdateOptions,
): Promise<DrakeUpdateResult> {
  const acquireLock = options.acquireLock !== false;
  let lockHeld = false;

  if (acquireLock) {
    if (!tryAcquireDrakeUpdateLock()) {
      throw new DrakeIntegrationError({
        code: DRAKE_UPDATE_ALREADY_RUNNING,
        message: "Já existe uma atualização em andamento.",
        stage: "queued",
      });
    }
    lockHeld = true;
  }

  const onProgress = options.onProgress ?? defaultScheduledProgress;

  try {
    patchDrakeLogContext({ stage: "queued" });
    logger.info("drake-update", "Atualizacao Drake iniciada", {
      trigger: options.trigger,
      stage: "queued",
    });
    return await updateDrakeData(options.db, onProgress);
  } finally {
    if (lockHeld) {
      releaseDrakeUpdateLock();
    }
  }
}

export type RunScheduledDrakeUpdateResult = {
  result: DrakeUpdateResult;
  trigger: DrakeUpdateTrigger;
};

/**
 * Execução automática:
 * lock → login MyStepTime (mesma API da tela) → createUserClient(token)
 * → runDrakeUpdate (mesmo orquestrador do botão).
 */
export async function runScheduledDrakeUpdate(
  trigger: Exclude<DrakeUpdateTrigger, "manual">,
  options?: { onProgress?: DrakeProgressCallback },
): Promise<RunScheduledDrakeUpdateResult> {
  if (!tryAcquireDrakeUpdateLock()) {
    throw new DrakeIntegrationError({
      code: DRAKE_UPDATE_ALREADY_RUNNING,
      message: "Já existe uma atualização em andamento.",
      stage: "queued",
    });
  }

  let accessToken: string | undefined;
  try {
    const session = await authenticateMyStepTimeAutomationUser();
    accessToken = session.accessToken;

    const { createUserClient } = await import("@/lib/supabase/app-auth.server");
    const db = createUserClient(accessToken);

    const result = await runDrakeUpdate({
      trigger,
      db,
      onProgress: options?.onProgress,
      acquireLock: false,
    });
    return { result, trigger };
  } finally {
    accessToken = undefined;
    discardMyStepTimeAutomationAuthContext();
    releaseDrakeUpdateLock();
  }
}
