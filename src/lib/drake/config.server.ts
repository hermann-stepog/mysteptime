import "@tanstack/react-start/server-only";
import process from "node:process";

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function optionalSecret(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** Configuração server-only do Drake (nunca expor no bundle frontend). */
export function getDrakeConfig() {
  const sessionCachePath =
    process.env.DRAKE_SESSION_CACHE_PATH?.trim() ||
    process.env.DRAKE_STORAGE_STATE_PATH?.trim() ||
    "./private/drake/storage-state.json";

  return {
    DRAKE_BASE_URL: (process.env.DRAKE_BASE_URL ?? "https://drake.bz").replace(/\/$/, ""),
    DRAKE_LOGIN_URL: (process.env.DRAKE_LOGIN_URL ?? "https://drake.bz/logon").replace(/\/?$/, ""),
    DRAKE_QUERY_URL: process.env.DRAKE_QUERY_URL?.trim() || "https://drake.bz/m/queries/query",
    DRAKE_DISCOVERY_RAW_PATH: (process.env.DRAKE_DISCOVERY_RAW_PATH ?? "").trim(),
    DRAKE_USERNAME: optionalSecret("DRAKE_USERNAME"),
    DRAKE_PASSWORD: optionalSecret("DRAKE_PASSWORD"),
    DRAKE_TIMEZONE: process.env.DRAKE_TIMEZONE ?? "America/Sao_Paulo",
    DRAKE_IGNORE_HTTPS_ERRORS: boolEnv("DRAKE_IGNORE_HTTPS_ERRORS", false),
    DRAKE_EXPORT_TIMEOUT_MS: intEnv("DRAKE_EXPORT_TIMEOUT_MS", 600_000),
    DRAKE_POLL_INTERVAL_MS: intEnv("DRAKE_POLL_INTERVAL_MS", 2_000),
    DRAKE_KEEP_TEMP_FILES: boolEnv("DRAKE_KEEP_TEMP_FILES", false),
    DRAKE_DIAGNOSTICS_ENABLED: boolEnv("DRAKE_DIAGNOSTICS_ENABLED", false),
    DRAKE_KEEP_DIAGNOSTICS_ON_ERROR: boolEnv("DRAKE_KEEP_DIAGNOSTICS_ON_ERROR", false),
    DRAKE_TEMP_MAX_AGE_MINUTES: intEnv("DRAKE_TEMP_MAX_AGE_MINUTES", 60),
    DRAKE_LAST_DIAGNOSTIC_DIR: (process.env.DRAKE_LAST_DIAGNOSTIC_DIR ?? "").trim(),
    DRAKE_AUTH_HEADLESS: boolEnv("DRAKE_AUTH_HEADLESS", true),
    DRAKE_SESSION_CACHE_ENABLED: boolEnv("DRAKE_SESSION_CACHE_ENABLED", true),
    DRAKE_SESSION_CACHE_PATH: sessionCachePath,
    /** Alias legado — aponta para o cache de sessão. */
    DRAKE_STORAGE_STATE_PATH: sessionCachePath,
    DRAKE_CONTEXT_NAME: process.env.DRAKE_CONTEXT_NAME ?? "Step",
    DRAKE_TIMEOUT_MS: intEnv("DRAKE_TIMEOUT_MS", 60_000),
    DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS: intEnv("DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS", 90_000),
    /** Timeout para o Menu no BrowserContext retornar 200 após o login UI. */
    DRAKE_BROWSER_MENU_TIMEOUT_MS: intEnv("DRAKE_BROWSER_MENU_TIMEOUT_MS", 90_000),
    DRAKE_REPORT_DOWNLOAD_TIMEOUT_MS: intEnv("DRAKE_REPORT_DOWNLOAD_TIMEOUT_MS", 300_000),
    DRAKE_USER_AGENT:
      process.env.DRAKE_USER_AGENT ??
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    /** Vazio = usar tmpdir do SO (join(tmpdir(), "mysteptime-drake")). */
    DRAKE_TEMP_DIR: (process.env.DRAKE_TEMP_DIR ?? "").trim(),
    DRAKE_DEBUG_SAFE_STACK: boolEnv("DRAKE_DEBUG_SAFE_STACK", false),
    DRAKE_LOG_LEVEL: (process.env.DRAKE_LOG_LEVEL ?? "info").trim().toLowerCase(),
    DRAKE_DEBUG_HTTP: boolEnv("DRAKE_DEBUG_HTTP", false),
    DRAKE_DEBUG_POLLING: boolEnv("DRAKE_DEBUG_POLLING", true),
    DRAKE_LAST_ERROR_FILE_ENABLED: boolEnv("DRAKE_LAST_ERROR_FILE_ENABLED", true),
    DRAKE_JOB_CLOCK_SKEW_MS: intEnv("DRAKE_JOB_CLOCK_SKEW_MS", 30_000),
    DRAKE_EXPORT_MAX_ATTEMPTS: intEnv("DRAKE_EXPORT_MAX_ATTEMPTS", 2),
    DRAKE_EMPTY_JOB_POLLS_BEFORE_FALLBACK: intEnv("DRAKE_EMPTY_JOB_POLLS_BEFORE_FALLBACK", 3),
    DRAKE_EMPTY_JOB_POLLS_BEFORE_FAILURE: intEnv("DRAKE_EMPTY_JOB_POLLS_BEFORE_FAILURE", 15),
    DRAKE_INITIAL_JOB_APPEAR_TIMEOUT_MS: intEnv("DRAKE_INITIAL_JOB_APPEAR_TIMEOUT_MS", 30_000),
    DRAKE_BACKGROUND_SUCCESS_STATUSES: (process.env.DRAKE_BACKGROUND_SUCCESS_STATUSES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    DRAKE_BACKGROUND_FAILURE_STATUSES: (process.env.DRAKE_BACKGROUND_FAILURE_STATUSES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    /** Sempre true no app — login nunca abre janela. */
    DRAKE_HEADLESS: true,
    DRAKE_ALLOW_MANUAL_LOGIN: false,
    DRAKE_CONTEXT_DEBUG: false,
  };
}

export type DrakeConfig = ReturnType<typeof getDrakeConfig>;

export function assertDrakeCredentialsConfigured(): void {
  const cfg = getDrakeConfig();
  if (!cfg.DRAKE_USERNAME || !cfg.DRAKE_PASSWORD) {
    const err = new Error("As credenciais de integração do Drake não estão configuradas.");
    (err as Error & { code: string }).code = "DRAKE_CREDENTIALS_NOT_CONFIGURED";
    throw err;
  }
}

/** Alias usado pelos módulos portados. Nunca logar DRAKE_USERNAME/PASSWORD. */
export const env = new Proxy({} as DrakeConfig, {
  get(_target, prop: string) {
    return getDrakeConfig()[prop as keyof DrakeConfig];
  },
});
