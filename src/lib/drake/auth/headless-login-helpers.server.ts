import "@tanstack/react-start/server-only";
import type { Page } from "playwright";
import { env } from "../config.server";
import { logger } from "../logger";
import { isContextSelectionScreen } from "./context-selection.server";
import {
  findPasswordField,
  findPreferredSubmitButton,
  findUsernameField,
  usableFrames,
} from "./locate.server";

const CAPTCHA_OR_MFA =
  /captcha|recaptcha|hcaptcha|verification code|c[oó]digo de verifica[cç][aã]o|autentica[cç][aã]o em duas etapas|two-factor|multi-factor|multifator|mfa|otp|\btoken\b|approve|approv|authenticator|number matching|condicional/i;

export function isLoginUrl(url: string): boolean {
  return url.toLowerCase().includes("/logon");
}

export function isAuthenticatedRoute(url: string): boolean {
  if (isLoginUrl(url)) return false;
  try {
    const current = new URL(url);
    return current.pathname.includes("/m/");
  } catch {
    return url.includes("/m/") && !isLoginUrl(url);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pageBodyText(page: Page): Promise<string> {
  const chunks: string[] = [];
  for (const frame of usableFrames(page)) {
    const text = await frame
      .locator("body")
      .innerText()
      .catch(() => "");
    chunks.push(text);
  }
  return chunks.join("\n");
}

export async function detectCaptchaOrMfa(page: Page): Promise<string | null> {
  const body = await pageBodyText(page);
  if (CAPTCHA_OR_MFA.test(body)) {
    return "interactive-challenge";
  }

  for (const frame of usableFrames(page)) {
    const captcha = frame.locator(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i], [class*="captcha" i], [id*="captcha" i]',
    );
    if ((await captcha.count().catch(() => 0)) > 0) {
      return "interactive-challenge";
    }
  }
  return null;
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
      const clicked = await clickSubmit(page);
      return clicked;
    }

    if (usernameFilled && !password) {
      await clickSubmit(page);
    }

    await sleep(500);
  }

  return usernameFilled && passwordFilled;
}
