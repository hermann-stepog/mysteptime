import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_AUTH_VALIDATION_FAILED,
  APP_SESSION_INVALID,
  AppAuthError,
  SUPABASE_TLS_ERROR,
  SUPABASE_UNAVAILABLE,
  classifySupabaseInfraError,
  decodeAppAuthMessage,
  encodeAppAuthError,
} from "./app-auth-errors";

const createClientMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

async function importAppAuth() {
  return import("./app-auth.server");
}

function makeError(props: Record<string, unknown>): Error {
  const err = new Error(String(props.message ?? "erro"));
  Object.assign(err, props);
  return err;
}

describe("resolveUserId", () => {
  const token = "jwt-token-super-secreto-abc123";

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.DRAKE_DEV_BYPASS_APP_AUTH;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createClientMock.mockReset();
    delete process.env.DRAKE_DEV_BYPASS_APP_AUTH;
  });

  it("retorna o ID quando getUser devolve usuário válido", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }),
      },
    };
    await expect(resolveUserId(client, token)).resolves.toBe("user-1");
  });

  it("gera APP_SESSION_INVALID quando user é null", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: APP_SESSION_INVALID,
    });
  });

  it("gera APP_SESSION_INVALID quando getUser retorna erro de JWT", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } }),
      },
    };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: APP_SESSION_INVALID,
    });
  });

  it("gera SUPABASE_TLS_ERROR para SELF_SIGNED_CERT_IN_CHAIN lançado", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: {
        getUser: vi
          .fn()
          .mockRejectedValue(
            makeError({ message: "fetch failed", code: "SELF_SIGNED_CERT_IN_CHAIN" }),
          ),
      },
    };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: SUPABASE_TLS_ERROR,
    });
  });

  it("detecta erro TLS aninhado em cause", async () => {
    const { resolveUserId } = await importAppAuth();
    const inner = makeError({
      message: "self-signed certificate in certificate chain",
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    const outer = makeError({ message: "fetch failed" });
    (outer as Error & { cause?: unknown }).cause = inner;
    const client = { auth: { getUser: vi.fn().mockRejectedValue(outer) } };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: SUPABASE_TLS_ERROR,
    });
  });

  it("gera SUPABASE_TLS_ERROR quando auth-js devolve o erro TLS em error (sem lançar)", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "self-signed certificate in certificate chain" },
        }),
      },
    };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: SUPABASE_TLS_ERROR,
    });
  });

  it("gera SUPABASE_UNAVAILABLE para fetch failed com ETIMEDOUT", async () => {
    const { resolveUserId } = await importAppAuth();
    const outer = makeError({ message: "fetch failed" });
    (outer as Error & { cause?: unknown }).cause = makeError({
      message: "connect ETIMEDOUT 1.2.3.4:443",
      code: "ETIMEDOUT",
    });
    const client = { auth: { getUser: vi.fn().mockRejectedValue(outer) } };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: SUPABASE_UNAVAILABLE,
    });
  });

  it("gera APP_AUTH_VALIDATION_FAILED para erro desconhecido", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: { getUser: vi.fn().mockRejectedValue(makeError({ message: "boom inesperado" })) },
    };
    await expect(resolveUserId(client, token)).rejects.toMatchObject({
      code: APP_AUTH_VALIDATION_FAILED,
    });
  });

  it("nunca converte erro do Supabase em DRAKE_SESSION_EXPIRED nem menciona Drake", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: {
        getUser: vi
          .fn()
          .mockRejectedValue(
            makeError({ message: "fetch failed", code: "SELF_SIGNED_CERT_IN_CHAIN" }),
          ),
      },
    };
    const thrown = await resolveUserId(client, token).catch((e: AppAuthError) => e);
    expect(thrown).toMatchObject({ name: "AppAuthError", code: SUPABASE_TLS_ERROR });
    expect((thrown as AppAuthError).code).not.toBe("DRAKE_SESSION_EXPIRED");
    expect((thrown as AppAuthError).message.toLowerCase()).not.toContain("drake");
  });

  it("não registra o access token nem stack nos logs", async () => {
    const { resolveUserId } = await importAppAuth();
    const client = {
      auth: {
        getUser: vi
          .fn()
          .mockRejectedValue(
            makeError({ message: `token ${token}`, code: "SELF_SIGNED_CERT_IN_CHAIN" }),
          ),
      },
    };
    await resolveUserId(client, token).catch(() => undefined);
    const logged = [
      ...(console.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .map(String)
      .join("\n");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("at ");
  });
});

describe("authenticateAppRequest", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    delete process.env.DRAKE_DEV_BYPASS_APP_AUTH;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createClientMock.mockReset();
    delete process.env.DRAKE_DEV_BYPASS_APP_AUTH;
  });

  it("não toca nas tabelas (Drake) quando resolveUserId falha e serializa o código", async () => {
    const fromMock = vi.fn();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockRejectedValue(
            makeError({ message: "fetch failed", code: "SELF_SIGNED_CERT_IN_CHAIN" }),
          ),
      },
      from: fromMock,
    });

    const { authenticateAppRequest } = await importAppAuth();
    const thrown = await authenticateAppRequest("token").catch((e: Error) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/^SUPABASE_TLS_ERROR: /);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("valida usuário e permissão com uma única chamada a getUser", async () => {
    const getUserMock = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { role: "logistics_operator" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    createClientMock.mockReturnValue({
      auth: { getUser: getUserMock },
      from: vi.fn().mockReturnValue({ select }),
    });

    const { authenticateAppRequest } = await importAppAuth();
    const result = await authenticateAppRequest("token");
    expect(result.userId).toBe("user-1");
    expect(getUserMock).toHaveBeenCalledTimes(1);
  });
});

describe("classifySupabaseInfraError / encode / decode", () => {
  it("classifica todos os códigos TLS listados", () => {
    for (const code of [
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "CERT_HAS_EXPIRED",
    ]) {
      expect(classifySupabaseInfraError(makeError({ message: "x", code }))).toBe(
        SUPABASE_TLS_ERROR,
      );
    }
    expect(classifySupabaseInfraError(new Error("self-signed certificate"))).toBe(
      SUPABASE_TLS_ERROR,
    );
  });

  it("classifica indisponibilidade de rede", () => {
    for (const msg of ["fetch failed", "ECONNREFUSED", "ENOTFOUND", "ECONNRESET"]) {
      expect(classifySupabaseInfraError(new Error(msg))).toBe(SUPABASE_UNAVAILABLE);
    }
  });

  it("retorna null para erros que não são de infraestrutura", () => {
    expect(classifySupabaseInfraError(new Error("invalid JWT"))).toBeNull();
    expect(classifySupabaseInfraError(null)).toBeNull();
  });

  it("encode/decode preserva o código e a mensagem amigável", () => {
    const encoded = encodeAppAuthError(new AppAuthError(SUPABASE_TLS_ERROR));
    const decoded = decodeAppAuthMessage(encoded);
    expect(decoded.code).toBe(SUPABASE_TLS_ERROR);
    expect(decoded.message).toBe("Não foi possível validar sua sessão no aplicativo.");
  });

  it("decode devolve a mensagem original quando não há código conhecido", () => {
    const decoded = decodeAppAuthMessage("Sem permissão para atualizar dados do Drake.");
    expect(decoded.code).toBeNull();
    expect(decoded.message).toBe("Sem permissão para atualizar dados do Drake.");
  });
});

describe("DRAKE_DEV_BYPASS_APP_AUTH", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createClientMock.mockReset();
    delete process.env.DRAKE_DEV_BYPASS_APP_AUTH;
    delete process.env.NODE_ENV;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("bypass funciona somente em desenvolvimento e nao chama getUser", async () => {
    process.env.NODE_ENV = "development";
    process.env.DRAKE_DEV_BYPASS_APP_AUTH = "true";
    process.env.DRAKE_DEV_TRIGGERED_BY = "local-development";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const getUserMock = vi.fn();
    createClientMock.mockReturnValue({
      auth: { getUser: getUserMock },
      from: vi.fn(),
    });

    const { authenticateAppRequest, resolveUserId } = await importAppAuth();
    const auth = await authenticateAppRequest("qualquer-token");
    expect(auth.userId).toBe("local-development");
    expect(auth.developmentBypass).toBe(true);
    expect(auth.triggeredByLabel).toBe("local-development");
    expect(getUserMock).not.toHaveBeenCalled();

    const id = await resolveUserId({ auth: { getUser: getUserMock } }, "token");
    expect(id).toBe("local-development");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("bypass e ignorado em producao", async () => {
    process.env.NODE_ENV = "production";
    process.env.DRAKE_DEV_BYPASS_APP_AUTH = "true";

    const getUserMock = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: "user-prod" } }, error: null });
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { role: "logistics_operator" }, error: null });
    createClientMock.mockReturnValue({
      auth: { getUser: getUserMock },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
      }),
    });

    const { authenticateAppRequest, isDrakeDevBypassAppAuthActive } = await importAppAuth();
    expect(isDrakeDevBypassAppAuthActive()).toBe(false);
    const auth = await authenticateAppRequest("token");
    expect(auth.userId).toBe("user-prod");
    expect(auth.developmentBypass).toBe(false);
    expect(getUserMock).toHaveBeenCalled();
  });

  it("createUserClient injeta supabaseServerFetch", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DRAKE_DEV_BYPASS_APP_AUTH;
    createClientMock.mockReturnValue({ auth: { getUser: vi.fn() } });
    const { createUserClient } = await importAppAuth();
    createUserClient("token");
    expect(createClientMock).toHaveBeenCalled();
    const options = createClientMock.mock.calls[0]?.[2] as {
      global?: { fetch?: unknown };
    };
    expect(typeof options.global?.fetch).toBe("function");
  });
});
