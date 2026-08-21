import { describe, expect, it } from "vitest";
import { buildWorkerKey, type EmbarkationSourceRow } from "@/lib/histograma/drake-snapshot";
import {
  buildEmbarkationReportIndex,
  resolveEmbarkationReportRow,
  sanitizeDrakeBsp,
} from "./annual-position-embarkation";

function reportRow(patch: Partial<EmbarkationSourceRow> = {}): EmbarkationSourceRow {
  return {
    matricula: "100",
    nome: "COLABORADOR",
    empresa: "STEP",
    funcao: null,
    funcao_operacao: null,
    unidade_operacional: "PARATY",
    centro_de_custo: "BSP 26-001",
    data_inicio: "2026-08-01",
    data_fim: "2026-08-14",
    dias: 14,
    ...patch,
  };
}

describe("BSP do relatório oficial de embarque Drake", () => {
  it("resolve o BSP pela identidade, data e unidade da Ficha Anual", () => {
    const expected = reportRow();
    const index = buildEmbarkationReportIndex([
      expected,
      reportRow({ unidade_operacional: "ILHA BELA", centro_de_custo: "BSP 26-002" }),
    ]);

    expect(
      resolveEmbarkationReportRow(index, buildWorkerKey("STEP", "100"), "2026-08-05", "PARATY"),
    ).toBe(expected);
  });

  it("preserva BSP vazio quando ele está vazio no próprio relatório Drake", () => {
    const expected = reportRow({ centro_de_custo: null });
    const index = buildEmbarkationReportIndex([expected]);

    expect(
      resolveEmbarkationReportRow(index, buildWorkerKey("STEP", "100"), "2026-08-05", "PARATY")
        .centro_de_custo,
    ).toBeNull();
  });

  it("descarta BSP que é apenas o nome da própria unidade copiado no Drake", () => {
    expect(sanitizeDrakeBsp("  fpsa - cidade de saquarema ", "SAQUAREMA")).toBeNull();
    expect(sanitizeDrakeBsp("PARATY", "PARATY")).toBeNull();
    expect(sanitizeDrakeBsp("BSP 26-001", "PARATY")).toBe("BSP 26-001");
  });

  it("interrompe diante de BSPs conflitantes para o mesmo dia", () => {
    const index = buildEmbarkationReportIndex([
      reportRow(),
      reportRow({ centro_de_custo: "BSP 26-999" }),
    ]);

    expect(() =>
      resolveEmbarkationReportRow(index, buildWorkerKey("STEP", "100"), "2026-08-05", "PARATY"),
    ).toThrow(/conflitantes/i);
  });
});
