import { describe, expect, it } from "vitest";
import {
  classifyClientSelectionBodyForTests,
  matchesConfiguredClient,
  normalizeClientLabel,
} from "./client-selection.server";

describe("client-selection", () => {
  it("tela com botao STEP e detectada como client-selection", () => {
    const r = classifyClientSelectionBodyForTests(
      "Selecione o ambiente\nSTEP\nOutra Empresa",
    );
    expect(r.isClientSelection).toBe(true);
    expect(r.hasStepButtonText).toBe(true);
  });

  it("card STEP nao e classificado como MFA", () => {
    const r = classifyClientSelectionBodyForTests(
      "Escolha o cliente\nSTEP\nContinue",
    );
    expect(r.isClientSelection).toBe(true);
    expect(r.isMfa).toBe(false);
  });

  it("comparacao ignora caixa e espacos", () => {
    expect(normalizeClientLabel(" STEP ")).toBe(normalizeClientLabel("STEP"));
    expect(matchesConfiguredClient(" Step ", "STEP")).toBe(true);
    expect(matchesConfiguredClient("step", "STEP")).toBe(true);
  });

  it("OTP explicito continua MFA e nao client-selection", () => {
    const r = classifyClientSelectionBodyForTests("Enter code\nWe sent a code");
    expect(r.isMfa).toBe(true);
    expect(r.isClientSelection).toBe(false);
  });

  it("erros e config de cliente existem no contrato", async () => {
    const fs = await import("node:fs/promises");
    const errors = await fs.readFile("src/lib/drake/auth/errors.ts", "utf8");
    const config = await fs.readFile("src/lib/drake/config.server.ts", "utf8");
    const client = await fs.readFile("src/lib/drake/auth/client-selection.server.ts", "utf8");
    const context = await fs.readFile("src/lib/drake/auth/context-selection.server.ts", "utf8");
    expect(errors).toMatch(/DRAKE_CLIENT_NOT_FOUND/);
    expect(errors).toMatch(/DRAKE_CLIENT_SELECTION_AMBIGUOUS/);
    expect(errors).toMatch(/DRAKE_CLIENT_SELECTION_FAILED/);
    expect(config).toMatch(/DRAKE_CLIENT_NAME/);
    expect(client).toMatch(/selectDrakeClient/);
    expect(client).toMatch(/getByRole\("button"/);
    expect(client).toMatch(/getByRole\("link"/);
    expect(client).not.toMatch(/page\.getByText\(["']STEP["']\)\.click\(\)/);
    expect(context).toMatch(/selectDrakeClient/);
    expect(context).toMatch(/clientSelectionFailedError|DRAKE_CLIENT_SELECTION_FAILED/);
  });

  it("client-selection tem prioridade sobre MFA na classificacao", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      "src/lib/drake/auth/interactive-challenge.server.ts",
      "utf8",
    );
    expect(src).toMatch(/client-selection/);
    expect(src).toMatch(/step === "client-selection"/);
  });

  it("logo\/elementos de baixa prioridade sao filtrados \(score < 40\)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/auth/client-selection.server.ts", "utf8");
    expect(src).toMatch(/score >= 40/);
    expect(src).toMatch(/isInNonInteractiveRegion/);
  });

  it("ambiguidade e ausencia geram erros controlados", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/drake/auth/client-selection.server.ts", "utf8");
    expect(src).toMatch(/DRAKE_CLIENT_SELECTION_AMBIGUOUS/);
    expect(src).toMatch(/DRAKE_CLIENT_NOT_FOUND|DRAKE_CLIENT_SELECTION_FAILED/);
    expect(src).toMatch(/pickUniqueClientCandidate|boxesOverlap/);
  });

  it("local e remoto reutilizam a mesma funcao", async () => {
    const fs = await import("node:fs/promises");
    const context = await fs.readFile(
      "src/lib/drake/auth/context-selection.server.ts",
      "utf8",
    );
    const local = await fs.readFile(
      "src/lib/drake/browser/local-drake-browser-runtime.server.ts",
      "utf8",
    );
    const remote = await fs.readFile(
      "src/lib/drake/browser/remote-drake-browser-runtime.server.ts",
      "utf8",
    );
    expect(context).toMatch(/selectDrakeClient/);
    expect(local).not.toMatch(/selectDrakeClient|DRAKE_CLIENT_NAME/);
    expect(remote).not.toMatch(/selectDrakeClient|DRAKE_CLIENT_NAME/);
  });

  it("importadores e scheduler nao foram alterados", async () => {
    const fs = await import("node:fs/promises");
    const importDrake = await fs.readFile("src/lib/histograma/import-drake.ts", "utf8");
    const scheduler = await fs.readFile("src/lib/drake/drake-scheduler.server.ts", "utf8");
    expect(importDrake).not.toMatch(/selectDrakeClient|DRAKE_CLIENT_NAME/);
    expect(scheduler).not.toMatch(/selectDrakeClient|DRAKE_CLIENT_NAME/);
  });
});
