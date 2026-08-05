import "@tanstack/react-start/server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import { env } from "./config.server";
import { getDrakeLastDiagnosticDir, writeJsonAtomic } from "./drake-files.server";
import { getDrakeLogContext, logger } from "./logger";
import { sanitizeSensitiveText } from "./sanitize-error.server";
import type { DrakeIntegrationError } from "./integration-error.server";

export async function writeLastErrorFile(payload: {
  reportCode?: number;
  stage: string;
  progress?: number;
  errorCode: string;
  message: string;
  elapsedMs?: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!env.DRAKE_LAST_ERROR_FILE_ENABLED) return;
  try {
    const dir = getDrakeLastDiagnosticDir();
    const filePath = path.join(dir, "last-error.json");
    await rm(filePath, { force: true }).catch(() => undefined);
    const ctx = getDrakeLogContext();
    const body = {
      executionId: ctx?.executionId ?? null,
      generatedAt: new Date().toISOString(),
      reportCode: payload.reportCode ?? ctx?.reportCode ?? null,
      stage: payload.stage,
      progress: payload.progress ?? ctx?.progress ?? null,
      errorCode: payload.errorCode,
      message: sanitizeSensitiveText(payload.message).slice(0, 2000),
      elapsedMs: payload.elapsedMs ?? (ctx ? Date.now() - ctx.startedAtMs : null),
      details: payload.details ?? {},
    };
    await writeJsonAtomic(filePath, body);
    logger.info("drake-update", "Arquivo last-error.json atualizado", {
      stage: payload.stage,
      errorCode: payload.errorCode,
    });
  } catch {
    logger.warn("drake-update", "Falha ao gravar last-error.json (aviso sanitizado)");
  }
}

export async function persistIntegrationFailure(error: DrakeIntegrationError): Promise<void> {
  await writeLastErrorFile({
    reportCode: error.reportCode,
    stage: String(error.stage),
    progress: error.progress,
    errorCode: error.code,
    message: error.message,
    details: error.details,
  });
}
