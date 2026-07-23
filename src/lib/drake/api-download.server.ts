import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import { env } from "./config.server";
import { ensureParentDirectory, writeFileAtomic } from "./drake-files.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger } from "./logger";
import { getDownloadsDir, sanitizeFileName } from "./filesystem.server";
import type { BackgroundExecutionRequestItem, DrakeApiReportDefinition } from "./api-report-types";
import { DRAKE_FILE_VALIDATION_FAILED } from "./update-types";

const XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface ResolvedDownloadSource {
  documentId: string;
  originalUrl: string;
  source: "job";
}

export function buildDownloadTemporaryFileUrl(documentId: string, originalUrl: string): string {
  const params = new URLSearchParams({
    documentId,
    originalUrl,
  });
  return `/api/v2/DMS/DownloadTemporaryFile?${params.toString()}`;
}

export function resolveDownloadSource(job: BackgroundExecutionRequestItem): ResolvedDownloadSource {
  if (job.zipFile && job.zipFileName) {
    return {
      documentId: job.zipFile,
      originalUrl: job.zipFileName,
      source: "job",
    };
  }

  throw new Error("Nao foi possivel resolver documentId/originalUrl para download.");
}

function formatStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function uniquePath(dir: string, baseName: string, extension: string): Promise<string> {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const safeBase = sanitizeFileName(baseName).replace(/\.[^.]+$/, "") || "report";
  let candidate = path.resolve(dir, `${safeBase}${ext}`);
  let index = 1;
  while (true) {
    try {
      await access(candidate);
      candidate = path.resolve(dir, `${safeBase}-${index}${ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

export async function validateSpreadsheetBuffer(
  buffer: Buffer,
  extension: string,
  contentType: string,
): Promise<{
  detectedFormat: string;
  signatureMatches: boolean;
  contentTypeMatches: boolean;
  looksLikeHtml: boolean;
  looksLikeLoginPage: boolean;
}> {
  const looksLikeHtml =
    /text\/html/i.test(contentType) ||
    buffer.subarray(0, 64).toString("utf8").toLowerCase().includes("<html") ||
    buffer.subarray(0, 64).toString("utf8").toLowerCase().includes("<!doctype");
  const head = buffer.subarray(0, 64).toString("utf8").toLowerCase();
  const looksLikeLoginPage = looksLikeHtml && /logon|login|senha|password|sign\s*in/i.test(head);

  if (buffer.byteLength <= 0) {
    throw new DrakeIntegrationError({
      code: DRAKE_FILE_VALIDATION_FAILED,
      message: "Arquivo baixado vazio.",
      stage: "validate-download",
      details: { validationFailure: "empty" },
    });
  }
  if (/text\/html/i.test(contentType) || looksLikeHtml) {
    throw new DrakeIntegrationError({
      code: DRAKE_FILE_VALIDATION_FAILED,
      message: looksLikeLoginPage
        ? "Download parece pagina de login."
        : "Download retornou HTML em vez de planilha.",
      stage: "validate-download",
      details: {
        validationFailure: looksLikeLoginPage ? "login-html" : "html",
        looksLikeHtml,
        looksLikeLoginPage,
      },
    });
  }
  if (head.includes("/logon") || head.includes('{"')) {
    throw new DrakeIntegrationError({
      code: DRAKE_FILE_VALIDATION_FAILED,
      message: "Download parece pagina de login, HTML ou JSON.",
      stage: "validate-download",
      details: { validationFailure: "login-or-json" },
    });
  }

  const ext = extension.toLowerCase();
  let detectedFormat = ext.replace(".", "") || "unknown";
  let signatureMatches = false;
  if (ext === ".xls") {
    signatureMatches =
      buffer.subarray(0, 8).equals(XLS_SIGNATURE) || buffer.subarray(0, 4).equals(XLSX_SIGNATURE);
    if (!signatureMatches) {
      throw new DrakeIntegrationError({
        code: DRAKE_FILE_VALIDATION_FAILED,
        message: "Assinatura invalida para arquivo XLS.",
        stage: "validate-download",
        details: { validationFailure: "signature", detectedFormat },
      });
    }
    if (buffer.subarray(0, 4).equals(XLSX_SIGNATURE)) detectedFormat = "xlsx";
    else detectedFormat = "xls";
  } else if (ext === ".xlsx" || ext === ".zip") {
    signatureMatches = buffer.subarray(0, 4).equals(XLSX_SIGNATURE);
    if (!signatureMatches) {
      throw new DrakeIntegrationError({
        code: DRAKE_FILE_VALIDATION_FAILED,
        message: "Assinatura invalida para arquivo XLSX/ZIP.",
        stage: "validate-download",
        details: { validationFailure: "signature", detectedFormat },
      });
    }
    detectedFormat = "xlsx";
  } else if (ext === ".csv") {
    signatureMatches = /csv|text\/plain/i.test(contentType) || buffer.includes(Buffer.from(","));
    if (!signatureMatches) {
      throw new DrakeIntegrationError({
        code: DRAKE_FILE_VALIDATION_FAILED,
        message: "Conteudo nao parece CSV.",
        stage: "validate-download",
        details: { validationFailure: "csv", detectedFormat: "csv" },
      });
    }
    detectedFormat = "csv";
  } else {
    signatureMatches = true;
  }

  const contentTypeMatches = !/json|html/i.test(contentType);
  return {
    detectedFormat,
    signatureMatches,
    contentTypeMatches,
    looksLikeHtml,
    looksLikeLoginPage,
  };
}

function extensionFromDisposition(disposition: string): string | null {
  const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(disposition);
  if (!match?.[1]) {
    return null;
  }
  const ext = path.extname(sanitizeFileName(decodeURIComponent(match[1])));
  return ext || null;
}

export async function downloadReportFile(
  request: DrakeHttpClient,
  report: DrakeApiReportDefinition,
  source: ResolvedDownloadSource,
): Promise<{
  finalPath: string | null;
  buffer: Buffer;
  sizeBytes: number;
  extension: string;
  sha256: string;
}> {
  const started = Date.now();
  logger.info("drake-download", "Iniciando download do relatorio", {
    reportCode: report.code,
    stage: "download-report",
  });
  const relativeUrl = buildDownloadTemporaryFileUrl(source.documentId, source.originalUrl);

  const response = await request.get(relativeUrl, {
    failOnStatusCode: false,
    maxRedirects: 10,
    timeout: env.DRAKE_REPORT_DOWNLOAD_TIMEOUT_MS,
  });

  const status = response.status();
  if (/\/logon/i.test(response.url())) {
    throw new DrakeIntegrationError({
      code: DRAKE_FILE_VALIDATION_FAILED,
      message: "Download redirecionou para a tela de login.",
      stage: "download-report",
      reportCode: report.code,
    });
  }
  if (status < 200 || status >= 300) {
    throw new DrakeIntegrationError({
      code: "DRAKE_EXPORT_FAILED",
      message: `Download do relatorio ${report.code} falhou com status ${status}.`,
      stage: "download-report",
      reportCode: report.code,
      details: { status },
    });
  }

  const headers = response.headers();
  const contentType = headers["content-type"] ?? "";
  if (/json/i.test(contentType)) {
    throw new DrakeIntegrationError({
      code: DRAKE_FILE_VALIDATION_FAILED,
      message: "Download retornou JSON em vez de planilha.",
      stage: "download-report",
      reportCode: report.code,
    });
  }
  const disposition = headers["content-disposition"] ?? "";
  const buffer = Buffer.from(await response.body());
  const fromName = path.extname(sanitizeFileName(source.originalUrl));
  const fromDisposition = extensionFromDisposition(disposition);
  const extension = fromName || fromDisposition || ".xls";

  logger.info("drake-download", "Validando arquivo recebido", {
    reportCode: report.code,
    stage: "validate-download",
    sizeBytes: buffer.byteLength,
    extension,
  });
  const validation = await validateSpreadsheetBuffer(buffer, extension, contentType);
  logger.info("drake-download", "Arquivo recebido validado", {
    reportCode: report.code,
    stage: "validate-download",
    sizeBytes: buffer.byteLength,
    extension,
    ...validation,
  });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const signature = buffer.subarray(0, 4).equals(XLSX_SIGNATURE)
    ? "PK"
    : buffer.subarray(0, 8).equals(XLS_SIGNATURE)
      ? "OLE"
      : "other";

  let finalPath: string | null = null;
  if (env.DRAKE_KEEP_TEMP_FILES) {
    const dir = getDownloadsDir();
    await ensureParentDirectory(path.join(dir, "placeholder"));
    finalPath = await uniquePath(dir, `${report.outputBaseName}-${formatStamp()}`, extension);
    await writeFileAtomic(finalPath, buffer);
  }

  logger.info("drake-download", "Download do relatorio concluido", {
    reportCode: report.code,
    stage: "download-report",
    status,
    contentType,
    sizeBytes: buffer.byteLength,
    extension,
    signature,
    durationMs: Date.now() - started,
  });

  return {
    finalPath,
    buffer,
    sizeBytes: buffer.byteLength,
    extension,
    sha256,
  };
}
