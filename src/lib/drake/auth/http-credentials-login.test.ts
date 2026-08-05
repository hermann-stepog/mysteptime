import { describe, expect, it, vi } from "vitest";
import type { DrakeHttpClient, DrakeHttpResponse } from "../http/drake-http-client.types.server";
import { selectConfiguredTenant } from "./http-credentials-login.server";

function response(status: number, json: unknown = null): DrakeHttpResponse {
  const text = JSON.stringify(json);
  return {
    status: () => status,
    statusText: () => "",
    headers: () => ({ "content-type": "application/json" }),
    url: () => "https://drake.bz/api/v2/User/Tenants",
    text: async () => text,
    json: async () => json,
    body: async () => Buffer.from(text),
  };
}

function apiWithStatuses(listStatuses: number[], selectionStatuses: number[]): DrakeHttpClient {
  let listIndex = 0;
  let selectionIndex = 0;
  return {
    get: vi.fn(async () =>
      response(listStatuses[listIndex++] ?? 200, [{ id: "tenant-step", text: "STEP" }]),
    ),
    post: vi.fn(async () => response(selectionStatuses[selectionIndex++] ?? 200)),
    fetch: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("seleção do ambiente Drake", () => {
  it("repete a listagem após uma resposta transitória", async () => {
    const api = apiWithStatuses([503, 200], [200]);

    await selectConfiguredTenant(api, {
      expectedContextName: "STEP",
      retryDelaysMs: [0, 0],
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("repete a seleção e aceita qualquer resposta 2xx", async () => {
    const api = apiWithStatuses([200], [503, 204]);

    await selectConfiguredTenant(api, {
      expectedContextName: "STEP",
      retryDelaysMs: [0, 0],
    });

    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("não repete erro definitivo do Drake", async () => {
    const api = apiWithStatuses([400], []);

    await expect(
      selectConfiguredTenant(api, {
        expectedContextName: "STEP",
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toMatchObject({ code: "DRAKE_CLIENT_SELECTION_FAILED" });

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });
});
