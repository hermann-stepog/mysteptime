import { describe, expect, it } from "vitest";
import { normalizeUnidadeOperacional } from "./histogramaNovo";

describe("normalizeUnidadeOperacional — Vitória", () => {
  it("junta as grafias de MSI Vitória no nome oficial MSI", () => {
    for (const raw of ["MSI - Vitoria", "MSI - VITÓRIA", "MSI Vitoria", "MSI - Cidade de Vitória"]) {
      expect(normalizeUnidadeOperacional(raw)).toBe("MSI - CIDADE DE VITORIA");
    }
  });

  it("junta as grafias de CVIT no nome oficial CVIT", () => {
    for (const raw of ["Cidade de Vitoria", "CIDADE VITÓRIA", "CVIT - Cidade de Vitória"]) {
      expect(normalizeUnidadeOperacional(raw)).toBe("CVIT - CIDADE DE VITORIA");
    }
  });

  it("nunca mistura CVIT (BW) com MSI", () => {
    expect(normalizeUnidadeOperacional("CVIT - CIDADE DE VITORIA")).toBe("CVIT - CIDADE DE VITORIA");
    expect(normalizeUnidadeOperacional("MSI - CIDADE DE VITORIA")).toBe("MSI - CIDADE DE VITORIA");
  });
});
