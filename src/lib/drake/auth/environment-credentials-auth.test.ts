import { describe, expect, it, vi } from "vitest";
import { assertDrakeCredentialsConfigured, getDrakeConfig } from "../config.server";
import { sanitizeError, sanitizeSensitiveText } from "../sanitize-error.server";
import {
  credentialsNotConfiguredError,
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  DRAKE_INTERACTIVE_AUTH_REQUIRED,
  interactiveAuthRequiredError,
} from "./errors";

describe("Drake auth errors", () => {
  it("retorna codigos estaveis para credenciais ausentes e MFA", () => {
    expect(credentialsNotConfiguredError().code).toBe(DRAKE_CREDENTIALS_NOT_CONFIGURED);
    expect(interactiveAuthRequiredError().code).toBe(DRAKE_INTERACTIVE_AUTH_REQUIRED);
  });

  it("nao deixa credenciais aparecerem na sanitizacao", () => {
    const text = sanitizeSensitiveText(
      "Authorization: Bearer tokensecret Cookie: SapiensiaAuth=abc",
    );
    expect(text).not.toContain("tokensecret");
    expect(text).not.toContain("abc");
    expect(sanitizeError(new Error("password=super-secret-value")).message).not.toContain(
      "super-secret-value",
    );
  });
});

describe("Drake credentials config", () => {
  it("falha sem usuario e senha", () => {
    const previousUser = process.env.DRAKE_USERNAME;
    const previousPassword = process.env.DRAKE_PASSWORD;
    try {
      process.env.DRAKE_USERNAME = "";
      process.env.DRAKE_PASSWORD = "";
      expect(() => assertDrakeCredentialsConfigured()).toThrow();
    } finally {
      process.env.DRAKE_USERNAME = previousUser;
      process.env.DRAKE_PASSWORD = previousPassword;
    }
  });

  it("le usuario e senha apenas do backend", () => {
    const previousUser = process.env.DRAKE_USERNAME;
    const previousPassword = process.env.DRAKE_PASSWORD;
    try {
      process.env.DRAKE_USERNAME = "svc@example.com";
      process.env.DRAKE_PASSWORD = "not-logged";
      expect(getDrakeConfig()).toMatchObject({
        DRAKE_USERNAME: "svc@example.com",
        DRAKE_PASSWORD: "not-logged",
      });
    } finally {
      process.env.DRAKE_USERNAME = previousUser;
      process.env.DRAKE_PASSWORD = previousPassword;
    }
  });
});

describe("Drake HTTP-only contract", () => {
  it("o autenticador de producao nao referencia browser", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    const login = await fs.readFile(
      "src/lib/drake/auth/http-credentials-login.server.ts",
      "utf8",
    );
    expect(auth).toMatch(/loginWithDrakeHttpCredentials/);
    expect(login).toMatch(/SelfAsserted|CombinedSigninAndSignup|LoginCallback/);
    expect(`${auth}\n${login}`).not.toMatch(
      /playwright|chromium|createDrakeBrowserRuntime|performHeadlessDrakeLogin/i,
    );
  });

  it("cache continua funcionando em memoria", async () => {
    const previous = process.env.DRAKE_SESSION_CACHE_ENABLED;
    try {
      process.env.DRAKE_SESSION_CACHE_ENABLED = "false";
      vi.resetModules();
      const cache = await import("./session-cache.server");
      cache.__resetSessionCacheMemoryForTests();
      await cache.writeSessionCache({ cookies: [{ name: "x" }], origins: [] });
      expect((await cache.readSessionCache())?.cookies[0]).toMatchObject({ name: "x" });
      await cache.clearSessionCache();
      expect(await cache.readSessionCache()).toBeNull();
    } finally {
      process.env.DRAKE_SESSION_CACHE_ENABLED = previous;
      vi.resetModules();
    }
  });
});
