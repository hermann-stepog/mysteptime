import "@tanstack/react-start/server-only";
import type { Page } from "playwright";
import { env } from "../config.server";
import { isDrakeBrowserRemoteMode } from "../browser/create-drake-browser-runtime.server";
import { logger } from "../logger";
import {
  fillAndSubmitCredentials,
  handleNormalMicrosoftSteps,
  isAuthenticatedRoute,
  isLoginUrl,
} from "./headless-login-helpers.server";
import {
  classifyLoginStep,
  detectInteractiveChallenge,
  logInteractiveChallengeDetection,
} from "./interactive-challenge.server";
import { isContextSelectionScreen, selectDrakeContext } from "./context-selection.server";
import { findPasswordField } from "./locate.server";
import { interactiveAuthRequiredError, DrakeAuthError, DRAKE_AUTH_FAILED } from "./errors";
import type { StorageState } from "./types";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function allowNonHeadlessLocalAuth(): boolean {
  return env.DRAKE_AUTH_DEBUG === true && !isDrakeBrowserRemoteMode();
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

async function throwIfStrongInteractiveChallenge(page: Page): Promise<void> {
  const detection = await detectInteractiveChallenge(page);
  if (!detection.detected) return;
  logInteractiveChallengeDetection(detection);
  throw interactiveAuthRequiredError();
}

/**
 * Após credenciais: trata etapas normais, aguarda redirects e só então
 * classifica desafio interativo com evidência forte.
 */
async function waitAfterCredentials(page: Page): Promise<void> {
  const deadline = Date.now() + env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS;
  let unknownStreakMs = 0;
  let lastUrl = page.url();
  const unknownGraceMs = 8_000;

  while (Date.now() < deadline) {
    if (await isContextSelectionScreen(page)) return;
    if (await handleNormalMicrosoftSteps(page)) {
      unknownStreakMs = 0;
      await sleep(600);
      continue;
    }

    await throwIfStrongInteractiveChallenge(page);

    if (
      isAuthenticatedRoute(page.url()) &&
      !(await findPasswordField(page)) &&
      !(await isContextSelectionScreen(page))
    ) {
      return;
    }

    const step = await classifyLoginStep(page);
    if (step === "client-selection") {
      unknownStreakMs = 0;
      const { selectDrakeContext } = await import("./context-selection.server");
      await selectDrakeContext(page);
      return;
    }
    if (
      step === "email" ||
      step === "password" ||
      step === "account-picker" ||
      step === "stay-signed-in" ||
      step === "login-callback"
    ) {
      unknownStreakMs = 0;
      if (step === "email" || step === "password") {
        const resumed = await fillAndSubmitCredentials(page);
        if (!resumed) {
          await throwIfStrongInteractiveChallenge(page);
        }
      }
      await sleep(500);
      continue;
    }

    const url = page.url();
    if (url !== lastUrl) {
      lastUrl = url;
      unknownStreakMs = 0;
    } else {
      unknownStreakMs += 500;
    }

    // Página desconhecida: aguarda evolução do redirect antes de declarar MFA.
    if (step === "unknown" && unknownStreakMs >= unknownGraceMs) {
      const detection = await detectInteractiveChallenge(page);
      if (detection.detected) {
        logInteractiveChallengeDetection(detection);
        throw interactiveAuthRequiredError();
      }
    }

    await sleep(500);
  }
}

/**
 * Login headless (ou headed local com DRAKE_AUTH_DEBUG).
 * Fecha o browser no chamador após extrair storageState.
 */
export async function performHeadlessDrakeLogin(page: Page): Promise<void> {
  const debugLocal = allowNonHeadlessLocalAuth();
  if (env.DRAKE_AUTH_HEADLESS !== true && env.DRAKE_HEADLESS !== true && !debugLocal) {
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

  await handleNormalMicrosoftSteps(page);
  await throwIfStrongInteractiveChallenge(page);

  const credentialsOk = await fillAndSubmitCredentials(page);
  if (!credentialsOk) {
    await handleNormalMicrosoftSteps(page);
    await throwIfStrongInteractiveChallenge(page);
    throw new DrakeAuthError(DRAKE_AUTH_FAILED, "Não foi possível autenticar no Drake.");
  }

  await waitAfterCredentials(page);

  await selectDrakeContext(page);
  await confirmStableAuthenticatedSession(page);
  logger.info("Login UI do Drake estabilizado; aguardando validacao do Menu no navegador");
}

export async function extractStorageStateFromPage(page: Page): Promise<StorageState> {
  const state = await page.context().storageState();
  return state as StorageState;
}
