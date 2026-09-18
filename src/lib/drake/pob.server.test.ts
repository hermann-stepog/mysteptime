import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(), dispose: vi.fn(), close: vi.fn(), open: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("./auth/environment-credentials-auth.server", () => ({
  EnvironmentCredentialsDrakeAuthProvider: class { authenticate = mocks.authenticate; },
}));
vi.mock("./http/create-drake-http-client.server", () => ({
  createDrakeHttpClientFromAuthenticatedSession: () => ({ post: mocks.post, dispose: mocks.dispose }),
}));
vi.mock("./signalr-session.server", () => ({ openDrakeSignalRSession: mocks.open }));

const result = { columns: ["Matricula", "Inicio Embarque", "Fim Embarque"].map(name => ({ name })), rows: [] };
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ authenticatedSession: {} });
  mocks.close.mockResolvedValue(undefined);
  mocks.dispose.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue({ connectionId: "test", close: mocks.close });
});

describe("consulta POB", () => {
  it("aguarda o evento correlacionado mesmo se chegar antes da resposta HTTP", async () => {
    let events: { executed: (event: unknown) => void };
    mocks.open.mockImplementation(async (_client, handlers) => {
      events = handlers;
      return { connectionId: "test", close: mocks.close };
    });
    mocks.post.mockImplementation(async (_url, { data }) => {
      events.executed({ executionRequestId: "another-request", result: null });
      events.executed({ executionRequestId: data.executionRequestId, result });
      return { status: () => 200, json: async () => ({ scheduled: true }) };
    });
    const { fetchTodayPob } = await import("./pob.server");
    expect((await fetchTodayPob()).total).toBe(0);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    const parameters = mocks.post.mock.calls[0][1].data.executionParameters;
    expect(parameters.find((p: { name: string }) => p.name === "@uop").value).toBe("");
  });

  it("compartilha a consulta concorrente e reutiliza o resultado recente", async () => {
    mocks.post.mockResolvedValue({ status: () => 200, json: async () => result });
    const { fetchTodayPob } = await import("./pob.server");
    const [first, second] = await Promise.all([fetchTodayPob(), fetchTodayPob()]);
    expect(first).toEqual(second);
    expect(await fetchTodayPob()).toEqual(first);
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("não armazena falha como zero e fecha a conexão", async () => {
    mocks.post.mockResolvedValueOnce({ status: () => 500 }).mockResolvedValueOnce({ status: () => 200, json: async () => result });
    const { fetchTodayPob } = await import("./pob.server");
    await expect(fetchTodayPob()).rejects.toThrow();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect((await fetchTodayPob()).total).toBe(0);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
