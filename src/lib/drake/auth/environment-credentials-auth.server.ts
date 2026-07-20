import "@tanstack/react-start/server-only";
import { chromium, request, type APIRequestContext, type Browser } from "playwright";
import { assertDrakeCredentialsConfigured, env } from "../config.server";
import { logger } from "../logger";
import { sanitizeError } from "../sanitize-error.server";
import { validateDrakeApiSession } from "../api-session.server";
import {
  credentialsNotConfiguredError,
  DrakeAuthError,
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  interactiveAuthRequiredError,
} from "./errors";
import { extractStorageStateFromPage, performHeadlessDrakeLogin } from "./headless-login.server";
import { clearSessionCache, readSessionCache, writeSessionCache } from "./session-cache.server";
import type { DrakeAuthProvider, DrakeAuthResult, StorageState } from "./types";

export type AuthProgressStage =
  | "validating-session"
  | "connecting-drake"
  | "authenticating"
  | "confirming-tenant"
  | "session-confirmed";

export type AuthProgressCallback = (stage: AuthProgressStage) => void | Promise<void>;

async function createApiContextFromState(storageState: StorageState): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: env.DRAKE_BASE_URL,
    storageState: storageState as unknown as string,
    ignoreHTTPSErrors: env.DRAKE_IGNORE_HTTPS_ERRORS,
    timeout: env.DRAKE_TIMEOUT_MS,
    userAgent: env.DRAKE_USER_AGENT,
    extraHTTPHeaders: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "pt-BR",
    },
  });
}

async function tryValidateCachedSession(storageState: StorageState): Promise<boolean> {
  let api: APIRequestContext | null = null;
  try {
    api = await createApiContextFromState(storageState);
    await validateDrakeApiSession(api, { logSuccess: false });
    return true;
  } catch {
    return false;
  } finally {
    await api?.dispose().catch(() => undefined);
  }
}

/**
 * Autenticação via DRAKE_USERNAME / DRAKE_PASSWORD.
 * Cache de sessão é opcional e nunca substitui as credenciais.
 * Chromium headless somente aqui — relatórios usam APIRequestContext.
 */
export class EnvironmentCredentialsDrakeAuthProvider implements DrakeAuthProvider {
  constructor(private readonly onProgress?: AuthProgressCallback) {}

  async authenticate(): Promise<DrakeAuthResult> {
    try {
      assertDrakeCredentialsConfigured();
    } catch {
      throw credentialsNotConfiguredError();
    }

    await this.onProgress?.("validating-session");

    const cached = await readSessionCache();
    if (cached) {
      const valid = await tryValidateCachedSession(cached);
      if (valid) {
        await this.onProgress?.("session-confirmed");
        return { storageState: cached, reusedCache: true };
      }
      await clearSessionCache();
    }

    await this.onProgress?.("connecting-drake");
    await this.onProgress?.("authenticating");

    const storageState = await this.loginHeadless();

    await this.onProgress?.("confirming-tenant");
    const api = await createApiContextFromState(storageState);
    try {
      await validateDrakeApiSession(api, { logSuccess: false });
    } finally {
      await api.dispose();
    }

    await writeSessionCache(storageState);
    await this.onProgress?.("session-confirmed");
    return { storageState, reusedCache: false };
  }

  private async loginHeadless(): Promise<StorageState> {
    // headless SEMPRE true — nunca janela visível ao usuário
    if (env.DRAKE_AUTH_HEADLESS === false) {
      logger.warn("DRAKE_AUTH_HEADLESS=false ignorado; login permanece headless");
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--disable-dev-shm-usage"],
      });
      const context = await browser.newContext({
        ignoreHTTPSErrors: env.DRAKE_IGNORE_HTTPS_ERRORS,
        userAgent: env.DRAKE_USER_AGENT,
        locale: "pt-BR",
      });
      const page = await context.newPage();

      try {
        await performHeadlessDrakeLogin(page);
        return await extractStorageStateFromPage(page);
      } finally {
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
      }
    } catch (error: unknown) {
      if (error instanceof DrakeAuthError) throw error;
      const safe = sanitizeError(error);
      if (/mfa|captcha|interactive|authenticator|aprov/i.test(safe.message)) {
        throw interactiveAuthRequiredError();
      }
      throw new DrakeAuthError("DRAKE_AUTH_FAILED", safe.message);
    } finally {
      // Chromium não permanece aberto durante os relatórios
      await browser?.close().catch(() => undefined);
    }
  }
}

export async function createApiRequestContext(
  storageState: StorageState,
): Promise<APIRequestContext> {
  return createApiContextFromState(storageState);
}

export { DRAKE_CREDENTIALS_NOT_CONFIGURED };
