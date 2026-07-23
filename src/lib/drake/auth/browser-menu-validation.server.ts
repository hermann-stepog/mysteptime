import "@tanstack/react-start/server-only";
import type { Page, Request } from "playwright";
import { env } from "../config.server";
import { logger } from "../logger";
import {
  buildAuthenticatedSessionFromStorageState,
  extractProvenRequestHeaders,
  sanitizeCookieMeta,
  type DrakeAuthenticatedSession,
  type SanitizedSessionStructure,
} from "./authenticated-session.server";
import { detectCaptchaOrMfa, isAuthenticatedRoute, isLoginUrl } from "./headless-login-helpers.server";
import { isContextSelectionScreen } from "./context-selection.server";
import { findPasswordField } from "./locate.server";
import { extractStorageStateFromPage } from "./headless-login.server";
import {
  DrakeAuthError,
  DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED,
  interactiveAuthRequiredError,
} from "./errors";
import type { CookieRecord } from "../http/drake-cookie-jar.server";

const MENU_PATH = "/api/v2/Authorization/Menu";

export type BrowserMenuProbeResult = {
  status: number;
  ok: boolean;
  contentType: string | null;
  headerNames: string[];
  authorizationHeaderPresent: boolean;
  authorizationHeader?: string;
  requiredHeaders: Record<string, string>;
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isCallbackOrIdentityUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("login.microsoftonline.com") ||
    lower.includes("login.microsoft.com") ||
    lower.includes("logincallback") ||
    lower.includes("loginCallback".toLowerCase())
  );
}

/**
 * Aguarda redirects Microsoft/LoginCallback e estabilização da UI,
 * sem usar networkidle e sem considerar sucesso só por URL.
 */
export async function waitForPostLoginNavigation(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await detectCaptchaOrMfa(page)) {
      throw interactiveAuthRequiredError();
    }
    const url = page.url();
    if (isCallbackOrIdentityUrl(url) || isLoginUrl(url)) {
      await sleep(500);
      continue;
    }
    if (await isContextSelectionScreen(page)) return;
    if (isAuthenticatedRoute(url) && !(await findPasswordField(page))) return;
    await sleep(500);
  }
}

/**
 * Probe do Menu dentro do BrowserContext (mesma origem, credentials include).
 * Não retorna body; captura apenas estrutura sanitizada + headers comprovados em memória.
 */
export async function probeBrowserAuthorizationMenu(page: Page): Promise<BrowserMenuProbeResult> {
  let capturedHeaders: Record<string, string> = {};

  const onRequest = (request: Request) => {
    try {
      const url = request.url();
      if (!url.includes(MENU_PATH)) return;
      capturedHeaders = { ...request.headers() };
    } catch {
      /* ignore */
    }
  };

  page.on("request", onRequest);
  try {
    const result = await page.evaluate(async (menuPath) => {
      const response = await fetch(menuPath, {
        method: "GET",
        credentials: "include",
      });
      return {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
      };
    }, MENU_PATH);

    const proven = extractProvenRequestHeaders(capturedHeaders);
    return {
      status: result.status,
      ok: result.ok,
      contentType: result.contentType,
      headerNames: proven.headerNames,
      authorizationHeaderPresent: proven.authorizationHeaderPresent,
      authorizationHeader: proven.authorizationHeader,
      requiredHeaders: proven.requiredHeaders,
    };
  } finally {
    page.off("request", onRequest);
  }
}

async function collectSanitizedStructure(
  page: Page,
  menuStatus: number,
  probe: BrowserMenuProbeResult,
): Promise<SanitizedSessionStructure> {
  const cookies = await page.context().cookies().catch(() => []);
  const storageKeys = await page
    .evaluate(() => ({
      localStorageKeyNames: Object.keys(localStorage),
      sessionStorageKeyNames: Object.keys(sessionStorage),
    }))
    .catch(() => ({ localStorageKeyNames: [] as string[], sessionStorageKeyNames: [] as string[] }));

  return {
    menuInsideBrowserStatus: menuStatus,
    cookieNames: cookies.map((c) => c.name).sort(),
    headerNames: probe.headerNames,
    localStorageKeyNames: storageKeys.localStorageKeyNames.sort(),
    sessionStorageKeyNames: storageKeys.sessionStorageKeyNames.sort(),
    authorizationHeaderPresent: probe.authorizationHeaderPresent,
    cookieMeta: sanitizeCookieMeta(
      cookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: String(c.sameSite ?? ""),
      })),
    ),
  };
}

function logSanitizedStructure(structure: SanitizedSessionStructure): void {
  // console.info direto: payload já é só nomes (sem valores). Evita redact de chaves com "cookie"/"authorization".
  console.info("[drake-auth-diagnostics] Estrutura da sessão autenticada", {
    menuInsideBrowserStatus: structure.menuInsideBrowserStatus,
    cookieNames: structure.cookieNames,
    headerNames: structure.headerNames,
    localStorageKeyNames: structure.localStorageKeyNames,
    sessionStorageKeyNames: structure.sessionStorageKeyNames,
    authorizationHeaderPresent: structure.authorizationHeaderPresent,
  });
}

/**
 * Critério forte: login só está pronto quando Menu no BrowserContext retorna 200.
 * Poll com timeout controlado; interrompe em MFA.
 */
export async function waitForBrowserMenuAuthenticated(
  page: Page,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<{ probe: BrowserMenuProbeResult; structure: SanitizedSessionStructure }> {
  const timeoutMs = options?.timeoutMs ?? env.DRAKE_BROWSER_MENU_TIMEOUT_MS;
  const intervalMs = options?.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastProbe: BrowserMenuProbeResult | null = null;

  await waitForPostLoginNavigation(page, Math.min(timeoutMs, env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS));

  while (Date.now() < deadline) {
    if (await detectCaptchaOrMfa(page)) {
      throw interactiveAuthRequiredError();
    }
    if (isLoginUrl(page.url()) && (await findPasswordField(page))) {
      throw new DrakeAuthError(
        DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED,
        "O login no Drake não produziu uma sessão autenticada.",
      );
    }

    const probe = await probeBrowserAuthorizationMenu(page);
    lastProbe = probe;
    lastStatus = probe.status;

    if (probe.status === 200) {
      const structure = await collectSanitizedStructure(page, probe.status, probe);
      logSanitizedStructure(structure);
      return { probe, structure };
    }

    await sleep(intervalMs);
  }

  const probe =
    lastProbe ??
    ({
      status: lastStatus || 401,
      ok: false,
      contentType: null,
      headerNames: [],
      authorizationHeaderPresent: false,
      requiredHeaders: {},
    } satisfies BrowserMenuProbeResult);

  const structure = await collectSanitizedStructure(page, probe.status, probe);
  logger.warn("drake-auth-diagnostics", "Menu no navegador nao autenticou", {
    menuInsideBrowserStatus: structure.menuInsideBrowserStatus,
    cookieNames: structure.cookieNames,
    authorizationHeaderPresent: structure.authorizationHeaderPresent,
    durationMs: timeoutMs,
  });

  throw new DrakeAuthError(
    DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED,
    "O login no Drake não produziu uma sessão autenticada.",
  );
}

function toCookieRecords(
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>,
): CookieRecord[] {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
  }));
}

/**
 * Exporta sessão somente após Menu 200 no navegador.
 * Combina storageState + cookies do contexto + headers comprovados.
 */
export async function exportAuthenticatedSessionAfterBrowserMenu(
  page: Page,
  probe: BrowserMenuProbeResult,
): Promise<DrakeAuthenticatedSession> {
  const storageState = await extractStorageStateFromPage(page);
  const contextCookies = toCookieRecords(await page.context().cookies());
  return buildAuthenticatedSessionFromStorageState(storageState, {
    authorizationHeader: probe.authorizationHeader,
    requiredHeaders: probe.requiredHeaders,
    contextCookies,
  });
}

/** Login UI + URL não bastam — exige Menu 200. */
export function isLoginCompleteByUrlOnly(_url: string, _hasLoadBalancerCookies: boolean): boolean {
  return false;
}

export function classifySessionAuthFailure(input: {
  browserMenuStatus: number;
  httpMenuStatus: number;
}): typeof DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED | "DRAKE_SESSION_TRANSFER_FAILED" | null {
  if (input.browserMenuStatus !== 200) {
    return DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED;
  }
  if (input.httpMenuStatus !== 200) {
    return "DRAKE_SESSION_TRANSFER_FAILED";
  }
  return null;
}
