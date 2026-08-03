import "@tanstack/react-start/server-only";
import { assertDrakeCredentialsConfigured } from "../config.server";
import {
  buildAuthenticatedSessionFromStorageState,
  type DrakeAuthenticatedSession,
} from "./authenticated-session.server";
import {
  createDrakeHttpClientFromAuthenticatedSession,
  createDrakeHttpClientFromStorageState,
} from "../http/create-drake-http-client.server";
import type { DrakeHttpClient } from "../http/drake-http-client.types.server";
import { logger } from "../logger";
import { sanitizeError } from "../sanitize-error.server";
import { DrakeSessionExpiredError, validateDrakeApiSession } from "../api-session.server";
import {
  credentialsNotConfiguredError,
  DrakeAuthError,
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  DRAKE_INTERACTIVE_AUTH_REQUIRED,
  interactiveAuthRequiredError,
  sessionTransferFailedError,
} from "./errors";
import { loginWithDrakeHttpCredentials } from "./http-credentials-login.server";
import { clearSessionCache, readSessionCache, writeSessionCache } from "./session-cache.server";
import type { DrakeAuthProvider, DrakeAuthResult, StorageState } from "./types";

export type AuthProgressStage =
  | "validating-session"
  | "connecting-drake"
  | "authenticating"
  | "confirming-tenant"
  | "session-confirmed";

export type AuthProgressCallback = (stage: AuthProgressStage) => void | Promise<void>;

async function createApiContextFromSession(
  session: DrakeAuthenticatedSession,
): Promise<DrakeHttpClient> {
  return createDrakeHttpClientFromAuthenticatedSession(session);
}

/**
 * Valida sessão existente via GET /api/v2/Authorization/Menu (HTTP).
 * Não cria BrowserRuntime.
 */
export async function tryValidateExistingSession(
  storageState: StorageState,
): Promise<DrakeAuthenticatedSession | null> {
  const session = buildAuthenticatedSessionFromStorageState(storageState);
  let api: DrakeHttpClient | null = null;
  try {
    api = await createApiContextFromSession(session);
    await validateDrakeApiSession(api, { logSuccess: false });
    return session;
  } catch {
    return null;
  } finally {
    await api?.dispose().catch(() => undefined);
  }
}

async function validateHttpSessionTransfer(session: DrakeAuthenticatedSession): Promise<void> {
  const api = await createApiContextFromSession(session);
  try {
    await validateDrakeApiSession(api, { logSuccess: false });
  } catch (error: unknown) {
    if (error instanceof DrakeSessionExpiredError) {
      logger.warn("drake-auth-diagnostics", "Transferencia de sessao falhou", {
        stage: "confirming-tenant",
        httpMenuStatus: 401,
        cookieNameCount: session.cookieJar.cookieNames().length,
        hasAuthHeader: Boolean(session.authorizationHeader),
        requiredHeaderNames: Object.keys(session.requiredHeaders),
      });
      throw sessionTransferFailedError();
    }
    throw error;
  } finally {
    await api.dispose();
  }
}

/**
 * Autenticação via DRAKE_USERNAME / DRAKE_PASSWORD.
 * Reutiliza sessao valida e, quando necessario, autentica por HTTP no Microsoft B2C.
 * Nenhuma etapa cria ou controla navegador.
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
      const validSession = await tryValidateExistingSession(cached);
      if (validSession) {
        logger.info(
          "drake-authentication",
          "Sessao HTTP existente valida",
        );
        await this.onProgress?.("session-confirmed");
        return {
          storageState: cached,
          authenticatedSession: validSession,
          reusedCache: true,
        };
      }
      await clearSessionCache();
    }

    logger.info(
      "drake-authentication",
      "Sessão ausente ou expirada; iniciando autenticação automática",
    );

    await this.onProgress?.("connecting-drake");
    await this.onProgress?.("authenticating");

    const authenticatedSession = await this.loginHttp();

    await this.onProgress?.("confirming-tenant");
    await validateHttpSessionTransfer(authenticatedSession);

    // Persiste apenas cookies/storageState — nunca Authorization/tokens em logs.
    await writeSessionCache(authenticatedSession.storageState);
    logger.info("drake-authentication", "Autenticação automática concluída");
    await this.onProgress?.("session-confirmed");
    return {
      storageState: authenticatedSession.storageState,
      authenticatedSession,
      reusedCache: false,
    };
  }

  private async loginHttp(): Promise<DrakeAuthenticatedSession> {
    try {
      const authenticated = await loginWithDrakeHttpCredentials();
      logger.info("drake-authentication", "Sessao autenticada diretamente por HTTP", {
        stage: "authenticating",
        cookieNameCount: authenticated.cookieJar.cookieNames().length,
      });
      return authenticated;
    } catch (error: unknown) {
      if (error instanceof DrakeAuthError) {
        if (error.code === DRAKE_INTERACTIVE_AUTH_REQUIRED) {
          logger.info(
            "drake-authentication",
            "Confirmação interativa detectada durante o login",
          );
        }
        throw error;
      }
      const safe = sanitizeError(error);
      if (/mfa|captcha|interactive|authenticator|aprov/i.test(safe.message)) {
        logger.info(
          "drake-authentication",
          "Confirmação interativa detectada durante o login",
        );
        throw interactiveAuthRequiredError();
      }
      throw new DrakeAuthError("DRAKE_AUTH_FAILED", safe.message);
    }
  }
}

export async function createApiRequestContext(
  storageState: StorageState,
): Promise<DrakeHttpClient> {
  return createDrakeHttpClientFromStorageState(storageState);
}

export async function createApiRequestContextFromSession(
  session: DrakeAuthenticatedSession,
): Promise<DrakeHttpClient> {
  return createDrakeHttpClientFromAuthenticatedSession(session);
}

export {
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  DRAKE_INTERACTIVE_AUTH_REQUIRED,
};
