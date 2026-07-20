import "@tanstack/react-start/server-only";
import type { APIRequestContext } from "playwright";
import { env } from "./config.server";
import {
  describeResponseShape,
  type DrakeHttpResult,
  type ResponseShape,
} from "./drake-http.server";
import { logger } from "./logger";
import { BACKGROUND_EXPORT_CODE } from "./report-contracts";

/**
 * Rota observada no tráfego real (barra dupla após /api/v2/).
 * Não normalizar // → /.
 */
export const BACKGROUND_JOBS_PRIMARY_PATH =
  "/api/v2//Core/BackgroundExecutionRequest/getRequestsByCodes";

export const BACKGROUND_JOBS_FALLBACK_PATH =
  "/api/v2/Core/BackgroundExecutionRequest/getRequestsByCodes";

export type BackgroundJobsRouteKind = "primary-double-slash" | "fallback-single-slash";

export interface BackgroundJobsProbeResult {
  primary: RouteProbeSample;
  fallback: RouteProbeSample;
  selectedPath: string;
  selectedKind: BackgroundJobsRouteKind;
  divergesFromHistoricalCapture: boolean;
}

export interface RouteProbeSample {
  path: string;
  kind: BackgroundJobsRouteKind;
  status: number;
  ok: boolean;
  contentType: string;
  itemCount: number;
  responseShape: ResponseShape | null;
  durationMs: number;
}

let activePath: string = BACKGROUND_JOBS_PRIMARY_PATH;
let activeKind: BackgroundJobsRouteKind = "primary-double-slash";
let probedThisRun = false;
let lastProbe: BackgroundJobsProbeResult | null = null;

/** Preserva pathname com // intencional; remove apenas host/query para log. */
export function displayDrakePath(urlOrPath: string): string {
  const raw = urlOrPath.trim();
  const noQuery = raw.split("?")[0] ?? raw;
  if (/^https?:\/\//i.test(noQuery)) {
    const match = /^https?:\/\/[^/]+(\/.*)$/i.exec(noQuery);
    return match?.[1] ?? noQuery;
  }
  return noQuery;
}

/** Nunca colapsar barras duplas do contrato Drake. */
export function preserveDrakeApiPath(path: string): string {
  return displayDrakePath(path);
}

export function getActiveBackgroundJobsPath(): string {
  return activePath;
}

export function getActiveBackgroundJobsKind(): BackgroundJobsRouteKind {
  return activeKind;
}

export function getLastBackgroundJobsProbe(): BackgroundJobsProbeResult | null {
  return lastProbe;
}

export function resetBackgroundJobsRouteSelection(): void {
  activePath = BACKGROUND_JOBS_PRIMARY_PATH;
  activeKind = "primary-double-slash";
  probedThisRun = false;
  lastProbe = null;
}

function kindForPath(path: string): BackgroundJobsRouteKind {
  return path.includes("/api/v2//") ? "primary-double-slash" : "fallback-single-slash";
}

function countItems(json: unknown): number {
  const shape = describeResponseShape(json);
  if (shape?.itemCount != null) return shape.itemCount;
  if (Array.isArray(json)) return json.length;
  return 0;
}

/**
 * GET com params code=5359, sem normalizar o path.
 */
export async function requestBackgroundJobs(
  request: APIRequestContext,
  path: string,
  options?: { stage?: string; reportCode?: number },
): Promise<DrakeHttpResult & { itemCount: number; queryParameterNames: string[] }> {
  const stage = options?.stage ?? "fetch-background-jobs";
  const started = Date.now();
  const displayPath = preserveDrakeApiPath(path);

  logger.info("drake-http", "Iniciando requisicao", {
    stage,
    reportCode: options?.reportCode,
    method: "GET",
    path: displayPath,
    queryParameterNames: ["code"],
    backgroundCode: BACKGROUND_EXPORT_CODE,
    timeoutMs: env.DRAKE_TIMEOUT_MS,
  });

  const response = await request.get(path, {
    params: { code: String(BACKGROUND_EXPORT_CODE) },
    failOnStatusCode: false,
    timeout: env.DRAKE_TIMEOUT_MS,
    maxRedirects: 10,
  });

  const durationMs = Date.now() - started;
  const status = response.status();
  const headers = response.headers();
  const contentType = headers["content-type"] ?? "";
  const contentLength = headers["content-length"] ?? null;
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

  const responseShape = describeResponseShape(json);
  const itemCount = countItems(json);
  const ok = status >= 200 && status < 300;
  let finalHost: string | null = null;
  try {
    finalHost = new URL(response.url()).host;
  } catch {
    /* ignore */
  }

  // Verifica se a URL final ainda contém a barra dupla quando esperada
  const finalUrl = response.url();
  const preservedDoubleSlash =
    path.includes("/api/v2//") &&
    (finalUrl.includes("/api/v2//") || displayPath.includes("/api/v2//"));

  logger.info("drake-http", "Requisicao concluida", {
    stage,
    reportCode: options?.reportCode,
    method: "GET",
    path: displayPath,
    queryParameterNames: ["code"],
    backgroundCode: BACKGROUND_EXPORT_CODE,
    status,
    ok,
    contentType,
    contentLength,
    durationMs,
    finalHost,
    responseShape,
    itemCount,
    preservedDoubleSlash: path.includes("/api/v2//") ? preservedDoubleSlash : undefined,
  });

  return {
    status,
    statusText: response.statusText(),
    contentType,
    contentLength,
    json,
    text,
    ok,
    durationMs,
    redirectOccurred: false,
    finalHost,
    responseShape,
    responseKind: ok ? "json-ok" : "json-error",
    path: displayPath,
    itemCount,
    queryParameterNames: ["code"],
  };
}

async function probeOne(
  request: APIRequestContext,
  path: string,
  kind: BackgroundJobsRouteKind,
): Promise<RouteProbeSample> {
  const result = await requestBackgroundJobs(request, path, {
    stage: "probe-background-jobs",
  });
  return {
    path: preserveDrakeApiPath(path),
    kind,
    status: result.status,
    ok: result.ok,
    contentType: result.contentType,
    itemCount: result.itemCount,
    responseShape: result.responseShape,
    durationMs: result.durationMs,
  };
}

/**
 * Testa barra dupla e barra simples uma vez; seleciona a rota ativa da execução.
 */
export async function probeBackgroundJobsEndpoint(
  request: APIRequestContext,
): Promise<BackgroundJobsProbeResult> {
  logger.info("drake-export", "Probe das rotas de background jobs", {
    stage: "probe-background-jobs",
    backgroundCode: BACKGROUND_EXPORT_CODE,
    primaryPath: BACKGROUND_JOBS_PRIMARY_PATH,
    fallbackPath: BACKGROUND_JOBS_FALLBACK_PATH,
  });

  const primary = await probeOne(request, BACKGROUND_JOBS_PRIMARY_PATH, "primary-double-slash");
  const fallback = await probeOne(request, BACKGROUND_JOBS_FALLBACK_PATH, "fallback-single-slash");

  let selectedPath = BACKGROUND_JOBS_PRIMARY_PATH;
  let selectedKind: BackgroundJobsRouteKind = "primary-double-slash";

  const primaryValid = primary.ok && primary.itemCount > 0;
  const fallbackValid = fallback.ok && fallback.itemCount > 0;

  if (primaryValid) {
    selectedPath = BACKGROUND_JOBS_PRIMARY_PATH;
    selectedKind = "primary-double-slash";
  } else if (fallbackValid) {
    selectedPath = BACKGROUND_JOBS_FALLBACK_PATH;
    selectedKind = "fallback-single-slash";
    logger.info("drake-export", "Rota alternativa de background jobs selecionada", {
      stage: "probe-background-jobs",
      selectedRoute: selectedPath,
      reason: "fallback-has-items",
    });
  } else if (primary.ok) {
    selectedPath = BACKGROUND_JOBS_PRIMARY_PATH;
    selectedKind = "primary-double-slash";
  } else if (fallback.ok) {
    selectedPath = BACKGROUND_JOBS_FALLBACK_PATH;
    selectedKind = "fallback-single-slash";
    logger.info("drake-export", "Rota alternativa de background jobs selecionada", {
      stage: "probe-background-jobs",
      selectedRoute: selectedPath,
      reason: "primary-http-error",
    });
  }

  const divergesFromHistoricalCapture =
    primary.ok && fallback.ok && primary.itemCount === 0 && fallback.itemCount === 0;

  if (divergesFromHistoricalCapture) {
    logger.warn(
      "drake-export",
      "A resposta atual diverge da captura original (ambas as rotas vazias)",
      {
        stage: "probe-background-jobs",
        primaryRouteItemCount: primary.itemCount,
        fallbackRouteItemCount: fallback.itemCount,
        selectedRoute: selectedPath,
        backgroundCode: BACKGROUND_EXPORT_CODE,
      },
    );
  }

  activePath = selectedPath;
  activeKind = selectedKind;
  probedThisRun = true;
  lastProbe = {
    primary,
    fallback,
    selectedPath,
    selectedKind,
    divergesFromHistoricalCapture,
  };

  logger.info("drake-export", "Rota de background jobs selecionada", {
    stage: "probe-background-jobs",
    selectedRoute: selectedPath,
    selectedKind,
    primaryRouteItemCount: primary.itemCount,
    fallbackRouteItemCount: fallback.itemCount,
    backgroundCode: BACKGROUND_EXPORT_CODE,
  });

  return lastProbe;
}

export async function ensureBackgroundJobsRoute(
  request: APIRequestContext,
): Promise<BackgroundJobsProbeResult> {
  if (probedThisRun && lastProbe) return lastProbe;
  return probeBackgroundJobsEndpoint(request);
}

export async function switchToAlternateBackgroundJobsRoute(
  request: APIRequestContext,
): Promise<RouteProbeSample | null> {
  const alternate =
    activePath === BACKGROUND_JOBS_PRIMARY_PATH
      ? BACKGROUND_JOBS_FALLBACK_PATH
      : BACKGROUND_JOBS_PRIMARY_PATH;
  const sample = await probeOne(request, alternate, kindForPath(alternate));
  if (sample.ok && sample.itemCount > 0) {
    activePath = alternate;
    activeKind = kindForPath(alternate);
    logger.info("drake-export", "Rota alternativa de background jobs selecionada", {
      stage: "polling-background-job",
      selectedRoute: activePath,
      itemCount: sample.itemCount,
    });
    return sample;
  }
  return sample.ok ? sample : null;
}
