import "@tanstack/react-start/server-only";
import type { APIRequestContext, APIResponse } from "playwright";
import { env } from "./config.server";
import { logger, shortId } from "./logger";
import { sanitizeSensitiveText } from "./sanitize-error.server";

export interface DrakeHttpResult {
  status: number;
  statusText: string;
  contentType: string;
  contentLength: string | null;
  json: unknown;
  text: string;
  ok: boolean;
  durationMs: number;
  redirectOccurred: boolean;
  finalHost: string | null;
  responseShape: ResponseShape | null;
  responseKind: ResponseKind;
  path: string;
}

export type ResponseKind =
  | "login-html"
  | "error-html"
  | "json-error"
  | "json-ok"
  | "text-error"
  | "unknown";

export interface ResponseShape {
  rootType: string;
  itemCount?: number;
  sampleKeys?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizePath(url: string): string {
  // Preserva // intencional (ex.: /api/v2//Core/...). Não colapsar barras.
  const raw = url.trim();
  const noQuery = raw.split("?")[0] ?? raw;
  if (/^https?:\/\//i.test(noQuery)) {
    const match = /^https?:\/\/[^/]+(\/.*)$/i.exec(noQuery);
    return match?.[1] ?? noQuery;
  }
  return noQuery;
}

export function describeResponseShape(json: unknown): ResponseShape | null {
  if (json == null) return null;
  if (Array.isArray(json)) {
    const first = json[0];
    return {
      rootType: "array",
      itemCount: json.length,
      sampleKeys: isRecord(first) ? Object.keys(first).slice(0, 12) : undefined,
    };
  }
  if (isRecord(json)) {
    const keys = Object.keys(json).slice(0, 20);
    let itemCount: number | undefined;
    for (const key of ["items", "data", "results", "value"]) {
      const v = json[key];
      if (Array.isArray(v)) {
        itemCount = v.length;
        break;
      }
    }
    return { rootType: "object", itemCount, sampleKeys: keys };
  }
  return { rootType: typeof json };
}

function classifyResponse(
  status: number,
  contentType: string,
  text: string,
  json: unknown,
): ResponseKind {
  const head = text.slice(0, 400).toLowerCase();
  const isHtml = /html/i.test(contentType) || head.includes("<!doctype") || head.includes("<html");
  if (isHtml) {
    if (/logon|login|senha|password|sign\s*in/i.test(head)) return "login-html";
    return status >= 400 ? "error-html" : "unknown";
  }
  if (json != null) {
    return status >= 200 && status < 300 ? "json-ok" : "json-error";
  }
  if (status >= 400) return "text-error";
  return "unknown";
}

function previewResponse(text: string, json: unknown): string {
  const raw =
    typeof text === "string" && text.trim() ? text : json != null ? JSON.stringify(json) : "";
  return sanitizeSensitiveText(raw)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\b\d{5,}\b/g, "[NUM]")
    .slice(0, 1000);
}

async function readBody(response: APIResponse): Promise<{ json: unknown; text: string }> {
  const contentType = response.headers()["content-type"] ?? "";
  let json: unknown = null;
  let text = "";
  try {
    if (/json/i.test(contentType)) {
      json = await response.json();
    } else {
      text = await response.text();
    }
  } catch {
    try {
      text = await response.text();
    } catch {
      text = "";
    }
  }
  return { json, text };
}

export async function drakeGet(
  request: APIRequestContext,
  url: string,
  options: {
    stage: string;
    reportCode?: number;
    attempt?: number;
    timeoutMs?: number;
  },
): Promise<DrakeHttpResult> {
  return execute(request, "GET", url, null, options);
}

export async function drakePostJson(
  request: APIRequestContext,
  url: string,
  data: unknown,
  options: {
    stage: string;
    reportCode?: number;
    attempt?: number;
    timeoutMs?: number;
  },
): Promise<DrakeHttpResult> {
  return execute(request, "POST", url, data, options);
}

async function execute(
  request: APIRequestContext,
  method: "GET" | "POST",
  url: string,
  data: unknown,
  options: {
    stage: string;
    reportCode?: number;
    attempt?: number;
    timeoutMs?: number;
  },
): Promise<DrakeHttpResult> {
  const path = sanitizePath(url);
  const timeoutMs = options.timeoutMs ?? env.DRAKE_TIMEOUT_MS;
  const attempt = options.attempt ?? 1;
  const started = Date.now();

  logger.info("drake-http", "Iniciando requisicao", {
    stage: options.stage,
    reportCode: options.reportCode,
    method,
    path,
    attempt,
    timeoutMs,
  });

  const response =
    method === "GET"
      ? await request.get(url, { failOnStatusCode: false, timeout: timeoutMs, maxRedirects: 10 })
      : await request.post(url, {
          data,
          failOnStatusCode: false,
          timeout: timeoutMs,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
          },
        });

  const durationMs = Date.now() - started;
  const status = response.status();
  const statusText = response.statusText();
  const headers = response.headers();
  const contentType = headers["content-type"] ?? "";
  const contentLength = headers["content-length"] ?? null;
  const { json, text } = await readBody(response);
  const responseShape = describeResponseShape(json);
  const responseKind = classifyResponse(status, contentType, text, json);
  const ok = status >= 200 && status < 300;
  let finalHost: string | null = null;
  let redirectOccurred = false;
  try {
    const finalUrl = new URL(response.url());
    finalHost = finalUrl.host;
    redirectOccurred = sanitizePath(response.url()) !== path;
  } catch {
    /* ignore */
  }

  logger.info("drake-http", "Requisicao concluida", {
    stage: options.stage,
    reportCode: options.reportCode,
    method,
    path,
    status,
    ok,
    contentType,
    contentLength,
    durationMs,
    redirectOccurred,
    finalHost,
    responseShape,
    responseKind,
  });

  if (!ok) {
    logger.warn("drake-http", "Requisicao fora de 2xx", {
      stage: options.stage,
      reportCode: options.reportCode,
      method,
      path,
      status,
      statusText,
      contentType,
      durationMs,
      responseKind,
      preview: previewResponse(text, json),
      looksLikeLogin: responseKind === "login-html",
      executionHint: shortId(String(status)),
    });
  } else if (env.DRAKE_DEBUG_HTTP) {
    logger.debug("drake-http", "Detalhe HTTP", {
      stage: options.stage,
      reportCode: options.reportCode,
      path,
      responseShape,
    });
  }

  return {
    status,
    statusText,
    contentType,
    contentLength,
    json,
    text,
    ok,
    durationMs,
    redirectOccurred,
    finalHost,
    responseShape,
    responseKind,
    path,
  };
}
