import "@tanstack/react-start/server-only";
import type { Page } from "playwright";
import { env } from "../config.server";
import { logger } from "../logger";
import { isContextSelectionScreen } from "./context-selection.server";
import { handleNormalMicrosoftSteps } from "./interactive-challenge.server";
import {
  findPasswordField,
  findPreferredSubmitButton,
  findUsernameField,
} from "./locate.server";

export {
  detectCaptchaOrMfa,
  detectInteractiveChallenge,
  handleNormalMicrosoftSteps,
  classifyLoginStep,
} from "./interactive-challenge.server";

export function isLoginUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes("/logon") || lower.includes("/m/public/login");
}

export function isAuthenticatedRoute(url: string): boolean {
  if (isLoginUrl(url)) return false;
  try {
    const current = new URL(url);
    const path = current.pathname.toLowerCase();
    if (path.includes("/m/public/") || path.includes("/logon")) return false;
    return path.includes("/m/");
  } catch {
    const lower = url.toLowerCase();
    return lower.includes("/m/") && !isLoginUrl(lower) && !lower.includes("/m/public/");
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDomChange(page: Page, previousUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (page.url() !== previousUrl) return;
    if (await isContextSelectionScreen(page)) return;
    if (isAuthenticatedRoute(page.url()) && !(await isContextSelectionScreen(page))) return;
    await sleep(400);
  }
}

async function fillUsername(page: Page): Promise<boolean> {
  const field = await findUsernameField(page);
  if (field === "ambiguous" || !field) return false;
  await field.locator.fill(env.DRAKE_USERNAME);
  return true;
}

async function fillPassword(page: Page): Promise<boolean> {
  const field = await findPasswordField(page);
  if (!field) return false;
  await field.locator.fill(env.DRAKE_PASSWORD);
  return true;
}

async function clickSubmit(page: Page): Promise<boolean> {
  const button = await findPreferredSubmitButton(page);
  if (!button) return false;
  const visible = await button.locator.isVisible().catch(() => false);
  const enabled = await button.locator.isEnabled().catch(() => false);
  if (!visible || !enabled) return false;
  const previousUrl = page.url();
  await button.locator.click();
  await waitForDomChange(page, previousUrl, 8_000);
  return true;
}

export async function fillAndSubmitCredentials(page: Page): Promise<boolean> {
  let usernameFilled = false;
  let passwordFilled = false;
  const deadline = Date.now() + env.DRAKE_LOGIN_DISCOVERY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isContextSelectionScreen(page)) return true;
    if (await handleNormalMicrosoftSteps(page)) {
      await sleep(800);
      continue;
    }

    const username = await findUsernameField(page);
    const password = await findPasswordField(page);

    if (username === "ambiguous") {
      logger.warn("Candidatos ambiguos para campo de usuario");
      return false;
    }

    if (username && !usernameFilled) {
      usernameFilled = await fillUsername(page);
    }
    if (password && !passwordFilled) {
      passwordFilled = await fillPassword(page);
    }

    if (usernameFilled && passwordFilled) {
      return await clickSubmit(page);
    }

    if (usernameFilled && !password) {
      await clickSubmit(page);
    }

    await sleep(500);
  }

  return usernameFilled && passwordFilled;
}
