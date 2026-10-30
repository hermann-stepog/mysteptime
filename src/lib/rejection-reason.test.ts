import { describe, expect, it } from "vitest";
import { validateRejectionReason } from "./rejection-reason";

describe("motivo de reprovação", () => {
  it("é obrigatório", () => {
    expect(validateRejectionReason("   ")).not.toBeNull();
  });
  it("aceita até 4 palavras", () => {
    expect(validateRejectionReason("ASO vencido sem renovação")).toBeNull();
  });
  it("recusa 5 palavras", () => {
    expect(validateRejectionReason("ASO vencido sem renovação ainda")).not.toBeNull();
  });
});
