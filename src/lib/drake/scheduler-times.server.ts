import "@tanstack/react-start/server-only";
import {
  DRAKE_SCHEDULER_INTERVAL_MINUTES_DEFAULT,
  DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
} from "./scheduler-config.server";

export type NextDrakeScheduleTimes = {
  timezone: string;
  intervalMinutes: number;
  currentSlotStartedAt: string;
  nextRunEligibleAt: string;
};

export function getNextDrakeScheduleTimes(
  now = new Date(),
  timeZone = DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
  intervalMinutes = DRAKE_SCHEDULER_INTERVAL_MINUTES_DEFAULT,
): NextDrakeScheduleTimes {
  const intervalMs = intervalMinutes * 60_000;
  const currentSlotStartedAt = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
  const nextRunEligibleAt = new Date(currentSlotStartedAt.getTime() + intervalMs);
  return {
    timezone: timeZone,
    intervalMinutes,
    currentSlotStartedAt: currentSlotStartedAt.toISOString(),
    nextRunEligibleAt: nextRunEligibleAt.toISOString(),
  };
}

export function formatDrakeScheduleTimesReport(
  times: NextDrakeScheduleTimes = getNextDrakeScheduleTimes(),
): string {
  return [
    `Timezone: ${times.timezone}`,
    `Intervalo: ${times.intervalMinutes} minutos`,
    `Janela atual: ${times.currentSlotStartedAt}`,
    `Próxima execução elegível: ${times.nextRunEligibleAt}`,
  ].join("\n");
}
