import "@tanstack/react-start/server-only";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger } from "./logger";
import { runScheduledDrakeUpdate } from "./run-drake-update.server";
import { getDrakeSchedulerConfig } from "./scheduler-config.server";
import {
  DRAKE_SCHEDULE_ALREADY_CLAIMED,
  DRAKE_UPDATE_ALREADY_RUNNING,
  type DrakeUpdateTrigger,
} from "./update-types";

type ScheduledTrigger = Extract<DrakeUpdateTrigger, "scheduled-interval">;

type DueSchedule = {
  key: string;
  scheduledFor: string;
  trigger: ScheduledTrigger;
};

const GLOBAL_KEY = "__drakeLovableSchedulerState" as const;

type GlobalSchedulerState = {
  attemptedSlots: Set<string>;
};

function getGlobalState(): GlobalSchedulerState {
  const global = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: GlobalSchedulerState;
  };
  if (!global[GLOBAL_KEY]) global[GLOBAL_KEY] = { attemptedSlots: new Set() };
  return global[GLOBAL_KEY];
}

/** Retorna a janela periódica que contém o instante informado. */
export function getDueDrakeSchedule(
  now = new Date(),
  intervalMinutes = getDrakeSchedulerConfig().intervalMinutes,
): DueSchedule {
  const intervalMs = intervalMinutes * 60_000;
  const slot = Math.floor(now.getTime() / intervalMs);
  const scheduledFor = new Date(slot * intervalMs).toISOString();
  return {
    key: `drake:${intervalMinutes}:${slot}`,
    scheduledFor,
    trigger: "scheduled-interval",
  };
}

async function safeRunScheduled(schedule: DueSchedule): Promise<void> {
  try {
    await runScheduledDrakeUpdate(schedule.trigger, {
      scheduleSlot: {
        key: schedule.key,
        scheduledFor: schedule.scheduledFor,
      },
    });
  } catch (error: unknown) {
    const code =
      error instanceof DrakeIntegrationError
        ? error.code
        : error instanceof Error && "code" in error
          ? String((error as Error & { code?: string }).code ?? "")
          : "";
    if (code === DRAKE_UPDATE_ALREADY_RUNNING) {
      logger.info("drake-scheduler", "Execucao automatica ignorada", {
        trigger: schedule.trigger,
        reason: "update-already-running",
      });
      return;
    }
    if (code === DRAKE_SCHEDULE_ALREADY_CLAIMED) {
      logger.info("drake-scheduler", "Janela automatica ja processada por outra instancia", {
        trigger: schedule.trigger,
        scheduleKey: schedule.key,
      });
      return;
    }
    logger.error("drake-scheduler", "Falha isolada na execucao automatica", {
      trigger: schedule.trigger,
      errorCode: code || "UNKNOWN",
      sanitizedMessage:
        error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
  }
}

/**
 * Scheduler oportunista do runtime Lovable. A primeira requisicao depois de cada
 * janela dispara a atualizacao em background, sem processo residente ou servico extra.
 */
export async function runDueDrakeSchedule(now = new Date()): Promise<boolean> {
  const config = getDrakeSchedulerConfig();
  if (!config.enabled) return false;

  const due = getDueDrakeSchedule(now, config.intervalMinutes);
  const state = getGlobalState();
  if (state.attemptedSlots.has(due.key)) return false;
  state.attemptedSlots.add(due.key);

  while (state.attemptedSlots.size > 4) {
    const oldest = state.attemptedSlots.values().next().value as string | undefined;
    if (!oldest) break;
    state.attemptedSlots.delete(oldest);
  }

  logger.info("drake-scheduler", "Janela automatica iniciada pelo Lovable", {
    trigger: due.trigger,
    intervalMinutes: config.intervalMinutes,
    scheduledFor: due.scheduledFor,
    timezone: config.timezone,
  });
  await safeRunScheduled(due);
  return true;
}

/** Apenas para testes. */
export function __resetDrakeSchedulerForTests(): void {
  getGlobalState().attemptedSlots.clear();
}
