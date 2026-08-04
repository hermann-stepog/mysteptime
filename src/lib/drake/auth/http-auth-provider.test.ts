import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function authenticatedSession() {
  return {
    storageState: {
      cookies: [{ name: "SapiensiaAuth", value: "opaque", domain: "drake.bz", path: "/" }],
      origins: [],
    },
    cookieJar: { cookieNames: () => ["SapiensiaAuth"] },
    requiredHeaders: {},
  };
}

describe("automatic Drake HTTP auth", () => {
  beforeEach(() => vi.resetModules());

  afterEach(() => {
    vi.doUnmock("../api-session.server");
    vi.doUnmock("./session-cache.server");
    vi.doUnmock("../http/create-drake-http-client.server");
    vi.doUnmock("../config.server");
    vi.doUnmock("./http-credentials-login.server");
    vi.resetModules();
  });

  function mockBase(options: {
    cached: unknown;
    cachedSessionValid?: boolean;
    loginError?: Error;
  }) {
    const loginWithDrakeHttpCredentials = options.loginError
      ? vi.fn().mockRejectedValue(options.loginError)
      : vi.fn().mockResolvedValue(authenticatedSession());
    const writeSessionCache = vi.fn().mockResolvedValue(undefined);
    const clearSessionCache = vi.fn().mockResolvedValue(undefined);
    const validateDrakeApiSession = options.cachedSessionValid === false
      ? vi.fn().mockRejectedValueOnce(new Error("401")).mockResolvedValue(undefined)
      : vi.fn().mockResolvedValue(undefined);

    vi.doMock("../config.server", () => ({
      assertDrakeCredentialsConfigured: () => undefined,
      getDrakeConfig: () => ({ DRAKE_LOG_LEVEL: "error" }),
      env: { DRAKE_LOG_LEVEL: "error" },
    }));
    vi.doMock("./session-cache.server", () => ({
      readSessionCache: vi.fn().mockResolvedValue(options.cached),
      writeSessionCache,
      clearSessionCache,
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
    vi.doMock("./http-credentials-login.server", () => ({
      loginWithDrakeHttpCredentials,
    }));

    return {
      loginWithDrakeHttpCredentials,
      writeSessionCache,
      clearSessionCache,
      validateDrakeApiSession,
    };
  }

  it("reutiliza uma sessao valida sem refazer o login", async () => {
    const cached = authenticatedSession().storageState;
    const mocks = mockBase({ cached, cachedSessionValid: true });
    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );

    const result = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();

    expect(result.reusedCache).toBe(true);
    expect(mocks.loginWithDrakeHttpCredentials).not.toHaveBeenCalled();
    expect(mocks.validateDrakeApiSession).toHaveBeenCalledTimes(1);
  });

  it("faz login HTTP quando a sessao nao existe", async () => {
    const mocks = mockBase({ cached: null });
    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );

    const result = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();

    expect(result.reusedCache).toBe(false);
    expect(mocks.loginWithDrakeHttpCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.writeSessionCache).toHaveBeenCalledTimes(1);
  });

  it("descarta cache expirado e refaz o login por HTTP", async () => {
    const mocks = mockBase({
      cached: authenticatedSession().storageState,
      cachedSessionValid: false,
    });
    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );

    await new EnvironmentCredentialsDrakeAuthProvider().authenticate();

    expect(mocks.clearSessionCache).toHaveBeenCalledTimes(1);
    expect(mocks.loginWithDrakeHttpCredentials).toHaveBeenCalledTimes(1);
  });

  it("preserva erro de confirmacao interativa retornado pelo fluxo HTTP", async () => {
    const { interactiveAuthRequiredError, DRAKE_INTERACTIVE_AUTH_REQUIRED } = await import(
      "./errors"
    );
    mockBase({ cached: null, loginError: interactiveAuthRequiredError() });
    const { EnvironmentCredentialsDrakeAuthProvider } = await import(
      "./environment-credentials-auth.server"
    );

    await expect(
      new EnvironmentCredentialsDrakeAuthProvider().authenticate(),
    ).rejects.toMatchObject({ code: DRAKE_INTERACTIVE_AUTH_REQUIRED });
  });

  it("o caminho de producao nao referencia navegador", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(auth).toMatch(/loginWithDrakeHttpCredentials/);
    expect(auth).not.toMatch(/playwright|chromium|createDrakeBrowserRuntime|performHeadlessDrakeLogin/i);
  });
});
