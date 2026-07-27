import { describe, expect, it } from "vitest";
import { classifyBodyTextForTests } from "./interactive-challenge.server";

describe("interactive challenge detection (heuristics)", () => {
  it("pagina comum de e-mail nao e MFA", () => {
    const r = classifyBodyTextForTests(
      "Sign in\nEmail, phone, or Skype\nNext\nCan't access your account?",
    );
    expect(r.stepHint).not.toBe("strong-mfa");
  });

  it("pagina comum de senha nao e MFA", () => {
    const r = classifyBodyTextForTests(
      "Enter password\nPassword\nSign in\nForgot my password\nLearn more about Microsoft Authenticator",
    );
    // Menção isolada a Authenticator no rodapé não é MFA.
    expect(r.challengeType).toBeUndefined();
    expect(r.stepHint).not.toBe("strong-mfa");
  });

  it("account picker nao e MFA", () => {
    const r = classifyBodyTextForTests("Pick an account\nUse another account\nuser@example.com");
    expect(r.stepHint).toBe("account-picker");
  });

  it("stay signed in nao e MFA", () => {
    const r = classifyBodyTextForTests("Stay signed in?\nDo this to reduce the number of times you are asked to sign in.\nYes\nNo");
    expect(r.stepHint).toBe("stay-signed-in");
  });

  it("LoginCallback nao e MFA", () => {
    const r = classifyBodyTextForTests("Redirecting to LoginCallback.ashx please wait");
    expect(r.stepHint).toBe("login-callback");
  });

  it("OTP explicito e MFA", () => {
    const r = classifyBodyTextForTests("Enter code\nWe sent a code to your phone");
    expect(r).toMatchObject({
      stepHint: "strong-mfa",
      challengeType: "otp-code",
      matchedRule: "explicit-enter-code-text",
    });
  });

  it("Authenticator approval explicito e MFA", () => {
    const r = classifyBodyTextForTests("Approve sign in request\nOpen your Authenticator app");
    expect(r).toMatchObject({
      stepHint: "strong-mfa",
      challengeType: "authenticator-approval",
      matchedRule: "explicit-approve-sign-in-request",
    });
  });

  it("Number matching e MFA", () => {
    const r = classifyBodyTextForTests("Number matching\nEnter the number you see in your app: 42");
    expect(r).toMatchObject({
      stepHint: "strong-mfa",
      challengeType: "number-matching",
    });
  });

  it("Captcha e interacao obrigatoria", () => {
    const r = classifyBodyTextForTests("Please complete the captcha to continue");
    expect(r).toMatchObject({ stepHint: "strong-mfa", challengeType: "captcha" });
  });

  it("palavras genericas isoladas nao geram falso positivo", () => {
    for (const word of ["code", "verify", "approve", "confirmation", "authentication", "sign in"]) {
      const r = classifyBodyTextForTests(`Please ${word} to continue with your account`);
      expect(r.stepHint).not.toBe("strong-mfa");
    }
  });

  it("log de deteccao nao inclui campos sensiveis (contrato)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/auth/interactive-challenge.server.ts", "utf8");
    const logFn = src.slice(
      src.indexOf("export function logInteractiveChallengeDetection"),
      src.indexOf("export async function requireNoInteractiveChallenge"),
    );
    expect(logFn).toMatch(/matchedRule/);
    expect(logFn).toMatch(/Possível confirmação interativa encontrada/);
    expect(logFn).toMatch(/pageHost|pagePath|pageTitle/);
    expect(logFn).not.toMatch(/cookieValue|DRAKE_PASSWORD|storageState|innerHTML|cookieNames/);
  });

  it("deteccao usa apenas regras fortes (sem approve\/otc genericos)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/auth/interactive-challenge.server.ts", "utf8");
    expect(src).not.toMatch(/aria-label\*=["']Approve/i);
    expect(src).not.toMatch(/\[id\*=["']otc["']\]/);
    expect(src).toMatch(/approve sign in request/i);
    expect(src).toMatch(/input\[name=["']otc["']\]/);
  });
});

describe("auth flow contracts after MFA fix", () => {
  it("sessao ausente ainda inicia login automatico", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(auth).toMatch(/Sessão ausente ou expirada; iniciando autenticação automática/);
    expect(auth).toMatch(/performHeadlessDrakeLogin/);
    expect(auth).not.toMatch(/interactiveBootstrapRequiredError/);
  });

  it("Menu 200 e criterio de sucesso no BrowserContext", async () => {
    const fs = await import("node:fs/promises");
    const menu = await fs.readFile(
      "src/lib/drake/auth/browser-menu-validation.server.ts",
      "utf8",
    );
    expect(menu).toMatch(/waitForBrowserMenuAuthenticated/);
    expect(menu).toMatch(/probe\.status === 200/);
  });

  it("importadores e scheduler nao foram alterados", async () => {
    const fs = await import("node:fs/promises");
    const importDrake = await fs.readFile("src/lib/histograma/import-drake.ts", "utf8");
    const scheduler = await fs.readFile("src/lib/drake/drake-scheduler.server.ts", "utf8");
    expect(importDrake).not.toMatch(/detectInteractiveChallenge|DRAKE_AUTH_DEBUG/);
    expect(scheduler).not.toMatch(/detectInteractiveChallenge|DRAKE_AUTH_DEBUG/);
  });
});
