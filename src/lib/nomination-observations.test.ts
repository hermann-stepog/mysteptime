import { describe, expect, it } from "vitest";
import { ALL_STATUSES } from "./nominations";
import { canEditNominationObservations, nominationObservationsSchema } from "./nomination-observations";

describe("Observações das Nomeações", () => {
  it("permite ao solicitante editar em qualquer etapa", () => {
    for (const _stage of ALL_STATUSES) {
      expect(canEditNominationObservations("solicitante", "solicitante", "pm")).toBe(true);
    }
  });
  it("permite à administração editar solicitações de outras pessoas", () => {
    expect(canEditNominationObservations("admin", "solicitante", "administrador")).toBe(true);
    expect(canEditNominationObservations("diretor", "solicitante", "diretoria")).toBe(true);
    expect(canEditNominationObservations("logistica", "solicitante", "logistics_operator")).toBe(true);
  });
  it("não permite edição a outros solicitantes, papéis de etapa ou visitantes", () => {
    for (const role of ["pm", "sms", "rh", "qualidade", "visitante", "pending"]) {
      expect(canEditNominationObservations("outro", "solicitante", role)).toBe(false);
    }
    expect(canEditNominationObservations(null, null, "administrador")).toBe(false);
  });
  it("valida identificação e tamanho e mantém texto como texto", () => {
    const nominationId = "71ed4bec-2582-4e0d-8f9b-2eb2f77dc000";
    expect(nominationObservationsSchema.parse({ nominationId, notes: "  Serviço a bordo  " }).notes).toBe("Serviço a bordo");
    expect(nominationObservationsSchema.safeParse({ nominationId: "inválido", notes: "Serviço" }).success).toBe(false);
    expect(nominationObservationsSchema.safeParse({ nominationId, notes: "a".repeat(10001) }).success).toBe(false);
  });
});