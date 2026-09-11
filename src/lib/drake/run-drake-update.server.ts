import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger, patchDrakeLogContext } from "./logger";
import {
  authenticateMyStepTimeAutomationUser,
  discardMyStepTimeAutomationAuthContext,
} from "./mysteptime-automation-auth.server";
import { tryAcquireDrakeUpdateLock, releaseDrakeUpdateLock } from "./update-lock.server";
import { updateDrakeData } from "./update-service.server";
import {
  completeDrakeScheduleSlot,
  tryClaimDrakeScheduleSlot,
  type DrakeScheduleSlot,
} from "./scheduler-slots.server";
import {
  DRAKE_SCHEDULE_ALREADY_CLAIMED,
  DRAKE_UPDATE_ALREADY_RUNNING,
  type DrakeProgressCallback,
  type DrakeProgressEvent,
  type DrakeUpdateResult,
  type DrakeUpdateScope,
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
  triggeredBy?: string | null;
  triggeredByLabel?: string | null;
  /**
   * Quando false, o caller já possui o lock (ex.: rota HTTP ou runScheduledDrakeUpdate).
   * Default true.
   */
  acquireLock?: boolean;
  scope?: DrakeUpdateScope;
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

const TRIGGER_LABEL: Record<DrakeUpdateTrigger, string> = {
  manual: "Atualização manual",
  "scheduled-midnight": "Agendamento automático (00h)",
  "scheduled-noon": "Agendamento automático (12h)",
  "scheduled-interval": "Atualização periódica automática",
  "scheduled-test": "Teste do agendamento automático",
};

/**
 * Ponto único de entrada para atualização Drake (manual e agendada).
 * Não duplica a lógica dos relatórios — delega a updateDrakeData.
 *
 * Agendamento automático Drake executado no processo Node.
 * Não utiliza endpoint HTTP, segredo próprio ou sessão de usuário do navegador.
 */
export async function runDrakeUpdate(options: RunDrakeUpdateOptions): Promise<DrakeUpdateResult> {
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
    return await updateDrakeData(
      options.db,
      onProgress,
      {
        triggeredBy: options.triggeredBy ?? null,
        triggeredByLabel: options.triggeredByLabel ?? TRIGGER_LABEL[options.trigger],
      },
      options.scope ?? "full",
    );
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
  options?: { onProgress?: DrakeProgressCallback; scheduleSlot?: DrakeScheduleSlot },
): Promise<RunScheduledDrakeUpdateResult> {
  if (!tryAcquireDrakeUpdateLock()) {
    throw new DrakeIntegrationError({
      code: DRAKE_UPDATE_ALREADY_RUNNING,
      message: "Já existe uma atualização em andamento.",
      stage: "queued",
    });
  }

  let accessToken: string | undefined;
  let claimedSlot = false;
  let db: SupabaseClient | undefined;
  try {
    const session = await authenticateMyStepTimeAutomationUser();
    accessToken = session.accessToken;

    const { createUserClient } = await import("@/lib/supabase/app-auth.server");
    db = createUserClient(accessToken);

    if (options?.scheduleSlot) {
      claimedSlot = await tryClaimDrakeScheduleSlot(db, options.scheduleSlot, session.userId);
      if (!claimedSlot) {
        throw new DrakeIntegrationError({
          code: DRAKE_SCHEDULE_ALREADY_CLAIMED,
          message: "Esta janela de atualização já foi processada por outra instância.",
          stage: "queued",
        });
      }
    }

    const result = await runDrakeUpdate({
      trigger,
      db,
      onProgress: options?.onProgress,
      acquireLock: false,
      triggeredBy: session.userId,
    });
    if (claimedSlot && options?.scheduleSlot) {
      await completeDrakeScheduleSlot(db, options.scheduleSlot.key, "success");
    }
    return { result, trigger };
  } catch (error: unknown) {
    if (claimedSlot && db && options?.scheduleSlot) {
      await completeDrakeScheduleSlot(
        db,
        options.scheduleSlot.key,
        "error",
        error instanceof Error ? error.message : String(error),
      ).catch((slotError: unknown) => {
        logger.warn("drake-scheduler", "Falha ao registrar resultado da janela automática", {
          scheduleKey: options.scheduleSlot?.key,
          sanitizedMessage:
            slotError instanceof Error
              ? slotError.message.slice(0, 300)
              : String(slotError).slice(0, 300),
        });
      });
    }
    throw error;
  } finally {
    accessToken = undefined;
    discardMyStepTimeAutomationAuthContext();
    releaseDrakeUpdateLock();
  }
}
