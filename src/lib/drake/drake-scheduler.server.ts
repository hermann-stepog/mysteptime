import "@tanstack/react-start/server-only";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger } from "./logger";
import { runScheduledDrakeUpdate } from "./run-drake-update.server";
import { getDrakeSchedulerConfig } from "./scheduler-config.server";
import {
  DRAKE_UPDATE_ALREADY_RUNNING,
  type DrakeUpdateTrigger,
} from "./update-types";

type ScheduledTrigger = Extract<
  DrakeUpdateTrigger,
  "scheduled-midnight" | "scheduled-noon"
>;

type DueSchedule = {
  key: string;
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

function zonedParts(now: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** Retorna a janela mais recente que ja venceu no fuso configurado. */
export function getDueDrakeSchedule(
  now = new Date(),
  timezone = getDrakeSchedulerConfig().timezone,
): DueSchedule {
  const parts = zonedParts(now, timezone);
  const noonReached = parts.hour > 12 || (parts.hour === 12 && parts.minute >= 30);
  const trigger: ScheduledTrigger = noonReached ? "scheduled-noon" : "scheduled-midnight";
  return { key: `${parts.date}:${trigger}`, trigger };
}

async function safeRunScheduled(trigger: ScheduledTrigger): Promise<void> {
  try {
    await runScheduledDrakeUpdate(trigger);
  } catch (error: unknown) {
    const code =
      error instanceof DrakeIntegrationError
        ? error.code
        : error instanceof Error && "code" in error
          ? String((error as Error & { code?: string }).code ?? "")
          : "";
    if (code === DRAKE_UPDATE_ALREADY_RUNNING) {
      logger.info("drake-scheduler", "Execucao automatica ignorada", {
        trigger,
        reason: "update-already-running",
      });
      return;
    }
    logger.error("drake-scheduler", "Falha isolada na execucao automatica", {
      trigger,
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

  const due = getDueDrakeSchedule(now, config.timezone);
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
    timezone: config.timezone,
  });
  await safeRunScheduled(due.trigger);
  return true;
}

/** Apenas para testes. */
export function __resetDrakeSchedulerForTests(): void {
  getGlobalState().attemptedSlots.clear();
}
