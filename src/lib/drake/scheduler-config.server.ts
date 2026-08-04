import "@tanstack/react-start/server-only";

export const DRAKE_SCHEDULER_TIMEZONE_DEFAULT = "America/Sao_Paulo";
export const DRAKE_CRON_MIDNIGHT = "0 0 * * *";
export const DRAKE_CRON_NOON = "30 12 * * *";
export const DRAKE_SCHEDULER_SCHEDULES = ["00:00", "12:30"] as const;

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

export function getDrakeSchedulerConfig() {
  const timezone = (process.env.DRAKE_SCHEDULER_TIMEZONE ?? DRAKE_SCHEDULER_TIMEZONE_DEFAULT).trim();
  return {
    enabled: boolEnv("DRAKE_SCHEDULER_ENABLED", false),
    timezone: timezone || DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
    cronMidnight: DRAKE_CRON_MIDNIGHT,
    cronNoon: DRAKE_CRON_NOON,
    schedules: [...DRAKE_SCHEDULER_SCHEDULES],
  };
}
