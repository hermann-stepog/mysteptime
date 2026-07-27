import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("automatic Drake auth (lazy browser)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("../api-session.server");
    vi.doUnmock("../browser/create-drake-browser-runtime.server");
    vi.doUnmock("./session-cache.server");
    vi.doUnmock("../http/create-drake-http-client.server");
    vi.doUnmock("../config.server");
    vi.doUnmock("./headless-login.server");
    vi.doUnmock("./browser-menu-validation.server");
    vi.resetModules();
  });

  it("sessao valida nao importa nem inicializa Playwright/BrowserRuntime", async () => {
    const createDrakeBrowserRuntime = vi.fn();
    const validateDrakeApiSession = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../config.server", () => ({
      assertDrakeCredentialsConfigured: () => undefined,
      getDrakeConfig: () => ({ DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true }),
      env: { DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true },
    }));
    vi.doMock("./session-cache.server", () => ({
      readSessionCache: vi.fn().mockResolvedValue({
        cookies: [{ name: "SapiensiaAuth", value: "x", domain: "drake.bz", path: "/" }],
        origins: [],
      }),
      writeSessionCache: vi.fn(),
      clearSessionCache: vi.fn(),
    }));
    vi.doMock("../api-session.server", () => ({
      validateDrakeApiSession,
      DrakeSessionExpiredError: class extends Error {},
    }));
    vi.doMock("../http/create-drake-http-client.server", () => ({
      createDrakeHttpClientFromAuthenticatedSession: vi.fn().mockReturnValue({
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      createDrakeHttpClientFromStorageState: vi.fn(),
    }));
    vi.doMock("../browser/create-drake-browser-runtime.server", () => ({
      createDrakeBrowserRuntime,
      isDrakeBrowserRemoteMode: () => false,
    }));

    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );
    const result = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();

    expect(result.reusedCache).toBe(true);
    expect(createDrakeBrowserRuntime).not.toHaveBeenCalled();
    expect(validateDrakeApiSession).toHaveBeenCalledTimes(1);
  });

  it("sessao ausente inicia login automatico (nao DRAKE_INTERACTIVE_BOOTSTRAP_REQUIRED)", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const createDrakeBrowserRuntime = vi.fn().mockReturnValue({
      mode: "local",
      createAuthenticatedContext: vi.fn().mockResolvedValue({
        page: { url: () => "https://drake.bz/m/" },
        context: {},
        close,
      }),
    });
    const writeSessionCache = vi.fn().mockResolvedValue(undefined);
    const performHeadlessDrakeLogin = vi.fn().mockResolvedValue(undefined);
    const waitForBrowserMenuAuthenticated = vi.fn().mockResolvedValue({
      probe: { status: 200, authorizationHeader: undefined, requiredHeaders: {} },
    });
    const exportAuthenticatedSessionAfterBrowserMenu = vi.fn().mockResolvedValue({
      storageState: { cookies: [{ name: "SapiensiaAuth", value: "ok" }], origins: [] },
      cookieJar: { cookieNames: () => ["SapiensiaAuth"] },
      authorizationHeader: undefined,
      requiredHeaders: {},
    });

    vi.doMock("../config.server", () => ({
      assertDrakeCredentialsConfigured: () => undefined,
      getDrakeConfig: () => ({ DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true }),
      env: { DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true },
    }));
    vi.doMock("./session-cache.server", () => ({
      readSessionCache: vi.fn().mockResolvedValue(null),
      writeSessionCache,
      clearSessionCache: vi.fn(),
    }));
    vi.doMock("../api-session.server", () => ({
      validateDrakeApiSession: vi.fn().mockResolvedValue(undefined),
      DrakeSessionExpiredError: class extends Error {},
    }));
    vi.doMock("../http/create-drake-http-client.server", () => ({
      createDrakeHttpClientFromAuthenticatedSession: vi.fn().mockReturnValue({
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      createDrakeHttpClientFromStorageState: vi.fn(),
    }));
    vi.doMock("../browser/create-drake-browser-runtime.server", () => ({
      createDrakeBrowserRuntime,
      isDrakeBrowserRemoteMode: () => false,
    }));
    vi.doMock("./headless-login.server", () => ({
      performHeadlessDrakeLogin,
      extractStorageStateFromPage: vi.fn(),
    }));
    vi.doMock("./browser-menu-validation.server", () => ({
      waitForBrowserMenuAuthenticated,
      exportAuthenticatedSessionAfterBrowserMenu,
    }));

    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );
    const { DRAKE_INTERACTIVE_BOOTSTRAP_REQUIRED } = await import("./errors");

    const result = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
    expect(result.reusedCache).toBe(false);
    expect(createDrakeBrowserRuntime).toHaveBeenCalledTimes(1);
    expect(performHeadlessDrakeLogin).toHaveBeenCalledTimes(1);
    expect(writeSessionCache).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(result).not.toMatchObject({ code: DRAKE_INTERACTIVE_BOOTSTRAP_REQUIRED });
  });

  it("sessao 401 inicia login automatico", async () => {
    const createDrakeBrowserRuntime = vi.fn().mockReturnValue({
      mode: "local",
      createAuthenticatedContext: vi.fn().mockResolvedValue({
        page: {},
        context: {},
        close: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const clearSessionCache = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../config.server", () => ({
      assertDrakeCredentialsConfigured: () => undefined,
      getDrakeConfig: () => ({ DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true }),
      env: { DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true },
    }));
    vi.doMock("./session-cache.server", () => ({
      readSessionCache: vi.fn().mockResolvedValue({
        cookies: [{ name: "ASP.NET_SessionId", value: "stale" }],
        origins: [],
      }),
      writeSessionCache: vi.fn().mockResolvedValue(undefined),
      clearSessionCache,
    }));
    vi.doMock("../api-session.server", () => ({
      validateDrakeApiSession: vi
        .fn()
        .mockRejectedValueOnce(new Error("401"))
        .mockResolvedValue(undefined),
      DrakeSessionExpiredError: class extends Error {},
    }));
    vi.doMock("../http/create-drake-http-client.server", () => ({
      createDrakeHttpClientFromAuthenticatedSession: vi.fn().mockReturnValue({
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
      createDrakeHttpClientFromStorageState: vi.fn(),
    }));
    vi.doMock("../browser/create-drake-browser-runtime.server", () => ({
      createDrakeBrowserRuntime,
      isDrakeBrowserRemoteMode: () => false,
    }));
    vi.doMock("./headless-login.server", () => ({
      performHeadlessDrakeLogin: vi.fn().mockResolvedValue(undefined),
      extractStorageStateFromPage: vi.fn(),
    }));
    vi.doMock("./browser-menu-validation.server", () => ({
      waitForBrowserMenuAuthenticated: vi.fn().mockResolvedValue({
        probe: { status: 200, requiredHeaders: {} },
      }),
      exportAuthenticatedSessionAfterBrowserMenu: vi.fn().mockResolvedValue({
        storageState: { cookies: [], origins: [] },
        cookieJar: { cookieNames: () => [] },
        authorizationHeader: undefined,
        requiredHeaders: {},
      }),
    }));

    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );
    await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
    expect(clearSessionCache).toHaveBeenCalled();
    expect(createDrakeBrowserRuntime).toHaveBeenCalledTimes(1);
  });

  it("MFA real gera DRAKE_INTERACTIVE_AUTH_REQUIRED", async () => {
    vi.doMock("../config.server", () => ({
      assertDrakeCredentialsConfigured: () => undefined,
      getDrakeConfig: () => ({ DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true }),
      env: { DRAKE_LOG_LEVEL: "error", DRAKE_AUTH_HEADLESS: true },
    }));
    vi.doMock("./session-cache.server", () => ({
      readSessionCache: vi.fn().mockResolvedValue(null),
      writeSessionCache: vi.fn(),
      clearSessionCache: vi.fn(),
    }));
    vi.doMock("../api-session.server", () => ({
      validateDrakeApiSession: vi.fn(),
      DrakeSessionExpiredError: class extends Error {},
    }));
    vi.doMock("../http/create-drake-http-client.server", () => ({
      createDrakeHttpClientFromAuthenticatedSession: vi.fn(),
      createDrakeHttpClientFromStorageState: vi.fn(),
    }));
    vi.doMock("../browser/create-drake-browser-runtime.server", () => ({
      createDrakeBrowserRuntime: () => ({
        mode: "local",
        createAuthenticatedContext: async () => ({
          page: {},
          context: {},
          close: async () => undefined,
        }),
      }),
      isDrakeBrowserRemoteMode: () => false,
    }));
    const { interactiveAuthRequiredError } = await import("./errors");
    vi.doMock("./headless-login.server", () => ({
      performHeadlessDrakeLogin: vi.fn().mockRejectedValue(interactiveAuthRequiredError()),
      extractStorageStateFromPage: vi.fn(),
    }));
    vi.doMock("./browser-menu-validation.server", () => ({
      waitForBrowserMenuAuthenticated: vi.fn(),
      exportAuthenticatedSessionAfterBrowserMenu: vi.fn(),
    }));

    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );
    const { DRAKE_INTERACTIVE_AUTH_REQUIRED, DRAKE_INTERACTIVE_BOOTSTRAP_REQUIRED } =
      await import("./errors");

    await expect(
      new EnvironmentCredentialsDrakeAuthProvider().authenticate(),
    ).rejects.toMatchObject({ code: DRAKE_INTERACTIVE_AUTH_REQUIRED });
    await expect(
      new EnvironmentCredentialsDrakeAuthProvider().authenticate(),
    ).rejects.not.toMatchObject({ code: DRAKE_INTERACTIVE_BOOTSTRAP_REQUIRED });
  });

  it("formulario comum de login nao e tratado como MFA", async () => {
    const fs = await import("node:fs/promises");
    const helpers = await fs.readFile(
      "src/lib/drake/auth/headless-login-helpers.server.ts",
      "utf8",
    );
    expect(helpers).toMatch(/Formulário comum|handleNormalMicrosoftSteps|detectInteractiveChallenge/);
    expect(helpers).toMatch(/handleStaySignedIn|handleAccountPicker|classifyLoginStep/);
  });

  it("sessao valida executa relatorios somente por HTTP/SignalR (contrato)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const file of [
      "report-api-runner.server.ts",
      "api-download.server.ts",
      "background-job-poller.server.ts",
      "signalr-session.server.ts",
    ]) {
      const src = await fs.readFile(path.resolve("src/lib/drake", file), "utf8");
      expect(src).not.toMatch(/createDrakeBrowserRuntime/);
      expect(src).not.toMatch(/performHeadlessDrakeLogin/);
      expect(src).not.toMatch(/page\.goto|page\.click|page\.fill/);
    }
  });

  it("producao tenta login headless automatico quando necessario", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(auth).toMatch(/loginHeadless|performHeadlessDrakeLogin|createDrakeBrowserRuntime/);
    expect(auth).toMatch(/Sessão ausente ou expirada; iniciando autenticação automática/);
    expect(auth).toMatch(/Autenticação automática concluída/);
    expect(auth).not.toMatch(/interactiveBootstrapRequiredError/);
    expect(auth).not.toMatch(/throw interactiveBootstrapRequiredError/);
  });

  it("SignalR so inicia apos autenticacao", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/update-service.server.ts", "utf8");
    const authIdx = src.indexOf("await authenticate(false)");
    const signalrIdx = src.indexOf("await openDrakeSignalRSession");
    expect(authIdx).toBeGreaterThan(-1);
    expect(signalrIdx).toBeGreaterThan(authIdx);
  });

  it("local e remoto preservam adaptadores dual", async () => {
    const fs = await import("node:fs/promises");
    const local = await fs.readFile(
      "src/lib/drake/browser/local-drake-browser-runtime.server.ts",
      "utf8",
    );
    const remote = await fs.readFile(
      "src/lib/drake/browser/remote-drake-browser-runtime.server.ts",
      "utf8",
    );
    expect(local).toMatch(/chromium\.launch/);
    expect(local).toMatch(/headless:\s*!headed/);
    expect(remote).toMatch(/connectOverCDP/);
    expect(remote).toMatch(/playwright-core/);
  });

  it("bootstrap permanece opcional e fora do caminho normal", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    const bootstrap = await fs.readFile(
      "src/lib/drake/auth/interactive-bootstrap.server.ts",
      "utf8",
    );
    expect(auth).not.toMatch(/runInteractiveDrakeAuthBootstrap/);
    expect(bootstrap).toMatch(/headless:\s*false/);
  });

  it("importadores nao foram alterados nesta correcao", async () => {
    const fs = await import("node:fs/promises");
    const importDrake = await fs.readFile("src/lib/histograma/import-drake.ts", "utf8");
    expect(importDrake).toMatch(/importDrakeEmbarkation|origem.*drake/);
    expect(importDrake).not.toMatch(/createDrakeBrowserRuntime|performHeadlessDrakeLogin/);
  });

  it("scheduler nao foi alterado nesta correcao", async () => {
    const fs = await import("node:fs/promises");
    const scheduler = await fs.readFile("src/lib/drake/drake-scheduler.server.ts", "utf8");
    expect(scheduler).toMatch(/safeRunScheduled|node-cron|DRAKE_SCHEDULER/);
    expect(scheduler).not.toMatch(/interactiveBootstrapRequiredError/);
    expect(scheduler).not.toMatch(/performHeadlessDrakeLogin/);
  });
});
