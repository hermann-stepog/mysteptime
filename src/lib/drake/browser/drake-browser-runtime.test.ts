import { afterEach, describe, expect, it, vi } from "vitest";

describe("Drake browser runtime factory", () => {
  afterEach(() => {
    delete process.env.DRAKE_BROWSER_MODE;
    delete process.env.DRAKE_REMOTE_BROWSER_ENDPOINT;
    delete process.env.DRAKE_REMOTE_BROWSER_TOKEN;
    vi.resetModules();
  });

  it("DRAKE_BROWSER_MODE=local seleciona adaptador local", async () => {
    process.env.DRAKE_BROWSER_MODE = "local";
    const { createDrakeBrowserRuntime } = await import("./create-drake-browser-runtime.server");
    const runtime = createDrakeBrowserRuntime();
    expect(runtime.mode).toBe("local");
  });

  it("DRAKE_BROWSER_MODE=remote seleciona adaptador remoto", async () => {
    process.env.DRAKE_BROWSER_MODE = "remote";
    const { createDrakeBrowserRuntime } = await import("./create-drake-browser-runtime.server");
    const runtime = createDrakeBrowserRuntime();
    expect(runtime.mode).toBe("remote");
  });

  it("modo inválido gera DRAKE_BROWSER_MODE_INVALID", async () => {
    process.env.DRAKE_BROWSER_MODE = "weird";
    const { resolveDrakeBrowserMode } = await import("./browser-mode.server");
    expect(() => resolveDrakeBrowserMode()).toThrow();
    try {
      resolveDrakeBrowserMode();
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "DRAKE_BROWSER_MODE_INVALID" });
    }
  });

  it("remoto sem endpoint gera DRAKE_REMOTE_BROWSER_NOT_CONFIGURED", async () => {
    process.env.DRAKE_BROWSER_MODE = "remote";
    delete process.env.DRAKE_REMOTE_BROWSER_ENDPOINT;
    const { buildRemoteBrowserEndpoint } = await import("./browser-mode.server");
    expect(() => buildRemoteBrowserEndpoint()).toThrow();
    try {
      buildRemoteBrowserEndpoint();
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: "DRAKE_REMOTE_BROWSER_NOT_CONFIGURED" });
    }
  });

  it("token remoto não aparece nos logs ao montar endpoint", async () => {
    process.env.DRAKE_REMOTE_BROWSER_ENDPOINT = "wss://browser.example/cdp";
    process.env.DRAKE_REMOTE_BROWSER_TOKEN = "super-secret-token-value";
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args);
    });
    const { buildRemoteBrowserEndpoint } = await import("./browser-mode.server");
    const endpoint = buildRemoteBrowserEndpoint();
    expect(endpoint).toContain("token=");
    expect(JSON.stringify(logs)).not.toContain("super-secret-token-value");
    spy.mockRestore();
  });

  it("import de Playwright nos adaptadores é dinâmico", async () => {
    const fs = await import("node:fs/promises");
    const local = await fs.readFile(
      "src/lib/drake/browser/local-drake-browser-runtime.server.ts",
      "utf8",
    );
    const remote = await fs.readFile(
      "src/lib/drake/browser/remote-drake-browser-runtime.server.ts",
      "utf8",
    );
    expect(local).toMatch(/await import\(/);
    expect(local).not.toMatch(/^import \{[^}]*chromium[^}]*\} from ["']playwright["']/m);
    expect(remote).toMatch(/await import\(/);
    expect(remote).toMatch(/connectOverCDP/);
    expect(remote).not.toMatch(/chromium\.launch\s*\(/);
  });

  it("módulos HTTP/client não importam Playwright", async () => {
    const fs = await import("node:fs/promises");
    for (const file of [
      "src/lib/drake/http/create-drake-http-client.server.ts",
      "src/lib/drake/drake-http.server.ts",
      "src/lib/drake/api-session.server.ts",
      "src/lib/drake/report-api-runner.server.ts",
      "src/lib/drake/api-download.server.ts",
      "src/lib/drake/signalr-session.server.ts",
      "src/components/histograma/DrakeUpdateCard.tsx",
    ]) {
      const src = await fs.readFile(file, "utf8");
      expect(src).not.toMatch(/from ["']playwright["']/);
      expect(src).not.toMatch(/from ["']playwright-core["']/);
    }
  });

  it("auth provider não importa Playwright estaticamente", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      "src/lib/drake/auth/environment-credentials-auth.server.ts",
      "utf8",
    );
    expect(src).not.toMatch(/from ["']playwright["']/);
    expect(src).toMatch(/createDrakeHttpClientFromStorageState|createApiContextFromState/);
  });

  it("scheduler não foi alterado por esta tarefa de browser", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/drake-scheduler.server.ts", "utf8");
    expect(src).toMatch(/runScheduledDrakeUpdate|ensureDrakeSchedulerRegistered/);
    expect(src).not.toMatch(/createDrakeBrowserRuntime|connectOverCDP|DRAKE_BROWSER_MODE/);
  });

  it("card continua apontando para a rota de update", async () => {
    const fs = await import("node:fs/promises");
    const card = await fs.readFile("src/components/histograma/DrakeUpdateCard.tsx", "utf8");
    expect(card).toMatch(/\/api\/integrations\/drake\/update/);
    expect(card).not.toMatch(/playwright/);
  });
});
