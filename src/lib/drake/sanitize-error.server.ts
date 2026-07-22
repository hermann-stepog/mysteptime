import "@tanstack/react-start/server-only";
import { env } from "./config.server";

export interface SanitizedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
}

const MAX_TEXT_LENGTH = 8000;
const REDACTED = "[REDACTED]";
const TRUNCATED = "...[TRUNCATED]";

const KNOWN_COOKIES = [
  "ASP.NET_SessionId",
  "SapiensiaAuth",
  "SapiensiaAuth1",
  "ARRAffinity",
  "ARRAffinitySameSite",
  "ASLBSA",
  "ASLBSACORS",
] as const;

const TLS_ERROR_PATTERN =
  /self-signed certificate|unable to verify the first certificate|certificate in certificate chain|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i;

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|senha|session|cookie|auth|apikey|api-key|signature/i;

function truncateText(value: string): string {
  if (value.length <= MAX_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_TEXT_LENGTH)}${TRUNCATED}`;
}

export function sanitizeSensitiveText(value: string): string {
  let result = value;

  result = result.replace(
    /^(cookie|set-cookie|authorization|proxy-authorization|x-csrf-token|x-xsrf-token|csrf-token|xsrf-token)\s*:\s*.*$/gim,
    `$1: ${REDACTED}`,
  );

  result = result.replace(
    /^(Cookie|Set-Cookie|Authorization|Proxy-Authorization)\s*=\s*.*$/gim,
    `$1=${REDACTED}`,
  );

  for (const cookieName of KNOWN_COOKIES) {
    const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`(${escaped})\\s*=\\s*[^;\\s\\]"']+`, "gi"),
      `$1=${REDACTED}`,
    );
  }

  result = result.replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`);

  result = result.replace(
    /([?&](?:token|session|auth|key|signature|password|senha)=)[^&\s"'<>]+/gi,
    `$1${REDACTED}`,
  );

  result = result.replace(
    new RegExp(`(\\b[\\w.-]*${SENSITIVE_KEY_PATTERN.source}[\\w.-]*)\\s*=\\s*[^;\\s\\]"']+`, "gi"),
    `$1=${REDACTED}`,
  );

  return truncateText(result);
}

function collectErrorParts(error: unknown, depth = 0): string[] {
  if (depth > 6) {
    return [];
  }
  if (error === null || error === undefined) {
    return [];
  }
  if (typeof error === "string") {
    return [error];
  }
  if (typeof error === "number" || typeof error === "boolean") {
    return [String(error)];
  }
  if (Array.isArray(error)) {
    return error.flatMap((item) => collectErrorParts(item, depth + 1));
  }
  if (typeof error !== "object") {
    return [String(error)];
  }

  const record = error as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record["message"] === "string") {
    parts.push(record["message"]);
  }
  if (typeof record["stack"] === "string") {
    parts.push(record["stack"]);
  }
  if (typeof record["name"] === "string") {
    parts.push(record["name"]);
  }
  if (typeof record["code"] === "string") {
    parts.push(record["code"]);
  }
  if (Array.isArray(record["log"])) {
    parts.push(...record["log"].map((item) => String(item)));
  }
  if (record["cause"] !== undefined) {
    parts.push(...collectErrorParts(record["cause"], depth + 1));
  }

  return parts;
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) {
      return code;
    }
  }
  return undefined;
}

export function isTlsCertificateError(error: unknown): boolean {
  const text = collectErrorParts(error).join("\n");
  return TLS_ERROR_PATTERN.test(text);
}

export function formatTlsCertificateErrorMessage(): string {
  if (env.DRAKE_IGNORE_HTTPS_ERRORS !== true) {
    return [
      "Falha de validacao TLS ao acessar o Drake.",
      "O ambiente utiliza uma cadeia de certificados nao reconhecida. Configure a CA corporativa ou habilite DRAKE_IGNORE_HTTPS_ERRORS somente neste ambiente autorizado.",
    ].join("\n");
  }
  return [
    "Falha de validacao TLS ao acessar o Drake.",
    "DRAKE_IGNORE_HTTPS_ERRORS esta habilitado, mas o contexto HTTP nao recebeu a configuracao corretamente.",
  ].join("\n");
}

export function sanitizeError(error: unknown): SanitizedError {
  if (isTlsCertificateError(error)) {
    const sanitized: SanitizedError = {
      name: "TlsCertificateError",
      message: formatTlsCertificateErrorMessage(),
    };
    const code = extractErrorCode(error);
    if (code) {
      sanitized.code = code;
    }
    if (env.DRAKE_DEBUG_SAFE_STACK === true && error instanceof Error && error.stack) {
      sanitized.stack = sanitizeSensitiveText(error.stack);
    }
    return sanitized;
  }

  const name = error instanceof Error && error.name ? sanitizeSensitiveText(error.name) : "Error";
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : collectErrorParts(error).join(" | ") || "Erro desconhecido";
  const message = sanitizeSensitiveText(rawMessage);

  const sanitized: SanitizedError = { name, message };
  const code = extractErrorCode(error);
  if (code) {
    sanitized.code = sanitizeSensitiveText(code);
  }
  if (env.DRAKE_DEBUG_SAFE_STACK === true && error instanceof Error && error.stack) {
    sanitized.stack = sanitizeSensitiveText(error.stack);
  }
  return sanitized;
}
