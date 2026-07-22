import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseDispatcher } from "./supabase-server-fetch";

describe("createSupabaseDispatcher", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    tempDir = mkdtempSync(join(tmpdir(), "supabase-tls-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("mantém TLS estrito padrão (sem dispatcher) quando nada está configurado", () => {
    const dispatcher = createSupabaseDispatcher({ caCertPath: "", ignoreHttpsErrors: false });
    expect(dispatcher).toBeNull();
  });

  it("cria Agent com a CA corporativa quando SUPABASE_CA_CERT_PATH está configurado", () => {
    const caPath = join(tempDir, "corp-ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n");
    const dispatcher = createSupabaseDispatcher({ caCertPath: caPath, ignoreHttpsErrors: false });
    expect(dispatcher).toBeInstanceOf(Agent);
  });

  it("CA tem prioridade sobre o fallback quando ambos estão configurados", () => {
    const caPath = join(tempDir, "corp-ca.pem");
    writeFileSync(caPath, "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n");
    const dispatcher = createSupabaseDispatcher({ caCertPath: caPath, ignoreHttpsErrors: true });
    expect(dispatcher).toBeInstanceOf(Agent);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("cria Agent de fallback com aviso quando SUPABASE_IGNORE_HTTPS_ERRORS=true", () => {
    const dispatcher = createSupabaseDispatcher({ caCertPath: "", ignoreHttpsErrors: true });
    expect(dispatcher).toBeInstanceOf(Agent);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const warning = String((console.warn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(warning).not.toMatch(/token|cookie|authorization|senha|password/i);
  });

  it("não altera a validação TLS global do processo Node", () => {
    createSupabaseDispatcher({ caCertPath: "", ignoreHttpsErrors: true });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe("0");
  });
});
