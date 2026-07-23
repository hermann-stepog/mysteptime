import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
  MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED,
  MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
} from "./update-types";

describe("MyStepTime automation auth", () => {
  const logInfo = vi.fn();
  const logError = vi.fn();

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("./logger");
    delete process.env.MYSTEPTIME_AUTOMATION_EMAIL;
    delete process.env.MYSTEPTIME_AUTOMATION_PASSWORD;
  });

  async function loadAuth() {
    vi.resetModules();
    vi.doMock("./logger", () => ({
      logger: { info: logInfo, error: logError, warn: vi.fn(), debug: vi.fn() },
    }));
    return import("./mysteptime-automation-auth.server");
  }

  function captureLogText(): string {
    return JSON.stringify([...logInfo.mock.calls, ...logError.mock.calls]);
  }

  it("credenciais ausentes falham antes de signIn", async () => {
    delete process.env.MYSTEPTIME_AUTOMATION_EMAIL;
    delete process.env.MYSTEPTIME_AUTOMATION_PASSWORD;
    const signIn = vi.fn();
    const { authenticateMyStepTimeAutomationUser } = await loadAuth();
    await expect(authenticateMyStepTimeAutomationUser({ signIn })).rejects.toMatchObject({
      code: MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("login inválido gera MYSTEPTIME_AUTOMATION_LOGIN_FAILED", async () => {
    process.env.MYSTEPTIME_AUTOMATION_EMAIL = "auto@example.com";
    process.env.MYSTEPTIME_AUTOMATION_PASSWORD = "secret-password-value";
    const signIn = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login", status: 400, name: "AuthApiError" },
    });
    const { authenticateMyStepTimeAutomationUser } = await loadAuth();
    await expect(authenticateMyStepTimeAutomationUser({ signIn })).rejects.toMatchObject({
      code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
    });
    const logs = captureLogText();
    expect(logs).not.toContain("auto@example.com");
    expect(logs).not.toContain("secret-password-value");
  });

  it("sessão ausente gera erro controlado", async () => {
    process.env.MYSTEPTIME_AUTOMATION_EMAIL = "auto@example.com";
    process.env.MYSTEPTIME_AUTOMATION_PASSWORD = "secret-password-value";
    const signIn = vi.fn().mockResolvedValue({
      data: { session: null, user: { id: "u1" } },
      error: null,
    });
    const { authenticateMyStepTimeAutomationUser } = await loadAuth();
    await expect(authenticateMyStepTimeAutomationUser({ signIn })).rejects.toMatchObject({
      code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
    });
  });

  it("MFA gera MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED", async () => {
    process.env.MYSTEPTIME_AUTOMATION_EMAIL = "auto@example.com";
    process.env.MYSTEPTIME_AUTOMATION_PASSWORD = "secret-password-value";
    const signIn = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "MFA challenge required", code: "mfa_challenge", status: 400 },
    });
    const { authenticateMyStepTimeAutomationUser } = await loadAuth();
    await expect(authenticateMyStepTimeAutomationUser({ signIn })).rejects.toMatchObject({
      code: MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED,
    });
  });

  it("login válido retorna access token e userId sem logar segredos", async () => {
    process.env.MYSTEPTIME_AUTOMATION_EMAIL = "auto@example.com";
    process.env.MYSTEPTIME_AUTOMATION_PASSWORD = "secret-password-value";
    const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.automation-token";
    const signIn = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: token, user: { id: "user-uuid-1234" } },
        user: { id: "user-uuid-1234" },
      },
      error: null,
    });
    const { authenticateMyStepTimeAutomationUser } = await loadAuth();
    const session = await authenticateMyStepTimeAutomationUser({ signIn });
    expect(session).toEqual({ accessToken: token, userId: "user-uuid-1234" });
    const logs = captureLogText();
    expect(logs).not.toContain("auto@example.com");
    expect(logs).not.toContain("secret-password-value");
    expect(logs).not.toContain(token);
    expect(logs).toMatch(/accessTokenPresent/);
    expect(logs).toMatch(/userIdPresent/);
  });
});
