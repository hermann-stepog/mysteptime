import "@tanstack/react-start/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { getDrakeConfig } from "./config.server";
import { sanitizeSensitiveText } from "./sanitize-error.server";

export type DrakeLogLevel = "error" | "warn" | "info" | "debug";

export interface DrakeLogContext {
  executionId: string;
  reportCode?: number;
  stage?: string;
  startedAtMs: number;
  progress?: number;
}

const LEVEL_RANK: Record<DrakeLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const store = new AsyncLocalStorage<DrakeLogContext>();

function configuredLevel(): DrakeLogLevel {
  const raw = (getDrakeConfig().DRAKE_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "error" || raw === "warn" || raw === "info" || raw === "debug") return raw;
  return "info";
}

function shouldLog(level: DrakeLogLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[configuredLevel()];
}

export function createExecutionId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export function shortId(value: string | null | undefined, chars = 8): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return null;
  return cleaned.slice(0, chars);
}

export function getDrakeLogContext(): DrakeLogContext | null {
  return store.getStore() ?? null;
}

export function runWithDrakeLogContext<T>(ctx: DrakeLogContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

export function patchDrakeLogContext(patch: Partial<DrakeLogContext>): void {
  const current = store.getStore();
  if (!current) return;
  Object.assign(current, patch);
}

function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase();
    if (/cookie|token|password|senha|storage|authorization|documentid|signed|secret/i.test(lower)) {
      continue;
    }
    if (typeof value === "string") {
      out[key] = sanitizeSensitiveText(value).slice(0, 500);
    } else if (Array.isArray(value)) {
      out[key] = value
        .slice(0, 40)
        .map((item) =>
          typeof item === "string" ? sanitizeSensitiveText(item).slice(0, 120) : item,
        );
    } else if (value && typeof value === "object") {
      out[key] = redactFields(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function emit(
  level: DrakeLogLevel,
  scope: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  if (!shouldLog(level)) return;
  const ctx = store.getStore();
  const elapsedMs = ctx ? Date.now() - ctx.startedAtMs : undefined;
  const payload = redactFields({
    scope,
    executionId: ctx?.executionId,
    reportCode: fields.reportCode ?? ctx?.reportCode,
    stage: fields.stage ?? ctx?.stage,
    timestamp: new Date().toISOString(),
    elapsedMs,
    message: sanitizeSensitiveText(message),
    ...fields,
  });

  const line = `[${scope}] ${sanitizeSensitiveText(message)}`;
  const meta = { ...payload };
  delete meta.message;
  delete meta.scope;

  const printer =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.info;

  printer(line, meta);
}

type LogFn = {
  (scope: string, message: string, fields?: Record<string, unknown>): void;
  (fields: Record<string, unknown>, message: string): void;
  (message: string): void;
};

function makeLogFn(level: DrakeLogLevel): LogFn {
  return ((a: unknown, b?: unknown, c?: unknown) => {
    if (typeof a === "string" && typeof b === "string") {
      emit(level, a, b, (c as Record<string, unknown>) ?? {});
      return;
    }
    if (typeof a === "object" && a !== null && typeof b === "string") {
      emit(level, "drake", b, a as Record<string, unknown>);
      return;
    }
    if (typeof a === "string") {
      emit(level, "drake", a);
    }
  }) as LogFn;
}

export const logger = {
  error: makeLogFn("error"),
  warn: makeLogFn("warn"),
  info: makeLogFn("info"),
  debug: makeLogFn("debug"),
};
