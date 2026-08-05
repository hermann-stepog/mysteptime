import "@tanstack/react-start/server-only";
import { env } from "./config.server";
import {
  createDrakeHttpClientFromAuthenticatedSession,
  createDrakeHttpClientFromStorageState,
} from "./http/create-drake-http-client.server";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import { formatTlsCertificateErrorMessage, isTlsCertificateError } from "./sanitize-error.server";
import { normalizeText } from "./text";
import type { DrakeAuthenticatedSession } from "./auth/authenticated-session.server";
import type { StorageState } from "./auth/types";

const AUTHORIZATION_MENU_URL = "/api/v2/Authorization/Menu";

export class DrakeSessionMissingError extends Error {
  constructor() {
    super("Sessão do Drake não encontrada.");
  }
}

export class DrakeSessionExpiredError extends Error {
  readonly code = "DRAKE_SESSION_EXPIRED";
  constructor() {
    super("Sessão do Drake expirada ou inválida.");
  }
}

export function isSessionExpiredError(error: unknown): boolean {
  if (error instanceof DrakeSessionExpiredError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      /sess[aã]o.*(expir|inv[aá]lid|logon)/i.test(error.message) ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("/logon")
    );
  }
  return false;
}

export async function createDrakeApiContextFromStorageState(
  storageState: StorageState,
): Promise<DrakeHttpClient> {
  return createDrakeHttpClientFromStorageState(storageState);
}

export async function createDrakeApiContextFromAuthenticatedSession(
  session: DrakeAuthenticatedSession,
): Promise<DrakeHttpClient> {
  return createDrakeHttpClientFromAuthenticatedSession(session);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findTenant(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const tenant = value["tenant"];
  if (isRecord(tenant)) return tenant;
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = findTenant(child);
        if (found) return found;
      }
      continue;
    }
    const found = findTenant(item);
    if (found) return found;
  }
  return null;
}

function looksLikeLoginHtml(contentType: string, text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /text\/html/i.test(contentType) ||
    normalized.includes("<html") ||
    normalized.includes("/logon") ||
    normalized.includes("login")
  );
}

function rethrowHttpValidationError(error: unknown): never {
  if (isTlsCertificateError(error)) {
    throw new Error(formatTlsCertificateErrorMessage());
  }
  throw error;
}

export async function validateDrakeApiSession(
  apiContext: DrakeHttpClient,
  options: { logSuccess?: boolean } = {},
): Promise<void> {
  let response;
  try {
    response = await apiContext.get(AUTHORIZATION_MENU_URL, {
      failOnStatusCode: false,
      maxRedirects: 0,
      timeout: env.DRAKE_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    rethrowHttpValidationError(error);
  }

  const status = response.status();
  const headers = response.headers();
  const contentType = headers["content-type"] ?? "";
  const location = headers["location"] ?? "";

  if (
    status === 401 ||
    status === 403 ||
    (status >= 300 && status < 400 && /\/logon/i.test(location))
  ) {
    throw new DrakeSessionExpiredError();
  }

  if (status !== 200 || !/json/i.test(contentType)) {
    const text = await response.text().catch(() => "");
    if (looksLikeLoginHtml(contentType, text)) {
      throw new DrakeSessionExpiredError();
    }
    throw new DrakeSessionExpiredError();
  }

  const json = (await response.json()) as unknown;
  const tenant = findTenant(json);
  const tenantName = tenant && typeof tenant["name"] === "string" ? tenant["name"] : null;
  if (!tenantName) {
    throw new DrakeSessionExpiredError();
  }

  if (normalizeText(tenantName) !== normalizeText(env.DRAKE_CONTEXT_NAME)) {
    throw new Error(`Tenant ativo inválido: esperado ${env.DRAKE_CONTEXT_NAME}.`);
  }

  if (options.logSuccess !== false) {
    console.log("Sessao HTTP do Drake validada");
    console.log("Tenant Step confirmado");
  }
}

/** @deprecated Use EnvironmentCredentialsDrakeAuthProvider */
export async function createDrakeApiSession(): Promise<DrakeHttpClient> {
  const { EnvironmentCredentialsDrakeAuthProvider, createApiRequestContextFromSession } =
    await import("./auth/environment-credentials-auth.server");
  const result = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
  return createApiRequestContextFromSession(result.authenticatedSession);
}
