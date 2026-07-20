import "@tanstack/react-start/server-only";
import type { DrakeUpdateStage } from "./update-types";
import { sanitizeError, sanitizeSensitiveText } from "./sanitize-error.server";

export type DrakeErrorCode = string;

export class DrakeIntegrationError extends Error {
  readonly code: DrakeErrorCode;
  readonly stage: DrakeUpdateStage | string;
  readonly reportCode?: 1 | 14 | number;
  readonly details: Record<string, unknown>;
  readonly cause?: unknown;
  readonly progress?: number;

  constructor(args: {
    code: DrakeErrorCode;
    message: string;
    stage: DrakeUpdateStage | string;
    reportCode?: 1 | 14 | number;
    details?: Record<string, unknown>;
    cause?: unknown;
    progress?: number;
  }) {
    super(sanitizeSensitiveText(args.message));
    this.name = "DrakeIntegrationError";
    this.code = args.code;
    this.stage = args.stage;
    this.reportCode = args.reportCode;
    this.details = sanitizeDetails(args.details ?? {});
    this.cause = args.cause;
    this.progress = args.progress;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/cookie|token|password|storage|documentid|authorization/i.test(key)) continue;
    if (typeof value === "string") {
      out[key] = sanitizeSensitiveText(value).slice(0, 2000);
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 50);
    } else if (value && typeof value === "object") {
      out[key] = sanitizeDetails(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function toDrakeIntegrationError(
  error: unknown,
  fallback: {
    code: DrakeErrorCode;
    stage: string;
    reportCode?: number;
    progress?: number;
  },
): DrakeIntegrationError {
  if (error instanceof DrakeIntegrationError) return error;
  const safe = sanitizeError(error);
  const code =
    (error instanceof Error && typeof (error as Error & { code?: string }).code === "string"
      ? (error as Error & { code: string }).code
      : undefined) ||
    safe.code ||
    fallback.code;
  return new DrakeIntegrationError({
    code,
    message: safe.message || "Falha na integracao Drake.",
    stage: fallback.stage,
    reportCode: fallback.reportCode,
    progress: fallback.progress,
    cause: error,
    details: {
      errorName: safe.name,
      causeCode: safe.code,
    },
  });
}
