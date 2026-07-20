import "@tanstack/react-start/server-only";
import type { Page } from "playwright";
import { env } from "../config.server";
import { logger } from "../logger";
import {
  detectCaptchaOrMfa,
  fillAndSubmitCredentials,
  isAuthenticatedRoute,
  isLoginUrl,
} from "./headless-login-helpers.server";
import { isContextSelectionScreen, selectDrakeContext } from "./context-selection.server";
import { findPasswordField } from "./locate.server";
import { interactiveAuthRequiredError, DrakeAuthError, DRAKE_AUTH_FAILED } from "./errors";
import type { StorageState } from "./types";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmStableAuthenticatedSession(page: Page): Promise<void> {
  await page.goto(env.DRAKE_QUERY_URL, {
    waitUntil: "domcontentloaded",
    timeout: env.DRAKE_TIMEOUT_MS,
  });

  const watchMs = 8_000;
  const started = Date.now();
  while (Date.now() - started < watchMs) {
    const url = page.url();
    if (isLoginUrl(url)) {
      throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Sessão autenticada não permaneceu válida.");
    }
    if (await isContextSelectionScreen(page)) {
      throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Drake voltou para seleção de contexto.");
    }
    if (await findPasswordField(page)) {
      throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Drake redirecionou novamente para o login.");
    }
    await sleep(500);
  }

  const finalUrl = page.url();
  if (isLoginUrl(finalUrl) || !isAuthenticatedRoute(finalUrl)) {
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Sessão autenticada não permaneceu válida.");
  }
}

/**
 * Login headless exclusivo para autenticação.
 * Sempre headless:true. Sem page.pause, sem Inspector, sem janela visível.
 * Fecha o browser no chamador após extrair storageState.
 */
export async function performHeadlessDrakeLogin(page: Page): Promise<void> {
  if (env.DRAKE_AUTH_HEADLESS !== true && env.DRAKE_HEADLESS !== true) {
    throw new DrakeAuthError(
      DRAKE_AUTH_FAILED,
      "Login do Drake exige modo headless (DRAKE_AUTH_HEADLESS=true).",
    );
  }

  logger.info("Iniciando autenticacao headless do Drake");
  await page.goto(env.DRAKE_LOGIN_URL || env.DRAKE_QUERY_URL, {
    waitUntil: "domcontentloaded",
    timeout: env.DRAKE_TIMEOUT_MS,
  });
  await sleep(500);

  if (
    isAuthenticatedRoute(page.url()) &&
    !(await isContextSelectionScreen(page)) &&
    !(await findPasswordField(page))
  ) {
    try {
      await confirmStableAuthenticatedSession(page);
      return;
    } catch {
      /* segue para login */
    }
  }

  const challenge = await detectCaptchaOrMfa(page);
  if (challenge) {
    throw interactiveAuthRequiredError();
  }

  const credentialsOk = await fillAndSubmitCredentials(page);
  if (!credentialsOk) {
    const midChallenge = await detectCaptchaOrMfa(page);
    if (midChallenge) throw interactiveAuthRequiredError();
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Não foi possível autenticar no Drake.");
  }

  // MFA/CAPTCHA após submit
  const afterSubmit = await detectCaptchaOrMfa(page);
  if (afterSubmit) throw interactiveAuthRequiredError();

  if (!(await isContextSelectionScreen(page))) {
    const waitDeadline = Date.now() + env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS;
    while (Date.now() < waitDeadline) {
      if (await detectCaptchaOrMfa(page)) throw interactiveAuthRequiredError();
      if (await isContextSelectionScreen(page)) break;
      if (
        isAuthenticatedRoute(page.url()) &&
        !(await findPasswordField(page)) &&
        !(await isContextSelectionScreen(page))
      ) {
        break;
      }
      await sleep(500);
    }
  }

  await selectDrakeContext(page);
  await confirmStableAuthenticatedSession(page);
  logger.info("Autenticacao headless do Drake concluida");
}

export async function extractStorageStateFromPage(page: Page): Promise<StorageState> {
  const state = await page.context().storageState();
  return state as StorageState;
}
