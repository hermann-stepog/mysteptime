import "@tanstack/react-start/server-only";
import { DrakeIntegrationError } from "../integration-error.server";
import { logger } from "../logger";
import {
  DRAKE_BROWSER_MODE_INVALID,
  DRAKE_ERROR_MESSAGES,
  DRAKE_LOCAL_BROWSER_NOT_INSTALLED,
  DRAKE_REMOTE_BROWSER_CONNECTION_FAILED,
  DRAKE_REMOTE_BROWSER_NOT_CONFIGURED,
} from "../update-types";

export type DrakeBrowserMode = "local" | "remote";

export function resolveDrakeBrowserMode(): DrakeBrowserMode {
  const raw = (process.env.DRAKE_BROWSER_MODE ?? "").trim().toLowerCase();
  if (!raw) {
    if (process.env.NODE_ENV !== "production") {
      return "local";
    }
    throw new DrakeIntegrationError({
      code: DRAKE_BROWSER_MODE_INVALID,
      message: DRAKE_ERROR_MESSAGES[DRAKE_BROWSER_MODE_INVALID]!,
      stage: "connecting-drake",
    });
  }
  if (raw === "local" || raw === "remote") return raw;
  throw new DrakeIntegrationError({
    code: DRAKE_BROWSER_MODE_INVALID,
    message: DRAKE_ERROR_MESSAGES[DRAKE_BROWSER_MODE_INVALID]!,
    stage: "connecting-drake",
  });
}

/** Monta endpoint CDP em memória; nunca logar resultado. */
export function buildRemoteBrowserEndpoint(): string {
  const endpoint = (process.env.DRAKE_REMOTE_BROWSER_ENDPOINT ?? "").trim();
  if (!endpoint) {
    throw new DrakeIntegrationError({
      code: DRAKE_REMOTE_BROWSER_NOT_CONFIGURED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_REMOTE_BROWSER_NOT_CONFIGURED]!,
      stage: "connecting-drake",
    });
  }
  const token = (process.env.DRAKE_REMOTE_BROWSER_TOKEN ?? "").trim();
  if (!token) return endpoint;
  try {
    const url = new URL(endpoint);
    if (!url.searchParams.has("token")) {
      url.searchParams.set("token", token);
    }
    return url.toString();
  } catch {
    const join = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${join}token=${encodeURIComponent(token)}`;
  }
}

export function mapBrowserLaunchError(error: unknown, mode: DrakeBrowserMode): never {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (mode === "local") {
    if (
      /executable doesn't exist|browserType\.launch|playwright install|chromium/i.test(message) ||
      lower.includes("enoent")
    ) {
      throw new DrakeIntegrationError({
        code: DRAKE_LOCAL_BROWSER_NOT_INSTALLED,
        message: DRAKE_ERROR_MESSAGES[DRAKE_LOCAL_BROWSER_NOT_INSTALLED]!,
        stage: "connecting-drake",
        cause: error,
      });
    }
  }

  if (mode === "remote") {
    logger.error("drake-browser", "Falha ao conectar navegador remoto", {
      errorCode: DRAKE_REMOTE_BROWSER_CONNECTION_FAILED,
      errorName: error instanceof Error ? error.name : "Error",
    });
    throw new DrakeIntegrationError({
      code: DRAKE_REMOTE_BROWSER_CONNECTION_FAILED,
      message: DRAKE_ERROR_MESSAGES[DRAKE_REMOTE_BROWSER_CONNECTION_FAILED]!,
      stage: "connecting-drake",
      cause: error,
    });
  }

  throw error;
}
