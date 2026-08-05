/**
 * Códigos e mensagens de erro da autenticação do APLICATIVO (Supabase).
 *
 * Módulo puro (sem imports de Node) — pode ser importado tanto pelo backend
 * quanto pelo card no frontend. Não confundir com os códigos de sessão do
 * Drake (DRAKE_*), que pertencem a outra autenticação independente.
 */

export const APP_SESSION_INVALID = "APP_SESSION_INVALID";
export const SUPABASE_TLS_ERROR = "SUPABASE_TLS_ERROR";
export const SUPABASE_UNAVAILABLE = "SUPABASE_UNAVAILABLE";
export const APP_AUTH_VALIDATION_FAILED = "APP_AUTH_VALIDATION_FAILED";

export type AppAuthErrorCode =
  | typeof APP_SESSION_INVALID
  | typeof SUPABASE_TLS_ERROR
  | typeof SUPABASE_UNAVAILABLE
  | typeof APP_AUTH_VALIDATION_FAILED;

export const APP_AUTH_ERROR_MESSAGES: Record<AppAuthErrorCode, string> = {
  [APP_SESSION_INVALID]: "Sua sessão no aplicativo expirou. Entre novamente.",
  [SUPABASE_TLS_ERROR]: "Não foi possível validar sua sessão no aplicativo.",
  [SUPABASE_UNAVAILABLE]: "O serviço de autenticação do aplicativo está indisponível.",
  [APP_AUTH_VALIDATION_FAILED]: "Não foi possível validar a autenticação do aplicativo.",
};

/** Erros definitivos — o card deve interromper o polling ao recebê-los. */
export const FATAL_APP_AUTH_CODES: readonly AppAuthErrorCode[] = [
  APP_SESSION_INVALID,
  SUPABASE_TLS_ERROR,
  SUPABASE_UNAVAILABLE,
  APP_AUTH_VALIDATION_FAILED,
];

export class AppAuthError extends Error {
  readonly code: AppAuthErrorCode;

  constructor(code: AppAuthErrorCode) {
    super(APP_AUTH_ERROR_MESSAGES[code]);
    this.name = "AppAuthError";
    this.code = code;
  }
}

const TLS_ERROR_PATTERN =
  /SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|CERT_HAS_EXPIRED|self-signed certificate|certificate in certificate chain|unable to verify the first certificate/i;

const NETWORK_ERROR_PATTERN = /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET/i;

const MAX_CAUSE_DEPTH = 8;

function collectErrorText(error: unknown, depth = 0): string[] {
  if (depth > MAX_CAUSE_DEPTH || error == null) return [];
  if (typeof error === "string") return [error];
  if (typeof error !== "object") return [String(error)];

  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.message === "string") parts.push(record.message);
  if (typeof record.code === "string") parts.push(record.code);
  if (typeof record.name === "string") parts.push(record.name);
  if (record.cause !== undefined) parts.push(...collectErrorText(record.cause, depth + 1));
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) parts.push(...collectErrorText(item, depth + 1));
  }
  return parts;
}

/**
 * Classifica falhas de INFRAESTRUTURA ao consultar o Supabase (TLS ou rede).
 * Retorna null quando o erro não é de infraestrutura (ex.: JWT inválido),
 * caso em que o chamador deve tratar como sessão de aplicativo inválida.
 * Inspeciona recursivamente message, code, name e cause.
 */
export function classifySupabaseInfraError(
  error: unknown,
): typeof SUPABASE_TLS_ERROR | typeof SUPABASE_UNAVAILABLE | null {
  const text = collectErrorText(error).join("\n");
  if (!text) return null;
  if (TLS_ERROR_PATTERN.test(text)) return SUPABASE_TLS_ERROR;
  if (NETWORK_ERROR_PATTERN.test(text)) return SUPABASE_UNAVAILABLE;
  return null;
}

const ENCODED_PATTERN = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s;

/** Serializa código + mensagem para atravessar a fronteira da server function. */
export function encodeAppAuthError(error: AppAuthError): string {
  return `${error.code}: ${error.message}`;
}

/** Extrai o código e a mensagem limpa de um erro vindo de uma server function. */
export function decodeAppAuthMessage(message: string): {
  code: AppAuthErrorCode | null;
  message: string;
} {
  const match = ENCODED_PATTERN.exec(message);
  if (match && (FATAL_APP_AUTH_CODES as readonly string[]).includes(match[1])) {
    const code = match[1] as AppAuthErrorCode;
    return { code, message: APP_AUTH_ERROR_MESSAGES[code] };
  }
  return { code: null, message };
}
