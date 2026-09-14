import "@tanstack/react-start/server-only";

export const DRAKE_SCHEDULER_TIMEZONE_DEFAULT = "America/Sao_Paulo";
export const DRAKE_SCHEDULER_INTERVAL_MINUTES_DEFAULT = 60;
export const DRAKE_SCHEDULER_INTERVAL_MINUTES_MIN = 15;
export const DRAKE_SCHEDULER_INTERVAL_MINUTES_MAX = 24 * 60;

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

function intervalMinutesEnv(): number {
  const parsed = Number(process.env.DRAKE_SCHEDULER_INTERVAL_MINUTES);
  if (!Number.isFinite(parsed)) return DRAKE_SCHEDULER_INTERVAL_MINUTES_DEFAULT;
  return Math.min(
    DRAKE_SCHEDULER_INTERVAL_MINUTES_MAX,
    Math.max(DRAKE_SCHEDULER_INTERVAL_MINUTES_MIN, Math.floor(parsed)),
  );
}

export function getDrakeSchedulerConfig() {
  const timezone = (
    process.env.DRAKE_SCHEDULER_TIMEZONE ?? DRAKE_SCHEDULER_TIMEZONE_DEFAULT
  ).trim();
  return {
    enabled: boolEnv("DRAKE_SCHEDULER_ENABLED", false),
    timezone: timezone || DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
    intervalMinutes: intervalMinutesEnv(),
  };
}
