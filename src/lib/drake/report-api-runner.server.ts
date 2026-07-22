import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { APIRequestContext } from "playwright";
import { env } from "./config.server";
import { getCurrentDrakeRunFiles, writeJsonAtomic } from "./drake-files.server";
import { getDiagnosticsDir } from "./filesystem.server";
import { logger } from "./logger";
import { sanitizeError, sanitizeSensitiveText } from "./sanitize-error.server";
import { normalizeText } from "./text";
import { downloadReportFile } from "./api-download.server";
import type {
  ApiDownloadedReport,
  ApiReportDiagnostic,
  DrakeApiReportDefinition,
  DrakeExecuteRequest,
  DrakeExportRequest,
  DrakeQueryDefinitionResponse,
} from "./api-report-types";
import { drakeGet, drakePostJson, type DrakeHttpResult } from "./drake-http.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { buildReportParameters } from "./report-parameter-builder";
import { patchDrakeLogContext, shortId } from "./logger";
import { DRAKE_SIGNALR_REQUIRED_FOR_EXPORT, DRAKE_QUERY_EXECUTION_NOT_CREATED, DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB } from "./update-types";
import type { DrakeSignalRSession } from "./signalr-session.server";

const EXPORT_URL = "/api/v2/Queries/Query/ExportToExcel";
const EXECUTE_URL = "/api/v2/Queries/Query/Execute";

type StrategyUsed = "execute-then-export";

export interface RunSingleApiReportOptions {
  signalRSession: DrakeSignalRSession;
}

type HttpResult = Pick<DrakeHttpResult, "status" | "contentType" | "json" | "text"> & {
  durationMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeEndpoint(url: string): string {
  try {
    const parsed = new URL(url, env.DRAKE_BASE_URL);
    return parsed.pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

function sanitizeMessage(message: string): string {
  return sanitizeSensitiveText(message).slice(0, 500);
}

async function dumpDiagnostic(diagnostic: ApiReportDiagnostic): Promise<void> {
  if (!env.DRAKE_DIAGNOSTICS_ENABLED) return;
  const run = getCurrentDrakeRunFiles();
  const dir = run?.diagnosticsDirectory ?? getDiagnosticsDir();
  const filePath = path.resolve(dir, "api-report-diagnostic.json");
  await writeJsonAtomic(filePath, diagnostic);
}

async function getJson(
  request: APIRequestContext,
  url: string,
  options?: { stage?: string; reportCode?: number },
): Promise<HttpResult> {
  const result = await drakeGet(request, url, {
    stage: options?.stage ?? "http-get",
    reportCode: options?.reportCode,
  });
  return {
    status: result.status,
    contentType: result.contentType,
    json: result.json,
    text: result.text,
    durationMs: result.durationMs,
  };
}

async function postJson(
  request: APIRequestContext,
  url: string,
  data: unknown,
  options?: { stage?: string; reportCode?: number; attempt?: number },
): Promise<HttpResult> {
  const result = await drakePostJson(request, url, data, {
    stage: options?.stage ?? "http-post",
    reportCode: options?.reportCode,
    attempt: options?.attempt,
  });
  return {
    status: result.status,
    contentType: result.contentType,
    json: result.json,
    text: result.text,
    durationMs: result.durationMs,
  };
}

function extractResponseMessage(result: HttpResult): string {
  if (typeof result.text === "string" && result.text.trim()) {
    return result.text;
  }
  if (isRecord(result.json)) {
    const candidates = [
      result.json["message"],
      result.json["error"],
      result.json["title"],
      result.json["detail"],
    ];
    const found = candidates.find((item) => typeof item === "string");
    if (typeof found === "string") {
      return found;
    }
    return JSON.stringify(result.json);
  }
  return "";
}

function mentionsSignalR(message: string): boolean {
  return /signalr|connection\s*id|connectionid|conexao|conex[aã]o/i.test(message);
}

function mentionsExecuteRequired(message: string): boolean {
  return /execut|consulta|query|previ|antes|resultado/i.test(message);
}

function requiredFieldsFromMessage(message: string): string[] {
  const fields = new Set<string>();
  if (mentionsSignalR(message)) {
    fields.add("signalRConnectionId");
  }
  if (/params?/i.test(message)) {
    fields.add("params");
  }
  if (/queryId/i.test(message)) {
    fields.add("queryId");
  }
  return [...fields];
}

function assert2xx(result: HttpResult): boolean {
  return result.status >= 200 && result.status < 300;
}

export async function validateQueryDefinition(
  request: APIRequestContext,
  report: DrakeApiReportDefinition,
): Promise<DrakeQueryDefinitionResponse> {
  logger.info("drake-report", `Validando definicao do relatorio ${report.code}`, {
    reportCode: report.code,
    stage: "validate-query-definition",
  });
  const url = `/api/v2/Queries/Query/${report.queryId}`;
  const result = await getJson(request, url, {
    stage: "validate-query-definition",
    reportCode: report.code,
  });
  if (!assert2xx(result) || !isRecord(result.json)) {
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Definicao do relatorio ${report.code} invalida (status ${result.status}).`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: { status: result.status },
    });
  }

  const body = result.json;
  const definition: DrakeQueryDefinitionResponse = {
    id: String(body["id"] ?? ""),
    code: Number(body["code"] ?? Number.NaN),
    name: String(body["name"] ?? ""),
  };
  if (typeof body["enabled"] === "boolean") {
    definition.enabled = body["enabled"];
  }
  if (typeof body["tenantName"] === "string") {
    definition.tenantName = body["tenantName"];
  }
  if (typeof body["queryType"] === "string") {
    definition.queryType = body["queryType"];
  }
  if (Array.isArray(body["parameters"])) {
    definition.parameters = body["parameters"];
  }

  const expectedQueryIdShort = report.queryId.slice(0, 8);
  const normalizedNameMatches = normalizeText(definition.name) === normalizeText(report.name);
  const tenantMatches =
    !definition.tenantName ||
    normalizeText(definition.tenantName) === normalizeText(env.DRAKE_CONTEXT_NAME);
  const parameterCount = Array.isArray(definition.parameters)
    ? definition.parameters.length
    : report.parameterTemplate.length;

  if (definition.id && definition.id !== report.queryId) {
    logger.error("drake-report", "Validacao falhou: queryIdMismatch", {
      reportCode: report.code,
      expectedQueryId: expectedQueryIdShort,
    });
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `queryId divergente para relatorio ${report.code}.`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: { validationFailure: "queryIdMismatch" },
    });
  }
  if (definition.code !== report.code) {
    logger.error("drake-report", "Validacao falhou: codeMismatch", {
      reportCode: report.code,
      returnedCode: definition.code,
    });
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Codigo divergente para query: esperado ${report.code}, obtido ${definition.code}.`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: { validationFailure: "codeMismatch", returnedCode: definition.code },
    });
  }
  if (!normalizedNameMatches) {
    logger.error("drake-report", "Validacao falhou: nameMismatch", { reportCode: report.code });
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Nome divergente para relatorio ${report.code}.`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: { validationFailure: "nameMismatch" },
    });
  }
  if (!tenantMatches) {
    logger.error("drake-report", "Validacao falhou: tenantMismatch", { reportCode: report.code });
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Tenant divergente para relatorio ${report.code}.`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: { validationFailure: "tenantMismatch" },
    });
  }
  if (definition.enabled === false) {
    logger.error("drake-report", "Validacao falhou: disabled", { reportCode: report.code });
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Relatorio ${report.code} esta desabilitado.`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: { validationFailure: "disabled" },
    });
  }

  const enabledFlag = definition.enabled ?? true;

  if (
    Array.isArray(definition.parameters) &&
    definition.parameters.length > 0 &&
    definition.parameters.length !== report.parameterTemplate.length
  ) {
    logger.error("drake-report", "Validacao falhou: parameterCountMismatch", {
      reportCode: report.code,
      parameterCount: definition.parameters.length,
    });
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Quantidade de parametros da definicao mudou para relatorio ${report.code}.`,
      stage: "validate-query-definition",
      reportCode: report.code,
      details: {
        validationFailure: "parameterCountMismatch",
        expected: report.parameterTemplate.length,
        obtained: definition.parameters.length,
      },
    });
  }

  logger.info("drake-report", `Definicao do relatorio ${report.code} validada`, {
    reportCode: report.code,
    stage: "validate-query-definition",
    expectedQueryId: expectedQueryIdShort,
    returnedCode: definition.code,
    normalizedNameMatches,
    enabled: enabledFlag,
    tenantMatches,
    parameterCount,
    queryType: definition.queryType ?? report.queryType,
  });

  return definition;
}

async function writeFailureDiagnostic(args: {
  report: DrakeApiReportDefinition;
  stage: string;
  endpoint: string;
  result: HttpResult | null;
  parameterNames: string[];
  parameterCount: number;
  strategyUsed: StrategyUsed;
  startedAtMs: number;
  message: string;
  requiredFields?: string[];
}): Promise<void> {
  const diagnostic: ApiReportDiagnostic = {
    stage: args.stage,
    httpStatus: args.result?.status ?? null,
    endpoint: sanitizeEndpoint(args.endpoint),
    reportCode: args.report.code,
    queryId: args.report.queryId,
    parameterCount: args.parameterCount,
    parameterNames: args.parameterNames,
    jobStatus: null,
    strategyUsed: args.strategyUsed,
    signalRUsed: false,
    errorMessage: sanitizeMessage(args.message),
    durationMs: Date.now() - args.startedAtMs,
    timestamp: new Date().toISOString(),
  };
  if (args.result?.contentType) {
    diagnostic.contentType = args.result.contentType;
  }
  if (args.requiredFields && args.requiredFields.length > 0) {
    diagnostic.requiredFields = args.requiredFields;
  }
  await dumpDiagnostic(diagnostic);
}

async function exportToExcel(
  request: APIRequestContext,
  payload: DrakeExportRequest,
  reportCode: number,
  attempt = 1,
): Promise<HttpResult> {
  return postJson(request, EXPORT_URL, payload, {
    stage: "export-to-excel",
    reportCode,
    attempt,
  });
}

async function executeQuery(
  request: APIRequestContext,
  payload: DrakeExecuteRequest,
  reportCode: number,
): Promise<HttpResult> {
  return postJson(request, EXECUTE_URL, payload, {
    stage: "execute-query",
    reportCode,
  });
}

function extractExportCorrelationIds(json: unknown): Record<string, string | null> {
  if (!isRecord(json)) {
    return {
      jobId: null,
      scheduledBackgroundJobId: null,
      requestId: null,
      executionRequestId: null,
    };
  }
  const pick = (key: string): string | null => {
    const value = json[key];
    if (typeof value !== "string" || !value.trim()) return null;
    return shortId(value);
  };
  return {
    jobId: pick("jobId"),
    scheduledBackgroundJobId: pick("scheduledBackgroundJobId"),
    requestId: pick("requestId"),
    executionRequestId: pick("executionRequestId"),
  };
}

function logExportAccepted(
  report: DrakeApiReportDefinition,
  result: HttpResult,
  strategyUsed: StrategyUsed,
  payload: DrakeExportRequest,
  preparedMeta: { names: string[]; count: number },
  signalRFieldPresent: boolean,
): void {
  const signalRValue = payload.signalRConnectionId;
  const signalRProvided = typeof signalRValue === "string";
  const signalREmpty = signalRProvided && signalRValue.trim() === "";
  const correlation = extractExportCorrelationIds(result.json);
  logger.info("drake-export", `Exportacao do relatorio ${report.code} aceita pelo Drake`, {
    reportCode: report.code,
    status: result.status,
    contentType: result.contentType ?? null,
    contentLength:
      typeof result.text === "string" ? String(result.text.length) : result.json ? "json" : "0",
    responseHasBody: Boolean(result.text || result.json),
    responseKeys: isRecord(result.json) ? Object.keys(result.json).slice(0, 20) : [],
    durationMs: result.durationMs,
    queryCode: payload.queryCode ?? report.code,
    queryIdShort: shortId(report.queryId),
    parameterCount: preparedMeta.count,
    signalRConnectionIdSent: signalRProvided,
    signalRConnectionIdEmpty: signalREmpty,
    signalRFieldPresent,
    strategyUsed,
    ...correlation,
  });
  if (!signalRProvided) {
    logger.info("drake-export", "ExportToExcel sem signalRConnectionId no payload", {
      reportCode: report.code,
      divergence: "captura-historica-pode-incluir-campo",
    });
  }
}

async function sendExportWithSignalRFallback(
  request: APIRequestContext,
  payload: DrakeExportRequest,
  report: DrakeApiReportDefinition,
  preparedMeta: { names: string[]; count: number },
  strategyUsed: StrategyUsed,
  startedAtMs: number,
): Promise<HttpResult & { signalRProvided: boolean; exportHadBody: boolean }> {
  let result = await exportToExcel(request, payload, report.code);
  let signalRProvided = typeof payload.signalRConnectionId === "string";
  if (assert2xx(result)) {
    logExportAccepted(report, result, strategyUsed, payload, preparedMeta, signalRProvided);
    return {
      ...result,
      signalRProvided,
      exportHadBody: Boolean(result.text || result.json),
    };
  }

  const message = extractResponseMessage(result);
  if ((result.status === 400 || result.status === 422) && mentionsSignalR(message)) {
    logger.warn("drake-export", "API exigiu signalRConnectionId; tentando string vazia", {
      reportCode: report.code,
      status: result.status,
    });
    const retryPayload: DrakeExportRequest = {
      ...payload,
      signalRConnectionId: "",
    };
    signalRProvided = true;
    result = await exportToExcel(request, retryPayload, report.code, 2);
    if (assert2xx(result)) {
      logExportAccepted(report, result, strategyUsed, retryPayload, preparedMeta, true);
      return {
        ...result,
        signalRProvided: true,
        exportHadBody: Boolean(result.text || result.json),
      };
    }
    const retryMessage = extractResponseMessage(result);
    if (mentionsSignalR(retryMessage)) {
      await writeFailureDiagnostic({
        report,
        stage: "export",
        endpoint: EXPORT_URL,
        result,
        parameterNames: preparedMeta.names,
        parameterCount: preparedMeta.count,
        strategyUsed,
        startedAtMs,
        message: retryMessage,
        requiredFields: ["signalRConnectionId"],
      });
      throw new DrakeIntegrationError({
        code: DRAKE_SIGNALR_REQUIRED_FOR_EXPORT,
        message: "O Drake nao iniciou a exportacao do relatorio.",
        stage: "export-to-excel",
        reportCode: report.code,
        details: { signalRProvided: true, signalREmptyAccepted: false },
      });
    }
  }

  if (mentionsExecuteRequired(message)) {
    throw new Error(`EXECUTE_REQUIRED: ${sanitizeMessage(message)}`);
  }

  await writeFailureDiagnostic({
    report,
    stage: "export",
    endpoint: EXPORT_URL,
    result,
    parameterNames: preparedMeta.names,
    parameterCount: preparedMeta.count,
    strategyUsed,
    startedAtMs,
    message,
    requiredFields: requiredFieldsFromMessage(message),
  });
  throw new Error(`ExportToExcel do relatorio ${report.code} falhou com status ${result.status}.`);
}

async function executeWithSignalRFallback(
  request: APIRequestContext,
  payload: DrakeExecuteRequest,
  report: DrakeApiReportDefinition,
  preparedMeta: { names: string[]; count: number },
  startedAtMs: number,
): Promise<void> {
  let result = await executeQuery(request, payload, report.code);
  if (assert2xx(result)) {
    return;
  }

  const message = extractResponseMessage(result);
  if ((result.status === 400 || result.status === 422) && mentionsSignalR(message)) {
    result = await executeQuery(
      request,
      {
        ...payload,
        signalRConnectionId: "",
      },
      report.code,
    );
    if (assert2xx(result)) {
      return;
    }
    if (mentionsSignalR(extractResponseMessage(result))) {
      await writeFailureDiagnostic({
        report,
        stage: "execute",
        endpoint: EXECUTE_URL,
        result,
        parameterNames: preparedMeta.names,
        parameterCount: preparedMeta.count,
        strategyUsed: "execute-then-export",
        startedAtMs,
        message: extractResponseMessage(result),
        requiredFields: ["signalRConnectionId"],
      });
      throw new Error("A API do Drake exigiu uma conexao SignalR ativa para exportar o relatorio.");
    }
  }

  await writeFailureDiagnostic({
    report,
    stage: "execute",
    endpoint: EXECUTE_URL,
    result,
    parameterNames: preparedMeta.names,
    parameterCount: preparedMeta.count,
    strategyUsed: "execute-then-export",
    startedAtMs,
    message,
    requiredFields: requiredFieldsFromMessage(message),
  });
  throw new Error(`Execute do relatorio ${report.code} falhou com status ${result.status}.`);
}

async function requestExportJob(args: {
  request: APIRequestContext;
  report: DrakeApiReportDefinition;
  payload: DrakeExportRequest;
  preparedMeta: { names: string[]; count: number };
  startedAtMs: number;
  signalRSession: DrakeSignalRSession;
}): Promise<{
  strategyUsed: StrategyUsed;
  exportStartedAt: Date;
  exportHttpStatus: number | null;
  exportHadBody: boolean;
  signalRProvided: boolean;
  scheduledBackgroundJobIdPresent: boolean;
  download: {
    zipFile: string;
    zipFileName: string;
    status: string;
    backgroundCode: number | null;
  };
}> {
  const signalRConnectionId = args.signalRSession.connectionId.trim();
  if (!signalRConnectionId) {
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_REQUIRED_FOR_EXPORT,
      message: "O Drake nao iniciou a exportacao do relatorio.",
      stage: "export-to-excel",
      reportCode: args.report.code,
    });
  }

  const executionRequestId = randomUUID();
  const executePayload: DrakeExecuteRequest = {
    executionParameters: args.payload.params,
    queryId: args.report.queryId,
    skip: 0,
    take: 10,
    executionRequestId,
    signalRConnectionId,
    queryType: args.report.queryType,
  };

  logger.info("drake-execute", "Executando consulta", {
    reportCode: args.report.code,
    parameterCount: args.preparedMeta.count,
    requestIdGenerated: true,
    signalRProvided: true,
    queryType: args.report.queryType,
    skip: 0,
    take: 10,
  });

  const executeStarted = Date.now();
  const executeResult = await executeQuery(args.request, executePayload, args.report.code);
  if (!assert2xx(executeResult)) {
    throw new DrakeIntegrationError({
      code: DRAKE_QUERY_EXECUTION_NOT_CREATED,
      message: `Execute do relatorio ${args.report.code} falhou com status ${executeResult.status}.`,
      stage: "execute-query",
      reportCode: args.report.code,
      details: { status: executeResult.status },
    });
  }

  const executeJson = isRecord(executeResult.json) ? executeResult.json : null;
  const scheduled = executeJson?.scheduled === true;
  const scheduledBackgroundJobId =
    typeof executeJson?.scheduledBackgroundJobId === "string"
      ? executeJson.scheduledBackgroundJobId
      : null;
  const rowCount = Array.isArray(executeJson?.rows) ? executeJson.rows.length : null;
  const columnCount = Array.isArray(executeJson?.columns) ? executeJson.columns.length : null;
  const totalRows =
    typeof executeJson?.totalRows === "number" ? executeJson.totalRows : null;

  logger.info("drake-execute", "Consulta aceita", {
    reportCode: args.report.code,
    status: executeResult.status,
    durationMs: executeResult.durationMs ?? Date.now() - executeStarted,
    scheduled,
    scheduledJobProvided: Boolean(scheduledBackgroundJobId),
    rowCount,
    columnCount,
    totalRows,
    responseKeys: executeJson ? Object.keys(executeJson).slice(0, 20) : [],
  });

  // Captura: Execute retorna scheduled+jobId; acompanhamento comprovado via SignalR
  // (BackgroundExecutionRequest*), nao via getRequestsByCodes?code=5359.
  if (!scheduled && !scheduledBackgroundJobId && (rowCount == null || rowCount === 0)) {
    throw new DrakeIntegrationError({
      code: DRAKE_QUERY_EXECUTION_NOT_CREATED,
      message:
        "A consulta foi aceita, mas nenhuma execucao observavel foi criada no Drake.",
      stage: "execute-query",
      reportCode: args.report.code,
      details: {
        scheduled,
        scheduledJobProvided: false,
        rowCount,
      },
    });
  }

  const exportPayload: DrakeExportRequest = {
    ...args.payload,
    signalRConnectionId,
  };
  const exportStartedAt = new Date();
  args.signalRSession.armDownloadWatch();

  logger.info("drake-export", `Solicitando exportacao do relatorio ${args.report.code}`, {
    reportCode: args.report.code,
    stage: "export-to-excel",
    attempt: 1,
  });

  const exportResult = await sendExportWithSignalRFallback(
    args.request,
    exportPayload,
    args.report,
    args.preparedMeta,
    "execute-then-export",
    args.startedAtMs,
  );

  logger.info("drake-export", "Aguardando arquivo pelo canal de processamento", {
    reportCode: args.report.code,
    stage: "waiting-signalr-download",
    timeoutMs: env.DRAKE_EXPORT_TIMEOUT_MS,
  });

  const ready = await args.signalRSession.waitForDownloadReady({
    timeoutMs: env.DRAKE_EXPORT_TIMEOUT_MS,
  });

  logger.info("drake-export", "Arquivo pronto para download", {
    reportCode: args.report.code,
    stage: "waiting-signalr-download",
    status: ready.status,
    backgroundCodePresent: ready.backgroundCode != null,
    hasZipFile: true,
    hasZipFileName: true,
  });

  return {
    strategyUsed: "execute-then-export",
    exportStartedAt,
    exportHttpStatus: exportResult.status,
    exportHadBody: exportResult.exportHadBody,
    signalRProvided: true,
    scheduledBackgroundJobIdPresent: Boolean(scheduledBackgroundJobId),
    download: {
      zipFile: ready.zipFile,
      zipFileName: ready.zipFileName,
      status: ready.status,
      backgroundCode: ready.backgroundCode,
    },
  };
}

export async function runSingleApiReport(
  request: APIRequestContext,
  report: DrakeApiReportDefinition,
  options: RunSingleApiReportOptions,
): Promise<ApiDownloadedReport> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  let strategyUsed: StrategyUsed = "execute-then-export";
  const signalRSession = options.signalRSession;
  const signalRConnectionId = signalRSession.connectionId.trim();
  if (!signalRConnectionId) {
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_REQUIRED_FOR_EXPORT,
      message: "O Drake nao iniciou a exportacao do relatorio.",
      stage: "run-single-report",
      reportCode: report.code,
    });
  }
  patchDrakeLogContext({ reportCode: report.code, stage: "run-single-report" });

  try {
    await validateQueryDefinition(request, report);

    const prepared = buildReportParameters(report, env.DRAKE_TIMEZONE);
    const preparedMeta = {
      names: prepared.parameters.map((item) => item.name),
      count: prepared.parameters.length,
    };
    const hasEmptyRequiredParameter = prepared.parameters.some((p) => {
      const isRequiredDate = /@INI|@FIM|^INI$|^FIM$|data.?inicio|data.?fim/i.test(p.name);
      if (!isRequiredDate) return false;
      return !String(p.value ?? "").trim();
    });
    logger.info("drake-report", "Parametros do relatorio preparados", {
      reportCode: report.code,
      stage: "prepare-parameters",
      parameterCount: preparedMeta.count,
      parameterNames: preparedMeta.names,
      startParameterFound: preparedMeta.names.some((n) => /@INI|inicio|start|data.?ini/i.test(n)),
      endParameterFound: preparedMeta.names.some((n) => /@FIM|fim|end|ate|até|data.?fim/i.test(n)),
      humanStartDate: prepared.human.startDate,
      humanEndDate: prepared.human.endDate,
      apiDateFormat: "yyyy-MM-dd",
      hasEmptyRequiredParameter,
    });
    if (hasEmptyRequiredParameter) {
      throw new DrakeIntegrationError({
        code: "DRAKE_EXPORT_FAILED",
        message: `Parametro de periodo obrigatorio vazio para relatorio ${report.code}.`,
        stage: "prepare-parameters",
        reportCode: report.code,
      });
    }

    const exportPayload: DrakeExportRequest = {
      params: prepared.parameters,
      queryId: report.queryId,
      queryCode: report.code,
      queryName: report.name,
      signalRConnectionId,
    };

    const requested = await requestExportJob({
      request,
      report,
      payload: exportPayload,
      preparedMeta,
      startedAtMs,
      signalRSession,
    });
    strategyUsed = requested.strategyUsed;

    try {
      const source = {
        documentId: requested.download.zipFile,
        originalUrl: requested.download.zipFileName,
        source: "job" as const,
      };
      const downloaded = await downloadReportFile(request, report, source);
      const finishedAt = new Date().toISOString();

      return {
        reportCode: report.code,
        reportName: report.name,
        queryId: report.queryId,
        queryCode: report.code,
        queryName: report.name,
        strategyUsed,
        signalRUsed: true,
        period: {
          startDate: prepared.human.startDate,
          endDate: prepared.human.endDate,
          apiStartDate: prepared.apiStartDate,
          apiEndDate: prepared.apiEndDate,
          timeZone: prepared.timeZone,
        },
        filePath: downloaded.finalPath,
        buffer: downloaded.buffer,
        sizeBytes: downloaded.sizeBytes,
        extension: downloaded.extension,
        sha256: downloaded.sha256,
        startedAt,
        finishedAt,
        success: true,
        error: null,
      };
    } catch (error: unknown) {
      if (
        error instanceof DrakeIntegrationError &&
        (error.code === "DRAKE_BACKGROUND_JOB_NOT_CREATED" ||
          error.code === DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB)
      ) {
        throw new DrakeIntegrationError({
          code: DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB,
          message:
            report.code === 1
              ? "O Drake aceitou a solicitação, mas não gerou o arquivo de embarque."
              : "O Drake aceitou a solicitação, mas não gerou o arquivo de disponibilidade.",
          stage: error.stage,
          reportCode: report.code,
          progress: error.progress,
          details: error.details,
          cause: error,
        });
      }
      throw error;
    }
  } catch (error: unknown) {
    if (error instanceof DrakeIntegrationError) {
      await dumpDiagnostic({
        stage: String(error.stage),
        httpStatus: null,
        endpoint: "/api/v2/Queries/Query",
        reportCode: report.code,
        queryId: report.queryId,
        parameterCount: report.parameterTemplate.length,
        parameterNames: report.parameterTemplate.map((item) => item.name),
        jobStatus: null,
        strategyUsed,
        signalRUsed: false,
        errorMessage: error.message,
        durationMs: Date.now() - startedAtMs,
        timestamp: new Date().toISOString(),
      }).catch(() => undefined);
      throw error;
    }
    const safeError = sanitizeError(error);
    await dumpDiagnostic({
      stage: "run-single",
      httpStatus: null,
      endpoint: "/api/v2/Queries/Query",
      reportCode: report.code,
      queryId: report.queryId,
      parameterCount: report.parameterTemplate.length,
      parameterNames: report.parameterTemplate.map((item) => item.name),
      jobStatus: null,
      strategyUsed,
      signalRUsed: false,
      errorMessage: safeError.message,
      durationMs: Date.now() - startedAtMs,
      timestamp: new Date().toISOString(),
    }).catch(() => undefined);
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: safeError.message,
      stage: "run-single-report",
      reportCode: report.code,
      cause: error,
    });
  }
}
