import { describe, expect, it } from "vitest";
import { clienteDaUnidade } from "./clientes";

describe("clienteDaUnidade", () => {
  it.each([
    ["FORTE", "PRIO"], ["FRADE", "PRIO"], ["BRAVO", "PRIO"],
    ["SEPETIBA", "SBM"], ["FPMR - CIDADE DE MARICÁ", "SBM"],
    ["CDI - CIDADE ILHA BELA", "SBM"], ["FPPA - CIDADE DE PARATY", "SBM"],
    ["ALEXANDRE GUSMÃO", "SBM"], ["FPSA - CIDADE DE SAQUAREMA", "SBM"],
    ["TAMANDARÉ", "SBM"], ["CDAN - CIDADE ANCHIETA", "SBM"],
    ["ATLANTA", "Yinson"], ["ANNA NERY", "Yinson"], ["MARIA QUITÉRIA", "Yinson"],
    ["CVIT - CIDADE DE VITÓRIA", "BW"], ["CVIT CIDADE DE VITORIA", "BW"],
    ["MAGNA", "BW"], ["ESPÍRITO SANTO", "BW"],
    ["MSI - CIDADE DE VITÓRIA", "MSI"], ["MSI CIDADE DE VITORIA", "MSI"],
    ["PCH-1", "Perenco"], ["PCH-2", "Perenco"],
    ["CIDADE DE ITAJAÍ", "Altera"], ["PIONEIRO DE LIBRA", "Altera"],
  ])("identifica %s como %s", (unidade, cliente) => {
    expect(clienteDaUnidade(unidade)).toBe(cliente);
  });

  it("não inventa cliente para unidade sem vínculo", () => {
    expect(clienteDaUnidade("UNIDADE NOVA")).toBeNull();
  });
});
