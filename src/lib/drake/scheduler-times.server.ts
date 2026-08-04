import "@tanstack/react-start/server-only";
import { DRAKE_SCHEDULER_TIMEZONE_DEFAULT } from "./scheduler-config.server";

export type NextDrakeScheduleTimes = {
  timezone: string;
  cronMidnight: string;
  cronNoon: string;
  nextMidnight: string;
  nextNoon: string;
};

function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Converte Y-M-D H:M:S no fuso para Instant aproximado via busca binária. */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Estimativa inicial em UTC
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const target = Date.UTC(year, month - 1, day, hour, minute, 0);
    guess += target - asUtc;
  }
  return new Date(guess);
}

function nextOccurrence(
  now: Date,
  timeZone: string,
  hour: number,
  minute: number,
): Date {
  const parts = getZonedParts(now, timeZone);
  let candidate = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, timeZone);
  if (candidate.getTime() <= now.getTime()) {
    // próximo dia civil no fuso
    const tomorrow = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    const tParts = getZonedParts(tomorrow, timeZone);
    candidate = zonedTimeToUtc(tParts.year, tParts.month, tParts.day, hour, minute, timeZone);
    // Se DST empurrar para o mesmo dia, avança mais um dia
    if (candidate.getTime() <= now.getTime()) {
      const next = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      const nParts = getZonedParts(next, timeZone);
      candidate = zonedTimeToUtc(nParts.year, nParts.month, nParts.day, hour, minute, timeZone);
    }
  }
  return candidate;
}

export function getNextDrakeScheduleTimes(
  now = new Date(),
  timeZone = DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
): NextDrakeScheduleTimes {
  const nextMidnight = nextOccurrence(now, timeZone, 0, 0);
  const nextNoon = nextOccurrence(now, timeZone, 12, 30);
  return {
    timezone: timeZone,
    cronMidnight: "0 0 * * *",
    cronNoon: "30 12 * * *",
    nextMidnight: nextMidnight.toISOString(),
    nextNoon: nextNoon.toISOString(),
  };
}

export function formatDrakeScheduleTimesReport(
  times: NextDrakeScheduleTimes = getNextDrakeScheduleTimes(),
): string {
  return [
    `Timezone: ${times.timezone}`,
    `Próxima meia-noite: ${times.nextMidnight}`,
    `Próximo meio-dia: ${times.nextNoon}`,
    `Cron meia-noite: ${times.cronMidnight}`,
    `Cron 12:30: ${times.cronNoon}`,
  ].join("\n");
}
