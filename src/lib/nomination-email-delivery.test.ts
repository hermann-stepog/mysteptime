import { describe, expect, it } from "vitest";
import { acceptedEmailResult, nominationCreationEmailKey } from "./nomination-email-delivery";

describe("nomination email delivery", () => {
  it("uses the same creation key on retry, with separate keys for separate requests", () => {
    expect(nominationCreationEmailKey("71ed4bec-2582-4e0d-8f9b-2eb2f77dc000")).toBe("nomination/71ed4bec-2582-4e0d-8f9b-2eb2f77dc000/solicitacao");
    expect(nominationCreationEmailKey("another-request")).not.toBe(nominationCreationEmailKey("71ed4bec-2582-4e0d-8f9b-2eb2f77dc000"));
  });
  it("reports acceptance only with the provider message id, not delivery", async () => {
    expect(await acceptedEmailResult(Response.json({ id: "message-123" }))).toEqual({ sent: true, id: "message-123" });
  });
  it("does not report success when the response lacks an id", async () => {
    await expect(acceptedEmailResult(Response.json({}))).rejects.toThrow("Não reenviar automaticamente");
  });
  it("preserves refusal status rather than reporting success", async () => {
    await expect(acceptedEmailResult(new Response("blocked", { status: 429 }))).rejects.toThrow("(429): blocked");
  });
});