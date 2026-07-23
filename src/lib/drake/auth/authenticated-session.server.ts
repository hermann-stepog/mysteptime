import "@tanstack/react-start/server-only";
import { DrakeCookieJar, type CookieRecord } from "../http/drake-cookie-jar.server";
import type { StorageState } from "./types";

/**
 * Sessão autenticada transferível ao cliente HTTP (somente em memória).
 * Nunca logar valores de cookies/headers.
 */
export type DrakeAuthenticatedSession = {
  storageState: StorageState;
  cookieJar: DrakeCookieJar;
  authorizationHeader?: string;
  requiredHeaders: Record<string, string>;
};

export type SanitizedSessionStructure = {
  menuInsideBrowserStatus: number;
  cookieNames: string[];
  headerNames: string[];
  localStorageKeyNames: string[];
  sessionStorageKeyNames: string[];
  authorizationHeaderPresent: boolean;
  cookieMeta: Array<{
    name: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
  }>;
};

/** Headers padrão do browser que não devem ser copiados para o cliente HTTP. */
const BROWSER_DEFAULT_HEADER_NAMES = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "dnt",
  "host",
  "origin",
  "pragma",
  "referer",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  "upgrade-insecure-requests",
  "user-agent",
]);

export function isBrowserDefaultHeaderName(name: string): boolean {
  return BROWSER_DEFAULT_HEADER_NAMES.has(name.toLowerCase());
}

/**
 * Extrai headers comprovados da requisição autenticada do navegador.
 * Inclui Authorization e headers não-padrão; nunca inventa headers.
 */
export function extractProvenRequestHeaders(
  requestHeaders: Record<string, string>,
): {
  authorizationHeader?: string;
  requiredHeaders: Record<string, string>;
  headerNames: string[];
  authorizationHeaderPresent: boolean;
} {
  const headerNames = Object.keys(requestHeaders)
    .map((k) => k.toLowerCase())
    .sort();
  const requiredHeaders: Record<string, string> = {};
  let authorizationHeader: string | undefined;

  for (const [rawKey, value] of Object.entries(requestHeaders)) {
    if (!value) continue;
    const key = rawKey.toLowerCase();
    if (key === "authorization") {
      authorizationHeader = value;
      requiredHeaders.Authorization = value;
      continue;
    }
    if (isBrowserDefaultHeaderName(key) || key === "cookie") continue;
    // Mantém capitalização original apenas para Authorization; demais em forma recebida.
    requiredHeaders[rawKey] = value;
  }

  return {
    authorizationHeader,
    requiredHeaders,
    headerNames,
    authorizationHeaderPresent: Boolean(authorizationHeader),
  };
}

export function buildAuthenticatedSessionFromStorageState(
  storageState: StorageState,
  extras?: {
    authorizationHeader?: string;
    requiredHeaders?: Record<string, string>;
    contextCookies?: CookieRecord[];
  },
): DrakeAuthenticatedSession {
  const jar = DrakeCookieJar.fromStorageState(storageState);
  if (extras?.contextCookies?.length) {
    jar.upsertCookies(extras.contextCookies);
  }
  const requiredHeaders = { ...(extras?.requiredHeaders ?? {}) };
  if (extras?.authorizationHeader) {
    requiredHeaders.Authorization = extras.authorizationHeader;
  }
  return {
    storageState,
    cookieJar: jar,
    authorizationHeader: extras?.authorizationHeader,
    requiredHeaders,
  };
}

export function sanitizeCookieMeta(
  cookies: Array<{
    name: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
  }>,
): SanitizedSessionStructure["cookieMeta"] {
  return cookies.map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  }));
}
