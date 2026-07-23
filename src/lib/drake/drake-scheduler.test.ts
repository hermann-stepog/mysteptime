import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRAKE_CRON_MIDNIGHT,
  DRAKE_CRON_NOON,
  DRAKE_SCHEDULER_TIMEZONE_DEFAULT,
  getDrakeSchedulerConfig,
} from "./scheduler-config.server";
import { getNextDrakeScheduleTimes } from "./scheduler-times.server";
import {
  DRAKE_UPDATE_ALREADY_RUNNING,
  MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
  MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
} from "./update-types";

describe("Drake scheduler crons", () => {
  it("cron da meia-noite é 0 0 * * *", () => {
    expect(DRAKE_CRON_MIDNIGHT).toBe("0 0 * * *");
    expect(getDrakeSchedulerConfig().cronMidnight).toBe("0 0 * * *");
  });

  it("cron das 12:30 é 30 12 * * *", () => {
    expect(DRAKE_CRON_NOON).toBe("30 12 * * *");
    expect(getDrakeSchedulerConfig().cronNoon).toBe("30 12 * * *");
  });

  it("timezone é America/Sao_Paulo", () => {
    expect(DRAKE_SCHEDULER_TIMEZONE_DEFAULT).toBe("America/Sao_Paulo");
    const prev = process.env.DRAKE_SCHEDULER_TIMEZONE;
    delete process.env.DRAKE_SCHEDULER_TIMEZONE;
    expect(getDrakeSchedulerConfig().timezone).toBe("America/Sao_Paulo");
    process.env.DRAKE_SCHEDULER_TIMEZONE = prev;
  });
});

describe("Drake scheduler registration", () => {
  afterEach(() => {
    delete process.env.DRAKE_SCHEDULER_ENABLED;
    const g = globalThis as { __drakeSchedulerStarted?: unknown };
    delete g.__drakeSchedulerStarted;
  });

  it("não registra quando desabilitado", async () => {
    process.env.DRAKE_SCHEDULER_ENABLED = "false";
    vi.resetModules();
    const { ensureDrakeSchedulerRegistered } = await import("./drake-scheduler.server");
    const status = ensureDrakeSchedulerRegistered();
    expect(status.enabled).toBe(false);
    expect(status.registered).toBe(false);
  });

  it("registra uma única vez", async () => {
    process.env.DRAKE_SCHEDULER_ENABLED = "true";
    process.env.DRAKE_SCHEDULER_TIMEZONE = "America/Sao_Paulo";
    vi.resetModules();
    const mod = await import("./drake-scheduler.server");
    const a = mod.ensureDrakeSchedulerRegistered();
    const b = mod.ensureDrakeSchedulerRegistered();
    expect(a.enabled).toBe(true);
    expect(b.enabled).toBe(true);
    expect(a.timezone).toBe("America/Sao_Paulo");
  });
});

describe("runDrakeUpdate / runScheduledDrakeUpdate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("./update-service.server");
    vi.doUnmock("./mysteptime-automation-auth.server");
    vi.doUnmock("@/lib/supabase/app-auth.server");
  });

  it("execução scheduled e manual chamam o mesmo updateDrakeData", async () => {
    vi.resetModules();
    const updateDrakeData = vi.fn().mockResolvedValue({
      embarkationEvents: 1,
      availabilityEvents: 2,
    });
    vi.doMock("./update-service.server", () => ({ updateDrakeData }));
    const { runDrakeUpdate } = await import("./run-drake-update.server");
    const { releaseDrakeUpdateLock } = await import("./update-lock.server");
    releaseDrakeUpdateLock();
    const db = {} as never;
    await runDrakeUpdate({ trigger: "manual", db, acquireLock: true });
    await runDrakeUpdate({ trigger: "scheduled-noon", db, acquireLock: true });
    expect(updateDrakeData).toHaveBeenCalledTimes(2);
  });

  it("runScheduledDrakeUpdate autentica no MyStepTime e entrega cliente via createUserClient", async () => {
    vi.resetModules();
    const updateDrakeData = vi.fn().mockResolvedValue({ embarkationEvents: 3 });
    const authenticate = vi.fn().mockResolvedValue({
      accessToken: "automation-access-token",
      userId: "user-1",
    });
    const createUserClient = vi.fn().mockReturnValue({ from: vi.fn() });
    vi.doMock("./update-service.server", () => ({ updateDrakeData }));
    vi.doMock("./mysteptime-automation-auth.server", () => ({
      authenticateMyStepTimeAutomationUser: authenticate,
      discardMyStepTimeAutomationAuthContext: vi.fn(),
    }));
    vi.doMock("@/lib/supabase/app-auth.server", () => ({ createUserClient }));
    const { runScheduledDrakeUpdate } = await import("./run-drake-update.server");
    const { releaseDrakeUpdateLock, isDrakeUpdateLocked } = await import("./update-lock.server");
    releaseDrakeUpdateLock();

    const outcome = await runScheduledDrakeUpdate("scheduled-test");
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(createUserClient).toHaveBeenCalledWith("automation-access-token");
    expect(updateDrakeData).toHaveBeenCalledTimes(1);
    expect(outcome.result.embarkationEvents).toBe(3);
    expect(isDrakeUpdateLocked()).toBe(false);
  });

  it("credenciais ausentes falham antes do Drake e liberam lock", async () => {
    vi.resetModules();
    const updateDrakeData = vi.fn();
    vi.doMock("./update-service.server", () => ({ updateDrakeData }));
    vi.doMock("./mysteptime-automation-auth.server", () => ({
      authenticateMyStepTimeAutomationUser: vi.fn().mockRejectedValue({
        code: MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
        message: "As credenciais da conta de automação do MyStepTime não estão configuradas.",
      }),
      discardMyStepTimeAutomationAuthContext: vi.fn(),
    }));
    const { runScheduledDrakeUpdate } = await import("./run-drake-update.server");
    const { releaseDrakeUpdateLock, isDrakeUpdateLocked } = await import("./update-lock.server");
    releaseDrakeUpdateLock();
    await expect(runScheduledDrakeUpdate("scheduled-test")).rejects.toMatchObject({
      code: MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
    });
    expect(updateDrakeData).not.toHaveBeenCalled();
    expect(isDrakeUpdateLocked()).toBe(false);
  });

  it("falha de login libera o lock", async () => {
    vi.resetModules();
    const updateDrakeData = vi.fn();
    vi.doMock("./update-service.server", () => ({ updateDrakeData }));
    vi.doMock("./mysteptime-automation-auth.server", () => ({
      authenticateMyStepTimeAutomationUser: vi.fn().mockRejectedValue({
        code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
        message: "Não foi possível entrar no MyStepTime com a conta de automação.",
      }),
      discardMyStepTimeAutomationAuthContext: vi.fn(),
    }));
    const { runScheduledDrakeUpdate } = await import("./run-drake-update.server");
    const { releaseDrakeUpdateLock, isDrakeUpdateLocked } = await import("./update-lock.server");
    releaseDrakeUpdateLock();
    await expect(runScheduledDrakeUpdate("scheduled-noon")).rejects.toMatchObject({
      code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
    });
    expect(isDrakeUpdateLocked()).toBe(false);
  });

  it("lock ocupado impede login desnecessário", async () => {
    vi.resetModules();
    const authenticate = vi.fn();
    const updateDrakeData = vi.fn();
    vi.doMock("./update-service.server", () => ({ updateDrakeData }));
    vi.doMock("./mysteptime-automation-auth.server", () => ({
      authenticateMyStepTimeAutomationUser: authenticate,
      discardMyStepTimeAutomationAuthContext: vi.fn(),
    }));
    const { runScheduledDrakeUpdate } = await import("./run-drake-update.server");
    const { tryAcquireDrakeUpdateLock, releaseDrakeUpdateLock } =
      await import("./update-lock.server");
    releaseDrakeUpdateLock();
    expect(tryAcquireDrakeUpdateLock()).toBe(true);
    await expect(runScheduledDrakeUpdate("scheduled-midnight")).rejects.toMatchObject({
      code: DRAKE_UPDATE_ALREADY_RUNNING,
    });
    expect(authenticate).not.toHaveBeenCalled();
    expect(updateDrakeData).not.toHaveBeenCalled();
    releaseDrakeUpdateLock();
  });

  it("falha posterior libera o lock", async () => {
    vi.resetModules();
    vi.doMock("./update-service.server", () => ({
      updateDrakeData: vi.fn().mockRejectedValue(new Error("boom")),
    }));
    vi.doMock("./mysteptime-automation-auth.server", () => ({
      authenticateMyStepTimeAutomationUser: vi.fn().mockResolvedValue({
        accessToken: "tok",
        userId: "u1",
      }),
      discardMyStepTimeAutomationAuthContext: vi.fn(),
    }));
    vi.doMock("@/lib/supabase/app-auth.server", () => ({
      createUserClient: vi.fn().mockReturnValue({}),
    }));
    const { runScheduledDrakeUpdate } = await import("./run-drake-update.server");
    const { releaseDrakeUpdateLock, isDrakeUpdateLocked } = await import("./update-lock.server");
    releaseDrakeUpdateLock();
    await expect(runScheduledDrakeUpdate("scheduled-test")).rejects.toThrow("boom");
    expect(isDrakeUpdateLocked()).toBe(false);
  });

  it("lock manual e automático é compartilhado", async () => {
    vi.resetModules();
    vi.doMock("./update-service.server", () => ({
      updateDrakeData: vi.fn().mockResolvedValue({}),
    }));
    const { runDrakeUpdate } = await import("./run-drake-update.server");
    const {
      tryAcquireDrakeUpdateLock,
      releaseDrakeUpdateLock,
      isDrakeUpdateLocked,
    } = await import("./update-lock.server");
    releaseDrakeUpdateLock();
    expect(tryAcquireDrakeUpdateLock()).toBe(true);
    await expect(
      runDrakeUpdate({ trigger: "scheduled-noon", db: {} as never, acquireLock: true }),
    ).rejects.toMatchObject({ code: DRAKE_UPDATE_ALREADY_RUNNING });
    releaseDrakeUpdateLock();

    expect(tryAcquireDrakeUpdateLock()).toBe(true);
    expect(isDrakeUpdateLocked()).toBe(true);
    await expect(
      runDrakeUpdate({ trigger: "manual", db: {} as never, acquireLock: true }),
    ).rejects.toMatchObject({ code: DRAKE_UPDATE_ALREADY_RUNNING });
    releaseDrakeUpdateLock();
  });
});

describe("scheduler boundaries", () => {
  it("scheduler usa runScheduledDrakeUpdate sem HTTP/service-role", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/drake-scheduler.server.ts", "utf8");
    expect(src).toMatch(/runScheduledDrakeUpdate/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/createDrakeScheduledSupabaseClient/);
    expect(src).not.toMatch(/DRAKE_SCHEDULED_SUPABASE_CREDENTIALS_MISSING/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/from ["']react["']/);
    expect(src).not.toMatch(/localStorage|setInterval/);
    expect(src).not.toMatch(/playwright|chromium|Browser/);
    await expect(
      fs.access("src/routes/api/internal/drake/scheduled-update.ts"),
    ).rejects.toBeTruthy();
  });

  it("orquestrador agendado autentica no MyStepTime e reutiliza createUserClient", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/run-drake-update.server.ts", "utf8");
    expect(src).toMatch(/authenticateMyStepTimeAutomationUser/);
    expect(src).toMatch(/createUserClient/);
    expect(src).toMatch(/export async function runDrakeUpdate/);
    expect(src).toMatch(/export async function runScheduledDrakeUpdate/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/authenticateSupabaseAutomationUser/);
    expect(src).not.toMatch(/SUPABASE_AUTOMATION_/);
  });

  it("rota manual valida usuário na borda e reutiliza runDrakeUpdate", async () => {
    const fs = await import("node:fs/promises");
    const manual = await fs.readFile("src/routes/api/integrations/drake/update.ts", "utf8");
    expect(manual).toMatch(/authenticateAppRequest/);
    expect(manual).toMatch(/runDrakeUpdate/);
    expect(manual).not.toMatch(/MYSTEPTIME_AUTOMATION_EMAIL/);
    expect(manual).not.toMatch(/MYSTEPTIME_AUTOMATION_PASSWORD/);
    expect(manual).not.toMatch(/authenticateMyStepTimeAutomationUser/);
  });

  it("run-now usa a conta automática do MyStepTime", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("scripts/drake-scheduler-run-now.ts", "utf8");
    expect(src).toMatch(/runScheduledDrakeUpdate/);
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/fetch\(/);
  });

  it("credenciais de automação não aparecem no frontend", async () => {
    const fs = await import("node:fs/promises");
    const card = await fs.readFile("src/components/histograma/DrakeUpdateCard.tsx", "utf8");
    expect(card).not.toContain("MYSTEPTIME_AUTOMATION_EMAIL");
    expect(card).not.toContain("MYSTEPTIME_AUTOMATION_PASSWORD");
    expect(card).not.toContain("SUPABASE_AUTOMATION_EMAIL");
    expect(card).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(card).not.toContain("authenticateMyStepTimeAutomationUser");
  });

  it("bootstrap do scheduler ocorre só no boot do servidor", async () => {
    const fs = await import("node:fs/promises");
    const serverSrc = await fs.readFile("src/server.ts", "utf8");
    const matches = serverSrc.match(/bootstrapDrakeSchedulerOnce/g) ?? [];
    expect(matches.length).toBe(2);
    const fetchBlock = serverSrc.slice(
      serverSrc.indexOf("async fetch"),
      serverSrc.indexOf("};", serverSrc.indexOf("async fetch")) + 2,
    );
    expect(fetchBlock).not.toMatch(/bootstrapDrakeSchedulerOnce/);
  });

  it("nenhuma tabela de job é criada", async () => {
    const fs = await import("node:fs/promises");
    for (const file of [
      "src/lib/drake/drake-scheduler.server.ts",
      "src/lib/drake/run-drake-update.server.ts",
      "src/lib/drake/mysteptime-automation-auth.server.ts",
      "src/lib/drake/scheduler-config.server.ts",
    ]) {
      const src = await fs.readFile(file, "utf8");
      expect(src).not.toContain("drake_data_updates");
      expect(src).not.toContain("create table");
    }
  });

  it("token não é persistido em last-error / filesystem helpers", async () => {
    const fs = await import("node:fs/promises");
    const auth = await fs.readFile("src/lib/drake/mysteptime-automation-auth.server.ts", "utf8");
    expect(auth).not.toMatch(/writeFile|localStorage|storage-state|last-error/);
    expect(auth).not.toMatch(/refresh_token|refreshToken/);
  });

  it("próximas ocorrências ficam no futuro", () => {
    const now = new Date("2026-07-20T16:00:00.000Z");
    const times = getNextDrakeScheduleTimes(now, "America/Sao_Paulo");
    expect(times.cronMidnight).toBe("0 0 * * *");
    expect(times.cronNoon).toBe("30 12 * * *");
    expect(Date.parse(times.nextMidnight)).toBeGreaterThan(now.getTime());
    expect(Date.parse(times.nextNoon)).toBeGreaterThan(now.getTime());
  });
});
