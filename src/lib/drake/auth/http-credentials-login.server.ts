import "@tanstack/react-start/server-only";
import { validateDrakeApiSession } from "../api-session.server";
import { env } from "../config.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../http/create-drake-http-client.server";
import { DrakeCookieJar } from "../http/drake-cookie-jar.server";
import type {
  DrakeHttpClient,
  DrakeHttpResponse,
} from "../http/drake-http-client.types.server";
import { normalizeText } from "../text";
import {
  buildAuthenticatedSessionFromStorageState,
  type DrakeAuthenticatedSession,
} from "./authenticated-session.server";
import {
  clientNotFoundError,
  clientSelectionAmbiguousError,
  clientSelectionFailedError,
  DRAKE_AUTH_FAILED,
  DrakeAuthError,
  interactiveAuthRequiredError,
} from "./errors";

type DrakeAuthProviderConfig = {
  id: string;
  clientId: string;
  identityServerType: string;
  azureADB2CName: string;
  azureADB2CUserFlow: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function randomRequestValue(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseProviderConfig(value: unknown): DrakeAuthProviderConfig {
  if (!isRecord(value) || !Array.isArray(value["availableProviders"])) {
    throw new DrakeAuthError(
      DRAKE_AUTH_FAILED,
      "O Drake retornou uma configuracao de login invalida.",
    );
  }

  const providers = value["availableProviders"]
    .filter(isRecord)
    .map((provider) => ({
      id: stringValue(provider["id"]),
      clientId: stringValue(provider["clientId"]),
      identityServerType: stringValue(provider["identityServerType"]),
      azureADB2CName: stringValue(provider["azureADB2CName"]),
      azureADB2CUserFlow: stringValue(provider["azureADB2CUserFlow"]),
    }))
    .filter(
      (provider) =>
        provider.id &&
        provider.clientId &&
        provider.identityServerType.toLowerCase() === "azureadb2c" &&
        provider.azureADB2CName &&
        provider.azureADB2CUserFlow,
    );

  if (providers.length !== 1) {
    throw new DrakeAuthError(
      DRAKE_AUTH_FAILED,
      "Nao foi possivel determinar o provedor de autenticacao do Drake.",
    );
  }
  return providers[0]!;
}

function extractJsonStringProperty(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`"${escaped}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  if (!match?.[1]) return "";
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return "";
  }
}

function responseLocation(response: DrakeHttpResponse): string {
  return response.headers()["location"] ?? "";
}

async function getAuthProvider(api: DrakeHttpClient): Promise<DrakeAuthProviderConfig> {
  const response = await api.get("/api/v2/User/AuthConfigsByEmail", {
    params: { email: env.DRAKE_USERNAME },
    maxRedirects: 0,
    timeout: env.DRAKE_TIMEOUT_MS,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (response.status() !== 200) {
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "O Drake recusou a configuracao de login.");
  }
  return parseProviderConfig(await response.json());
}

function createAuthorizeUrl(provider: DrakeAuthProviderConfig): URL {
  const tenant = provider.azureADB2CName;
  const policy = provider.azureADB2CUserFlow;
  const authorize = new URL(
    `https://${tenant}.b2clogin.com/${tenant}.onmicrosoft.com/${policy}/oauth2/v2.0/authorize`,
  );
  const state = JSON.stringify({
    authProviderId: provider.id,
    authProviderName: tenant,
  });

  authorize.searchParams.set("client_id", provider.clientId);
  authorize.searchParams.set("redirect_uri", new URL("/logon", env.DRAKE_BASE_URL).toString());
  authorize.searchParams.set("response_type", "id_token");
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("response_mode", "fragment");
  authorize.searchParams.set("nonce", randomRequestValue());
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "login");
  authorize.searchParams.set("login_hint", env.DRAKE_USERNAME);
  return authorize;
}

async function exchangeCredentialsForIdToken(
  api: DrakeHttpClient,
  provider: DrakeAuthProviderConfig,
): Promise<string> {
  const authorizeUrl = createAuthorizeUrl(provider);
  const bootstrap = await api.get(authorizeUrl.toString(), {
    maxRedirects: 0,
    timeout: env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (bootstrap.status() !== 200) {
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "O Microsoft B2C nao iniciou o login do Drake.");
  }

  const html = await bootstrap.text();
  const csrf = extractJsonStringProperty(html, "csrf");
  const transactionId = extractJsonStringProperty(html, "transId");
  if (!csrf || !transactionId) {
    if (/captcha|authenticator|verification code|multifactor|mfa/i.test(html)) {
      throw interactiveAuthRequiredError();
    }
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "O Microsoft B2C retornou um login desconhecido.");
  }

  const tenant = provider.azureADB2CName;
  const policy = provider.azureADB2CUserFlow;
  const policyBase = `https://${tenant}.b2clogin.com/${tenant}.onmicrosoft.com/${policy}`;
  const credentialUrl = new URL(`${policyBase}/SelfAsserted`);
  credentialUrl.searchParams.set("tx", transactionId);
  credentialUrl.searchParams.set("p", policy);

  const credentialBody = new URLSearchParams({
    request_type: "RESPONSE",
    email: env.DRAKE_USERNAME,
    password: env.DRAKE_PASSWORD,
  }).toString();
  const credentialResponse = await api.post(credentialUrl.toString(), {
    data: credentialBody,
    maxRedirects: 0,
    timeout: env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-TOKEN": csrf,
      "X-Requested-With": "XMLHttpRequest",
      Origin: `https://${tenant}.b2clogin.com`,
      Referer: authorizeUrl.toString(),
    },
  });

  let credentialResult: unknown = null;
  try {
    credentialResult = await credentialResponse.json();
  } catch {
    // A resposta inesperada e classificada abaixo sem registrar o corpo.
  }
  const credentialStatus = isRecord(credentialResult)
    ? Number(credentialResult["status"])
    : Number.NaN;
  if (credentialResponse.status() !== 200 || credentialStatus !== 200) {
    const message = isRecord(credentialResult) ? stringValue(credentialResult["message"]) : "";
    if (/captcha|authenticator|verification|multifactor|mfa|codigo|código/i.test(message)) {
      throw interactiveAuthRequiredError();
    }
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Usuario ou senha do Drake foram recusados.");
  }

  const confirmUrl = new URL(`${policyBase}/api/CombinedSigninAndSignup/confirmed`);
  confirmUrl.searchParams.set("rememberMe", "false");
  confirmUrl.searchParams.set("csrf_token", csrf);
  confirmUrl.searchParams.set("tx", transactionId);
  confirmUrl.searchParams.set("p", policy);
  const confirmed = await api.get(confirmUrl.toString(), {
    maxRedirects: 0,
    timeout: env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Referer: authorizeUrl.toString(),
    },
  });

  let redirect: URL;
  try {
    redirect = new URL(responseLocation(confirmed), confirmUrl);
  } catch {
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "O Microsoft B2C nao concluiu o login do Drake.");
  }
  if (redirect.hostname !== new URL(env.DRAKE_BASE_URL).hostname) {
    throw new DrakeAuthError(
      DRAKE_AUTH_FAILED,
      "O Microsoft B2C retornou um destino de login invalido.",
    );
  }

  const fragment = new URLSearchParams(redirect.hash.replace(/^#/, ""));
  const idToken = fragment.get("id_token") ?? redirect.searchParams.get("id_token") ?? "";
  if (!idToken) {
    const error = fragment.get("error") ?? redirect.searchParams.get("error") ?? "";
    if (/interaction|required|mfa|verification/i.test(error)) {
      throw interactiveAuthRequiredError();
    }
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "O Microsoft B2C nao emitiu o token do Drake.");
  }
  return idToken;
}

async function createDrakeSessionCookie(
  api: DrakeHttpClient,
  provider: DrakeAuthProviderConfig,
  idToken: string,
): Promise<void> {
  const callback = new URL("/LoginCallback.ashx", env.DRAKE_BASE_URL);
  callback.searchParams.set("id_token", idToken);
  callback.searchParams.set("auth_provider_id", provider.id);
  const response = await api.get(callback.toString(), {
    maxRedirects: 5,
    timeout: env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (response.status() !== 200) {
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "O Drake nao aceitou o token de autenticacao.");
  }
}

function tenantItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["items", "data", "tenants"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function tenantLabels(tenant: Record<string, unknown>): string[] {
  const labels = [tenant["text"], tenant["name"], tenant["description"], tenant["code"]]
    .map(stringValue)
    .filter(Boolean);
  const properties = tenant["properties"];
  if (isRecord(properties)) {
    labels.push(
      ...[properties["text"], properties["name"], properties["description"], properties["code"]]
        .map(stringValue)
        .filter(Boolean),
    );
  }
  return labels;
}

function tenantId(tenant: Record<string, unknown>): string {
  return stringValue(tenant["id"] ?? tenant["tenantId"] ?? tenant["value"]);
}

async function selectConfiguredTenant(api: DrakeHttpClient): Promise<void> {
  const response = await api.get("/api/v2/User/Tenants", {
    params: { page: 1, limit: 100 },
    maxRedirects: 0,
    timeout: env.DRAKE_TIMEOUT_MS,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (response.status() !== 200) throw clientSelectionFailedError();

  const expected = normalizeText(env.DRAKE_CONTEXT_NAME);
  const matches = tenantItems(await response.json()).filter((tenant) =>
    tenantLabels(tenant).some((label) => normalizeText(label) === expected),
  );
  if (matches.length === 0) throw clientNotFoundError();
  if (matches.length > 1) throw clientSelectionAmbiguousError();

  const id = tenantId(matches[0]!);
  if (!id) throw clientSelectionFailedError();
  const selected = await api.post("/api/v2/User/SelectTenant", {
    params: { tenantId: id },
    data: "",
    maxRedirects: 0,
    timeout: env.DRAKE_TIMEOUT_MS,
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (selected.status() !== 200) throw clientSelectionFailedError();
}

/**
 * Login completo Drake por HTTP: Microsoft B2C, callback, tenant e Menu.
 * Nao cria navegador nem depende de automacao visual ou processo externo.
 */
export async function loginWithDrakeHttpCredentials(): Promise<DrakeAuthenticatedSession> {
  const cookieJar = new DrakeCookieJar();
  const bootstrapSession: DrakeAuthenticatedSession = {
    storageState: { cookies: [], origins: [] },
    cookieJar,
    requiredHeaders: {},
  };
  const api = createDrakeHttpClientFromAuthenticatedSession(bootstrapSession);
  try {
    const provider = await getAuthProvider(api);
    const idToken = await exchangeCredentialsForIdToken(api, provider);
    await createDrakeSessionCookie(api, provider, idToken);
    await selectConfiguredTenant(api);
    await validateDrakeApiSession(api, { logSuccess: false });
    return buildAuthenticatedSessionFromStorageState(cookieJar.toStorageState());
  } finally {
    await api.dispose().catch(() => undefined);
  }
}
