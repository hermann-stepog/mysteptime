import "@tanstack/react-start/server-only";
import type { Frame, Page } from "playwright";
import { env } from "../config.server";
import { logger } from "../logger";
import { findPasswordField, findUsernameField, usableFrames } from "./locate.server";

export type DrakeInteractiveChallengeType =
  | "otp-code"
  | "authenticator-approval"
  | "number-matching"
  | "captcha"
  | "identity-verification"
  | "unknown-interactive";

export type DrakeInteractiveChallengeDetection = {
  detected: boolean;
  challengeType?: DrakeInteractiveChallengeType;
  matchedRule?: string;
  matchedSelector?: string;
  pageHost?: string;
  pagePath?: string;
  pageTitle?: string;
};

export type DrakeLoginStepKind =
  | "email"
  | "password"
  | "account-picker"
  | "stay-signed-in"
  | "client-selection"
  | "otp"
  | "approval"
  | "login-callback"
  | "drake-app"
  | "unknown";

type StrongRule = {
  challengeType: DrakeInteractiveChallengeType;
  matchedRule: string;
  matchedSelector?: string;
  test: (ctx: { body: string; page: Page; frames: Frame[] }) => Promise<boolean> | boolean;
};

function sanitizePageMeta(page: Page): Pick<
  DrakeInteractiveChallengeDetection,
  "pageHost" | "pagePath" | "pageTitle"
> {
  try {
    const url = new URL(page.url());
    return {
      pageHost: url.hostname,
      pagePath: url.pathname,
      pageTitle: undefined,
    };
  } catch {
    return { pageHost: undefined, pagePath: undefined, pageTitle: undefined };
  }
}

async function withTitle(
  page: Page,
  base: DrakeInteractiveChallengeDetection,
): Promise<DrakeInteractiveChallengeDetection> {
  const title = await page.title().catch(() => "");
  return {
    ...base,
    pageTitle: title.slice(0, 120) || undefined,
  };
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

/** Etapas normais do Microsoft / Drake — nunca MFA. */
export async function classifyLoginStep(page: Page): Promise<DrakeLoginStepKind> {
  const url = page.url().toLowerCase();
  if (url.includes("logincallback") || url.includes("loginCallback".toLowerCase())) {
    return "login-callback";
  }
  try {
    const host = new URL(page.url()).hostname.toLowerCase();
    const path = new URL(page.url()).pathname.toLowerCase();
    if (
      host.includes("drake.bz") &&
      path.includes("/m/") &&
      !path.includes("/m/public/") &&
      !path.includes("/logon")
    ) {
      return "drake-app";
    }
  } catch {
    /* ignore */
  }

  const body = await pageBodyText(page);
  if (
    /pick an account|escolher uma conta|use another account|usar outra conta|contas recentes/i.test(
      body,
    )
  ) {
    return "account-picker";
  }
  if (
    /stay signed in\??|continuar conectado\??|don't show this again|não mostrar isso novamente|manter conectado/i.test(
      body,
    )
  ) {
    return "stay-signed-in";
  }

  const { isClientSelectionScreen } = await import("./client-selection.server");
  if (await isClientSelectionScreen(page)) {
    return "client-selection";
  }

  // Também cobrir combobox de contexto legado
  try {
    const { isContextSelectionScreen } = await import("./context-selection.server");
    if (await isContextSelectionScreen(page)) {
      return "client-selection";
    }
  } catch {
    /* ignore */
  }

  const password = await findPasswordField(page);
  if (password) return "password";

  const username = await findUsernameField(page);
  if (username && username !== "ambiguous") return "email";

  return "unknown";
}

const STRONG_RULES: StrongRule[] = [
  {
    challengeType: "captcha",
    matchedRule: "visible-captcha-iframe",
    matchedSelector:
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]',
    test: async ({ frames }) => {
      for (const frame of frames) {
        const captcha = frame.locator(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="captcha" i]',
        );
        if ((await captcha.count().catch(() => 0)) > 0) return true;
      }
      return false;
    },
  },
  {
    challengeType: "otp-code",
    matchedRule: "explicit-enter-code-text",
    test: ({ body }) =>
      /\benter code\b|\benter the code\b|digite o c[oó]digo|insira o c[oó]digo|c[oó]digo de verifica[cç][aã]o/i.test(
        body,
      ),
  },
  {
    challengeType: "otp-code",
    matchedRule: "microsoft-otc-input",
    matchedSelector: 'input[name="otc"], #idTxtBx_SAOTCC_OTC, input[aria-label*="code" i]',
    test: async ({ frames }) => {
      for (const frame of frames) {
        const otc = frame.locator(
          'input[name="otc"], #idTxtBx_SAOTCC_OTC, #idTxtBx_SAOTCS_ProofConfirmation',
        );
        if ((await otc.count().catch(() => 0)) > 0) {
          const visible = await otc.first().isVisible().catch(() => false);
          if (visible) return true;
        }
      }
      return false;
    },
  },
  {
    challengeType: "authenticator-approval",
    matchedRule: "explicit-approve-sign-in-request",
    test: ({ body }) =>
      /approve sign in request|aprove a solicita[cç][aã]o de entrada|aprovar solicita[cç][aã]o de entrada/i.test(
        body,
      ),
  },
  {
    challengeType: "number-matching",
    matchedRule: "explicit-number-matching",
    test: ({ body }) =>
      /number matching|correspond[eê]ncia de n[uú]mero|enter the number you see|digite o n[uú]mero que aparece/i.test(
        body,
      ),
  },
  {
    challengeType: "authenticator-approval",
    matchedRule: "authenticator-app-approval-ui",
    matchedSelector: "#idDiv_SAOTCAS_Title, #idDiv_SAOTCS_Title",
    test: async ({ body, frames }) => {
      if (
        !/microsoft authenticator|aprov[ea].*aplicativo|check your authenticator|open your authenticator/i.test(
          body,
        )
      ) {
        return false;
      }
      // Exige UI de desafio AAD, não menção isolada em rodapé.
      for (const frame of frames) {
        const challenge = frame.locator(
          "#idDiv_SAOTCAS_Title, #idDiv_SAOTCS_Title, #idRichContext_DisplaySign, [data-testid='authenticatorAppProof']",
        );
        if ((await challenge.count().catch(() => 0)) > 0) return true;
      }
      return false;
    },
  },
  {
    challengeType: "identity-verification",
    matchedRule: "verify-identity-with-method-choice",
    test: async ({ body, frames }) => {
      if (!/verify your identity|verifique sua identidade/i.test(body)) return false;
      for (const frame of frames) {
        const methods = frame.locator(
          '#idDiv_SAOTCS_Proofs, [data-value*="PhoneApp"], [data-value*="OneWaySMS"], [data-value*="TotpAuthenticator"]',
        );
        if ((await methods.count().catch(() => 0)) > 0) return true;
      }
      return /text\s*#\s*\d+|ligar para|call\s*\+|sms|authenticator app/i.test(body);
    },
  },
];

/**
 * Detecta desafio interativo real com evidência forte.
 * Não usa palavras genéricas isoladas (code, verify, approve, sign in, authentication).
 */
export async function detectInteractiveChallenge(
  page: Page,
): Promise<DrakeInteractiveChallengeDetection> {
  const meta = sanitizePageMeta(page);
  const step = await classifyLoginStep(page);

  // Etapas normais nunca são MFA.
  if (
    step === "email" ||
    step === "password" ||
    step === "account-picker" ||
    step === "stay-signed-in" ||
    step === "client-selection" ||
    step === "login-callback" ||
    step === "drake-app"
  ) {
    return withTitle(page, { detected: false, ...meta });
  }

  const body = await pageBodyText(page);
  const frames = usableFrames(page);

  for (const rule of STRONG_RULES) {
    if (await rule.test({ body, page, frames })) {
      return withTitle(page, {
        detected: true,
        challengeType: rule.challengeType,
        matchedRule: rule.matchedRule,
        matchedSelector: rule.matchedSelector,
        ...meta,
      });
    }
  }

  return withTitle(page, { detected: false, ...meta });
}

/** Compatível com callers legados: retorna challengeType ou null. */
export async function detectCaptchaOrMfa(page: Page): Promise<string | null> {
  const result = await detectInteractiveChallenge(page);
  return result.detected ? result.challengeType ?? "unknown-interactive" : null;
}

export function logInteractiveChallengeDetection(
  detection: DrakeInteractiveChallengeDetection,
): void {
  if (!detection.detected) return;
  logger.info("drake-authentication", "Possível confirmação interativa encontrada", {
    challengeType: detection.challengeType,
    matchedRule: detection.matchedRule,
    matchedSelector: detection.matchedSelector,
    pageHost: detection.pageHost,
    pagePath: detection.pagePath,
    pageTitle: detection.pageTitle,
  });
}

/**
 * Detecta MFA apenas com evidência forte e registra a regra.
 * Páginas desconhecidas: o caller deve aguardar evolução antes de chamar de novo.
 */
export async function requireNoInteractiveChallenge(page: Page): Promise<void> {
  const detection = await detectInteractiveChallenge(page);
  if (!detection.detected) return;
  logInteractiveChallengeDetection(detection);
  const { interactiveAuthRequiredError } = await import("./errors");
  throw interactiveAuthRequiredError();
}

/** Heurística pura para testes (sem Playwright). */
export function classifyBodyTextForTests(body: string): {
  stepHint: DrakeLoginStepKind | "strong-mfa" | "generic-noise";
  challengeType?: DrakeInteractiveChallengeType;
  matchedRule?: string;
} {
  if (/pick an account|escolher uma conta|use another account/i.test(body)) {
    return { stepHint: "account-picker" };
  }
  if (/stay signed in\??|continuar conectado\??/i.test(body)) {
    return { stepHint: "stay-signed-in" };
  }
  if (/loginCallback|logincallback/i.test(body)) {
    return { stepHint: "login-callback" };
  }
  if (/\benter code\b|digite o c[oó]digo|c[oó]digo de verifica[cç][aã]o/i.test(body)) {
    return { stepHint: "strong-mfa", challengeType: "otp-code", matchedRule: "explicit-enter-code-text" };
  }
  if (/approve sign in request/i.test(body)) {
    return {
      stepHint: "strong-mfa",
      challengeType: "authenticator-approval",
      matchedRule: "explicit-approve-sign-in-request",
    };
  }
  if (/number matching|digite o n[uú]mero que aparece/i.test(body)) {
    return {
      stepHint: "strong-mfa",
      challengeType: "number-matching",
      matchedRule: "explicit-number-matching",
    };
  }
  if (/recaptcha|hcaptcha|\bcaptcha\b/i.test(body)) {
    return { stepHint: "strong-mfa", challengeType: "captcha", matchedRule: "captcha-text" };
  }
  // Ruído genérico — não MFA
  if (/\b(code|verify|approve|confirmation|authentication|sign in)\b/i.test(body)) {
    return { stepHint: "generic-noise" };
  }
  if (/password|senha|e-?mail|próximo|next|sign in/i.test(body)) {
    return { stepHint: "password" };
  }
  return { stepHint: "unknown" };
}

export async function handleAccountPicker(page: Page): Promise<boolean> {
  const step = await classifyLoginStep(page);
  if (step !== "account-picker") return false;

  const username = env.DRAKE_USERNAME.trim().toLowerCase();
  const frames = usableFrames(page);

  for (const frame of frames) {
    if (username) {
      const tiles = frame.locator(
        '[data-test-id="accountTile"], [role="button"][data-testid*="account"], #tilesHolder .tile, .table[role="button"], div[data-test-id]',
      );
      const count = await tiles.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const tile = tiles.nth(i);
        const text = ((await tile.innerText().catch(() => "")) || "").toLowerCase();
        if (text.includes(username) || (username.includes("@") && text.includes(username.split("@")[0]!))) {
          await tile.click().catch(() => undefined);
          return true;
        }
      }
      // Fallback: link com o e-mail
      const byText = frame.getByText(env.DRAKE_USERNAME, { exact: false });
      if ((await byText.count().catch(() => 0)) > 0) {
        await byText.first().click().catch(() => undefined);
        return true;
      }
    }

    const another = frame.getByRole("button", {
      name: /use another account|usar outra conta|outra conta/i,
    });
    if ((await another.count().catch(() => 0)) > 0) {
      await another.first().click().catch(() => undefined);
      return true;
    }
    const anotherLink = frame.getByText(/use another account|usar outra conta/i);
    if ((await anotherLink.count().catch(() => 0)) > 0) {
      await anotherLink.first().click().catch(() => undefined);
      return true;
    }
  }
  return false;
}

/**
 * Stay signed in / Continuar conectado → preferencialmente "No".
 */
export async function handleStaySignedIn(page: Page): Promise<boolean> {
  const step = await classifyLoginStep(page);
  if (step !== "stay-signed-in") return false;

  for (const frame of usableFrames(page)) {
    const noBtn = frame.locator(
      '#idBtn_Back, input[value="No"], button:has-text("No"), button:has-text("Não")',
    );
    if ((await noBtn.count().catch(() => 0)) > 0) {
      const visible = await noBtn.first().isVisible().catch(() => false);
      if (visible) {
        await noBtn.first().click().catch(() => undefined);
        return true;
      }
    }
    const byRole = frame.getByRole("button", { name: /^(no|não)$/i });
    if ((await byRole.count().catch(() => 0)) > 0) {
      await byRole.first().click().catch(() => undefined);
      return true;
    }
  }
  return false;
}

/** Tenta tratar etapas normais do Microsoft; retorna true se interagiu. */
export async function handleNormalMicrosoftSteps(page: Page): Promise<boolean> {
  if (await handleAccountPicker(page)) return true;
  if (await handleStaySignedIn(page)) return true;
  return false;
}
