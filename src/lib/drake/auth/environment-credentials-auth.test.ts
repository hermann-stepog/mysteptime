import { describe, expect, it, vi } from "vitest";
import {
  credentialsNotConfiguredError,
  interactiveAuthRequiredError,
  DRAKE_CREDENTIALS_NOT_CONFIGURED,
  DRAKE_INTERACTIVE_AUTH_REQUIRED,
} from "./errors";
import { sanitizeError, sanitizeSensitiveText } from "../sanitize-error.server";
import { assertDrakeCredentialsConfigured, getDrakeConfig } from "../config.server";

describe("Drake auth errors", () => {
  it("credenciais ausentes retornam DRAKE_CREDENTIALS_NOT_CONFIGURED", () => {
    const err = credentialsNotConfiguredError();
    expect(err.code).toBe(DRAKE_CREDENTIALS_NOT_CONFIGURED);
    expect(err.message).toContain("não estão configuradas");
  });

  it("MFA retorna DRAKE_INTERACTIVE_AUTH_REQUIRED", () => {
    const err = interactiveAuthRequiredError();
    expect(err.code).toBe(DRAKE_INTERACTIVE_AUTH_REQUIRED);
    expect(err.message).toContain("confirmação interativa");
  });

  it("credenciais nao aparecem na sanitizacao", () => {
    const text = sanitizeSensitiveText(
      "Authorization: Bearer tokensecret Cookie: SapiensiaAuth=abc",
    );
    expect(text).not.toContain("tokensecret");
    expect(text).not.toContain("abc");
    const safe = sanitizeError(new Error("password=super-secret-value"));
    expect(safe.message).not.toContain("super-secret-value");
  });
});

describe("config credentials", () => {
  it("assertDrakeCredentialsConfigured falha sem usuario/senha", () => {
    const prevUser = process.env.DRAKE_USERNAME;
    const prevPass = process.env.DRAKE_PASSWORD;
    try {
      process.env.DRAKE_USERNAME = "";
      process.env.DRAKE_PASSWORD = "";
      expect(() => assertDrakeCredentialsConfigured()).toThrow(/não estão configuradas/);
    } finally {
      process.env.DRAKE_USERNAME = prevUser;
      process.env.DRAKE_PASSWORD = prevPass;
    }
  });

  it("DRAKE_AUTH_HEADLESS default true e cache path privado", () => {
    const cfg = getDrakeConfig();
    expect(cfg.DRAKE_AUTH_HEADLESS).toBe(true);
    expect(cfg.DRAKE_SESSION_CACHE_PATH).toContain("private");
    expect(cfg.DRAKE_SESSION_CACHE_PATH).not.toContain("public");
  });

  it("usuario e senha vem do backend env quando configurados", () => {
    const prevUser = process.env.DRAKE_USERNAME;
    const prevPass = process.env.DRAKE_PASSWORD;
    try {
      process.env.DRAKE_USERNAME = "svc@example.com";
      process.env.DRAKE_PASSWORD = "not-logged";
      const cfg = getDrakeConfig();
      expect(cfg.DRAKE_USERNAME).toBe("svc@example.com");
      expect(cfg.DRAKE_PASSWORD).toBe("not-logged");
    } finally {
      process.env.DRAKE_USERNAME = prevUser;
      process.env.DRAKE_PASSWORD = prevPass;
    }
  });
});

describe("headless auth contract", () => {
  it("adaptador local lanca chromium apenas com headless true", async () => {
    const fs = await import("node:fs/promises");
    const local = await fs.readFile(
      "src/lib/drake/browser/local-drake-browser-runtime.server.ts",
      "utf8",
    );
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(local).toMatch(/chromium\.launch\(\{\s*headless:\s*true/);
    expect(local).toMatch(/await import\(/);
    expect(local).toMatch(/playwright/);
    expect(auth).toMatch(/createDrakeBrowserRuntime/);
    expect(auth).not.toMatch(/from ["']playwright["']/);
    expect(auth).not.toMatch(/headless:\s*false/);
    expect(auth).not.toMatch(/page\.pause/);
  });

  it("adaptador remoto usa connectOverCDP e nao lanca browser local", async () => {
    const fs = await import("node:fs/promises");
    const remote = await fs.readFile(
      "src/lib/drake/browser/remote-drake-browser-runtime.server.ts",
      "utf8",
    );
    expect(remote).toMatch(/connectOverCDP/);
    expect(remote).toMatch(/playwright-core/);
    expect(remote).not.toMatch(/chromium\.launch\s*\(/);
    expect(remote).not.toMatch(/executablePath/);
  });

  it("relatorios nao usam Page/chromium para executar", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const file of [
      "report-api-runner.server.ts",
      "api-download.server.ts",
      "background-job-poller.server.ts",
    ]) {
      const src = await fs.readFile(path.resolve("src/lib/drake", file), "utf8");
      expect(src).not.toMatch(/\bchromium\b/);
      expect(src).not.toMatch(/\bBrowserContext\b/);
      expect(src).not.toMatch(/\{[^}]*\bPage\b[^}]*\} from ["']playwright["']/);
    }
  });

  it("bootstrap SignalR usa ASP.NET Core SignalR", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/signalr-session.server.ts", "utf8");
    expect(src).toMatch(/@microsoft\/signalr/);
    expect(src).toMatch(/HubConnectionBuilder/);
    expect(src).toMatch(/PlaywrightSignalRHttpClient|HttpTransportType\.LongPolling/);
    expect(src).toMatch(/channels=/);
    expect(src).toMatch(/BackgroundExecutionRequestStatusUpdated/);
    expect(src).toMatch(/GetGlobalParameters/);
    expect(src).toMatch(/GetSecurityUser/);
    expect(src).toMatch(/close/);
    expect(src).toMatch(/armDownloadWatch/);
  });
});

describe("session cache", () => {
  it("writeSessionCache e no-op quando desabilitado", async () => {
    const prev = process.env.DRAKE_SESSION_CACHE_ENABLED;
    try {
      process.env.DRAKE_SESSION_CACHE_ENABLED = "false";
      vi.resetModules();
      const { writeSessionCache, readSessionCache } = await import("./session-cache.server");
      await writeSessionCache({ cookies: [{ name: "x" }], origins: [] });
      expect(await readSessionCache()).toBeNull();
    } finally {
      process.env.DRAKE_SESSION_CACHE_ENABLED = prev;
      vi.resetModules();
    }
  });
});
