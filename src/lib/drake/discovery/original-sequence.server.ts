import "@tanstack/react-start/server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type DrakeReportCode = "REPORT_1" | "REPORT_14";

export enum DrakeOperation {
  SIGNALR_NEGOTIATE = "SIGNALR_NEGOTIATE",
  SIGNALR_CONNECT = "SIGNALR_CONNECT",
  SIGNALR_START = "SIGNALR_START",
  SIGNALR_WEBSOCKET = "SIGNALR_WEBSOCKET",
  LOAD_QUERY = "LOAD_QUERY",
  LOAD_PARAMETERS = "LOAD_PARAMETERS",
  EXECUTE_QUERY = "EXECUTE_QUERY",
  POLL_EXECUTION = "POLL_EXECUTION",
  EXPORT_TO_EXCEL = "EXPORT_TO_EXCEL",
  POLL_EXPORT_JOB = "POLL_EXPORT_JOB",
  DOWNLOAD_TEMPORARY_FILE = "DOWNLOAD_TEMPORARY_FILE",
  UNKNOWN = "UNKNOWN",
}

export type SignalRProtocol =
  | "aspnet-core-signalr"
  | "aspnet-signalr-classic"
  | "custom-websocket"
  | "not-found"
  | "unknown";

export type ValueType = "string" | "number" | "boolean" | "null" | "array" | "object" | "unknown";

export interface PayloadContract {
  keys: string[];
  types: Record<string, ValueType>;
  parameterNames: string[];
  hasSignalRConnectionId: boolean;
}

export interface SanitizedTimelineEntry {
  timestamp: string;
  deltaMs: number | null;
  method: string;
  pathname: string;
  operation: DrakeOperation;
  requestContract: PayloadContract | null;
  response: {
    status: number | null;
    contentType: string | null;
    contentLength: number | null;
    jsonKeys: string[];
    bodyCaptured: boolean | null;
  } | null;
}

export interface OriginalSequence {
  report: DrakeReportCode;
  signalRProtocol: SignalRProtocol;
  timeline: SanitizedTimelineEntry[];
  executeContract: PayloadContract | null;
  exportContract: PayloadContract | null;
}

export interface CurrentSequenceHint {
  operations: DrakeOperation[];
  executeContract?: PayloadContract | null;
  exportContract?: PayloadContract | null;
  signalRConnectionIdProvided?: boolean;
}

export type SequenceComparisonConclusion =
  | "MATCHES_ORIGINAL"
  | "MISSING_QUERY_EXECUTE"
  | "MISSING_SIGNALR_CONNECTION_ID"
  | "PAYLOAD_CONTRACT_MISMATCH"
  | "SEQUENCE_ORDER_MISMATCH"
  | "INCONCLUSIVE";

export interface SequenceComparisonReport {
  generatedAt: string;
  report: DrakeReportCode;
  original: OriginalSequence;
  current: CurrentSequenceHint;
  conclusion: SequenceComparisonConclusion;
  differences: string[];
}

interface RawRequest {
  id?: string;
  requestId?: string;
  timestamp?: string;
  marker?: string;
  method?: string;
  url?: string;
  postData?: unknown;
  body?: unknown;
  response?: unknown;
}

interface RawResponse {
  requestId?: string;
  id?: string;
  status?: number;
  statusCode?: number;
  contentType?: string;
  contentLength?: number;
  jsonBody?: unknown;
  jsonKeys?: unknown;
  bodyCaptured?: boolean;
}

export interface RawCapture {
  startedAt?: string;
  finishedAt?: string;
  markers?: Array<{ name?: string; marker?: string; timestamp?: string }>;
  requests?: RawRequest[];
  responses?: RawResponse[];
  downloads?: unknown[];
  failures?: unknown[];
}

export function resolveDiscoveryRawPath(): string {
  const configured = process.env.DRAKE_DISCOVERY_RAW_PATH?.trim();
  if (!configured) {
    throw new Error("DRAKE_DISCOVERY_RAW_PATH não foi configurado para analisar a captura original do Drake.");
  }
  return configured;
}

export async function loadRawCaptureInMemory(filePath: string): Promise<RawCapture> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed)) throw new Error("A captura original do Drake possui formato inválido.");
  return parsed as RawCapture;
}

export function classifyOperation(method: string, pathname: string): DrakeOperation {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = pathname.toLowerCase().replace(/\/{2,}/g, "/");
  if (normalizedPath.includes("/signalr/negotiate")) return DrakeOperation.SIGNALR_NEGOTIATE;
  if (normalizedPath.includes("/signalr/connect")) return DrakeOperation.SIGNALR_CONNECT;
  if (normalizedPath.includes("/signalr/start")) return DrakeOperation.SIGNALR_START;
  if (normalizedPath.startsWith("ws:") || normalizedPath.startsWith("wss:") || normalizedPath.includes("/websocket")) {
    return DrakeOperation.SIGNALR_WEBSOCKET;
  }
  if (/\/queries\/query\/(?:[0-9a-f-]{20,}|:id)$/i.test(normalizedPath) && normalizedMethod === "GET") {
    return DrakeOperation.LOAD_QUERY;
  }
  if (normalizedMethod === "GET" && normalizedPath.includes("/queries/query/config")) {
    return DrakeOperation.LOAD_PARAMETERS;
  }
  if (normalizedMethod === "POST" && normalizedPath.endsWith("/queries/query/execute")) {
    return DrakeOperation.EXECUTE_QUERY;
  }
  if (normalizedMethod === "POST" && normalizedPath.endsWith("/queries/query/exporttoexcel")) {
    return DrakeOperation.EXPORT_TO_EXCEL;
  }
  if (/getrequestsbycodes|backgroundexecution|backgroundjobs|executionstatus/i.test(normalizedPath)) {
    return DrakeOperation.POLL_EXPORT_JOB;
  }
  if (/notification|execution/i.test(normalizedPath)) return DrakeOperation.POLL_EXECUTION;
  if (/downloadtemporaryfile|temporaryfile/i.test(normalizedPath)) {
    return DrakeOperation.DOWNLOAD_TEMPORARY_FILE;
  }
  return DrakeOperation.UNKNOWN;
}

export function classifySignalRProtocol(requests: RawRequest[]): SignalRProtocol {
  const paths = requests.map((request) => pathnameOf(request.url ?? "").toLowerCase());
  if (paths.some((pathname) => pathname.includes("/signalr/negotiate") || pathname.includes("/signalr/connect"))) {
    return "aspnet-signalr-classic";
  }
  const hasCoreNegotiate = paths.some(
    (pathname) => pathname.endsWith("/negotiate") && !pathname.includes("/signalr/"),
  );
  const hasSignalRConnectionIdInPayload = requests.some((request) => {
    for (const candidate of [request.postData, request.body, request.response]) {
      const contract = payloadContract(candidate);
      if (contract?.hasSignalRConnectionId) return true;
    }
    return false;
  });
  if (
    hasCoreNegotiate ||
    hasSignalRConnectionIdInPayload ||
    requests.some(
      (request) =>
        responseLikeConnectionId(request.body) ||
        responseLikeConnectionId(request.response) ||
        responseLikeConnectionId(request.postData) ||
        /connectionid/i.test(request.url ?? ""),
    )
  ) {
    return "aspnet-core-signalr";
  }
  if (paths.some((pathname) => pathname.startsWith("ws:") || pathname.startsWith("wss:") || pathname.includes("websocket"))) {
    return "custom-websocket";
  }
  if (paths.some((pathname) => pathname.includes("signalr") || pathname.includes("/hub"))) {
    return "unknown";
  }
  return "not-found";
}

export function buildReportTimeline(raw: RawCapture, report: DrakeReportCode): OriginalSequence {
  const start = markerTimestamp(raw, `${report}_START`);
  const end = markerTimestamp(raw, `${report}_END`);
  if (!start || !end) throw new Error(`Marcadores ${report}_START e ${report}_END não foram encontrados na captura.`);
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error(`Marcadores de ${report} possuem timestamp inválido.`);

  const responses = new Map(
    (raw.responses ?? []).map((response) => [response.requestId ?? response.id ?? "", response]),
  );
  const selected = (raw.requests ?? [])
    .filter((request) => {
      const timestamp = Date.parse(request.timestamp ?? "");
      return Number.isFinite(timestamp) && timestamp >= startMs && timestamp <= endMs;
    })
    .sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""));

  let previousTimestamp: number | null = null;
  const timeline = selected.map((request) => {
    const timestamp = Date.parse(request.timestamp ?? "");
    const response = responses.get(request.id ?? request.requestId ?? "");
    const entry: SanitizedTimelineEntry = {
      timestamp: request.timestamp ?? "",
      deltaMs: previousTimestamp === null ? null : timestamp - previousTimestamp,
      method: (request.method ?? "GET").toUpperCase(),
      pathname: pathnameOf(request.url ?? ""),
      operation: classifyOperation(request.method ?? "GET", pathnameOf(request.url ?? "")),
      requestContract: payloadContract(request.postData),
      response: response
        ? {
            status: response.status ?? response.statusCode ?? null,
            contentType: response.contentType ?? null,
            contentLength: response.contentLength ?? null,
            jsonKeys: stringArray(response.jsonKeys ?? response.jsonBody),
            bodyCaptured: typeof response.bodyCaptured === "boolean" ? response.bodyCaptured : null,
          }
        : null,
    };
    previousTimestamp = timestamp;
    return entry;
  });
  return {
    report,
    signalRProtocol: classifySignalRProtocol(raw.requests ?? []),
    timeline,
    executeContract: timeline.find((entry) => entry.operation === DrakeOperation.EXECUTE_QUERY)?.requestContract ?? null,
    exportContract: timeline.find((entry) => entry.operation === DrakeOperation.EXPORT_TO_EXCEL)?.requestContract ?? null,
  };
}

export function extractExecuteContract(sequence: OriginalSequence): PayloadContract | null {
  return sequence.executeContract;
}

export function extractExportContract(sequence: OriginalSequence): PayloadContract | null {
  return sequence.exportContract;
}

export function compareToCurrentSequence(
  original: OriginalSequence,
  current: CurrentSequenceHint,
): SequenceComparisonReport {
  const differences: string[] = [];
  const originalExecute = original.timeline.findIndex((entry) => entry.operation === DrakeOperation.EXECUTE_QUERY);
  const originalExport = original.timeline.findIndex((entry) => entry.operation === DrakeOperation.EXPORT_TO_EXCEL);
  const currentExecute = current.operations.indexOf(DrakeOperation.EXECUTE_QUERY);
  const currentExport = current.operations.indexOf(DrakeOperation.EXPORT_TO_EXCEL);
  let conclusion: SequenceComparisonConclusion = "MATCHES_ORIGINAL";

  if (originalExecute >= 0 && currentExecute < 0) {
    conclusion = "MISSING_QUERY_EXECUTE";
    differences.push("A sequência atual não executa a consulta antes da exportação.");
  } else if (
    original.executeContract?.hasSignalRConnectionId &&
    current.signalRConnectionIdProvided === false
  ) {
    conclusion = "MISSING_SIGNALR_CONNECTION_ID";
    differences.push("A sequência atual não fornece signalRConnectionId.");
  } else if (originalExecute >= 0 && originalExport >= 0 && currentExecute > currentExport) {
    conclusion = "SEQUENCE_ORDER_MISMATCH";
    differences.push("A exportação atual ocorre antes da execução da consulta.");
  } else if (
    !sameContract(original.executeContract, current.executeContract) ||
    !sameContract(original.exportContract, current.exportContract)
  ) {
    conclusion = "PAYLOAD_CONTRACT_MISMATCH";
    differences.push("As chaves ou tipos dos payloads atuais divergem da captura original.");
  } else if (originalExport < 0 || currentExport < 0) {
    conclusion = "INCONCLUSIVE";
    differences.push("Não há dados suficientes de exportação para comparar a sequência.");
  }
  return { generatedAt: new Date().toISOString(), report: original.report, original, current, conclusion, differences };
}

export async function writeSequenceComparisonReport(report: SequenceComparisonReport | SequenceComparisonReport[]): Promise<string> {
  const directory = path.join(tmpdir(), "mysteptime-drake-last-analysis");
  const target = path.join(directory, "sequence-comparison.json");
  await mkdir(directory, { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathnameOf(url: string): string {
  try {
    return sanitizePathname(new URL(url).pathname);
  } catch {
    return sanitizePathname(url.split("?")[0] ?? "");
  }
}

function sanitizePathname(pathname: string): string {
  return pathname
    .replace(/\/{2,}/g, "/")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
}

function markerTimestamp(raw: RawCapture, name: string): string | undefined {
  return raw.markers?.find((marker) => (marker.name ?? marker.marker) === name)?.timestamp;
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function payloadContract(value: unknown): PayloadContract | null {
  const parsed = parsePayload(value);
  if (!isRecord(parsed)) return null;
  const types = Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, valueType(item)]));
  const parameters = parsed.executionParameters ?? parsed.params;
  const parameterNames = Array.isArray(parameters)
    ? parameters.flatMap((item) => (isRecord(item) && typeof item.name === "string" ? [item.name] : []))
    : [];
  return {
    keys: Object.keys(parsed).sort(),
    types,
    parameterNames: parameterNames.sort(),
    hasSignalRConnectionId: Object.hasOwn(parsed, "signalRConnectionId"),
  };
}

function valueType(value: unknown): ValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "unknown";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").sort();
  if (isRecord(value)) return Object.keys(value).sort();
  return [];
}

function responseLikeConnectionId(value: unknown): boolean {
  const parsed = parsePayload(value);
  return isRecord(parsed) && (Object.hasOwn(parsed, "connectionId") || Object.hasOwn(parsed, "connectionToken"));
}

function sameContract(expected: PayloadContract | null, actual: PayloadContract | null | undefined): boolean {
  if (!expected || !actual) return !expected && !actual;
  if (JSON.stringify(expected.keys) !== JSON.stringify(actual.keys)) return false;
  if (JSON.stringify(expected.types) !== JSON.stringify(actual.types)) return false;
  if (expected.hasSignalRConnectionId !== actual.hasSignalRConnectionId) return false;
  // Nomes de parâmetros dinâmicos: só comparam quando ambos informados.
  if (actual.parameterNames.length > 0 && expected.parameterNames.length > 0) {
    return JSON.stringify(expected.parameterNames) === JSON.stringify(actual.parameterNames);
  }
  return true;
}
