import "@tanstack/react-start/server-only";
import {
  DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
  getDrakeSchedulerConfig,
} from "./scheduler-config.server";
import { logger } from "./logger";
import { runScheduledDrakeUpdate } from "./run-drake-update.server";
import type { DrakeUpdateTrigger } from "./update-types";
import { DRAKE_UPDATE_ALREADY_RUNNING } from "./update-types";
import { DrakeIntegrationError } from "./integration-error.server";

const GLOBAL_KEY = "__drakeSchedulerStarted" as const;

type GlobalSchedulerState = {
  started: boolean;
  tasks: Array<{ stop: () => void }>;
};

function getGlobalState(): GlobalSchedulerState {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: GlobalSchedulerState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { started: false, tasks: [] };
  }
  return g[GLOBAL_KEY];
}

async function safeRunScheduled(
  trigger: Extract<DrakeUpdateTrigger, "scheduled-midnight" | "scheduled-noon">,
): Promise<void> {
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

    // Nunca derrubar o processo: a próxima janela deve ocorrer normalmente.
    logger.error("drake-scheduler", "Falha isolada na execucao automatica", {
      trigger,
      errorCode: code || "UNKNOWN",
      sanitizedMessage:
        error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    });
  }
}

/**
 * Agendamento automático Drake executado no processo Node.
 * Não utiliza endpoint HTTP, segredo próprio ou sessão de usuário do navegador.
 *
 * Registra node-cron uma única vez por processo (quando habilitado).
 * Chama runScheduledDrakeUpdate → autenticação da conta de automação → runDrakeUpdate.
 */
export function ensureDrakeSchedulerRegistered(): {
  enabled: boolean;
  registered: boolean;
  timezone: string;
  schedules: string[];
} {
  const cfg = getDrakeSchedulerConfig();
  const state = getGlobalState();

  if (!cfg.enabled) {
    if (!state.started) {
      logger.info("drake-scheduler", "Scheduler desabilitado");
      state.started = true;
    }
    return {
      enabled: false,
      registered: false,
      timezone: cfg.timezone,
      schedules: cfg.schedules,
    };
  }

  if (state.started && state.tasks.length > 0) {
    return {
      enabled: true,
      registered: true,
      timezone: cfg.timezone,
      schedules: cfg.schedules,
    };
  }

  state.started = true;

  void import("node-cron")
    .then((cronMod) => {
      const live = getDrakeSchedulerConfig();
      if (!live.enabled) return;
      if (state.tasks.length > 0) return;

      const scheduleFn =
        typeof (cronMod as { schedule?: unknown }).schedule === "function"
          ? (cronMod as { schedule: typeof import("node-cron").schedule }).schedule
          : (cronMod as { default: { schedule: typeof import("node-cron").schedule } }).default
              .schedule;

      const timezone = live.timezone || DRAKE_SCHEDULER_TIMEZONE_DEFAULT;

      const midnight = scheduleFn(
        live.cronMidnight,
        () => {
          void safeRunScheduled("scheduled-midnight");
        },
        { timezone, name: "drake-midnight" },
      );
      const noon = scheduleFn(
        live.cronNoon,
        () => {
          void safeRunScheduled("scheduled-noon");
        },
        { timezone, name: "drake-noon" },
      );
      state.tasks.push(midnight, noon);
      logger.info("drake-scheduler", "Scheduler registrado", {
        timezone,
        schedules: live.schedules,
      });
    })
    .catch((error: unknown) => {
      state.started = false;
      state.tasks = [];
      logger.error("drake-scheduler", "Falha ao registrar node-cron", {
        sanitizedMessage: error instanceof Error ? error.message : String(error),
      });
    });

  return {
    enabled: true,
    registered: true,
    timezone: cfg.timezone,
    schedules: cfg.schedules,
  };
}
