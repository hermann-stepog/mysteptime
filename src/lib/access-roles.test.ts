import { describe, expect, it } from "vitest";
import { FULL_NOMINATIONS_ACCESS_ROLES, hasOperatorAccess, hasSystemAdminAccess } from "./access-roles";

describe("Diretoria full-system access", () => {
  it("grants Diretoria administrator, operational and every nomination-stage capability", () => {
    expect(hasSystemAdminAccess("diretoria")).toBe(true);
    expect(hasOperatorAccess("diretoria")).toBe(true);
    expect(FULL_NOMINATIONS_ACCESS_ROLES).toContain("diretoria");
  });

  it("preserves other roles without elevating visitors or stage-specific users", () => {
    expect(hasSystemAdminAccess("administrador")).toBe(true);
    expect(hasOperatorAccess("logistics_operator")).toBe(true);
    expect(hasSystemAdminAccess("logistics_operator")).toBe(false);
    for (const role of ["visitante", "pm", "rh", "sms", "qualidade", "aprovacao_tecnica", "medicao", "orcamentos_projetos", "adm_master", "pending", null, undefined]) {
      expect(hasSystemAdminAccess(role)).toBe(false);
      expect(hasOperatorAccess(role)).toBe(false);
    }
  });
});