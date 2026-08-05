import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseServerFetch } from "./supabase-server-fetch";

describe("supabaseServerFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("delega ao fetch nativo preservando URL e opções", async () => {
    const response = new Response("ok", { status: 200 });
    const nativeFetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", nativeFetch);

    await expect(
      supabaseServerFetch("https://example.com/data", { method: "POST", body: "x" }),
    ).resolves.toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith("https://example.com/data", {
      method: "POST",
      body: "x",
    });
  });

  it("não depende de módulos específicos de Node", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/lib/supabase/supabase-server-fetch.ts", "utf8");
    expect(source).not.toMatch(/undici|node:fs|dispatcher|Agent/);
  });
});
