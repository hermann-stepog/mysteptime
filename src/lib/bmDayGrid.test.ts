import { describe, expect, it } from "vitest";
import { computeDayCodes, dedupeDiasPorData, type DiaEvento } from "./bmDayGrid";

describe("calendário diário da folha de rosto do BM", () => {
  it("mantém somente o último desembarque de uma sequência de dias", () => {
    const dias: DiaEvento[] = [
      { data: "2026-08-01", evento: "Embarque" },
      { data: "2026-08-02", evento: "Embarque" },
      { data: "2026-08-02", evento: "Desembarque" },
      { data: "2026-08-03", evento: "Desembarque" },
    ];

    expect(Array.from(computeDayCodes(dias).entries())).toEqual([
      ["2026-08-01", "P"],
      ["2026-08-02", "E"],
      ["2026-08-03", "D"],
    ]);
  });

  it("remove o desembarque antecipado mesmo quando ele é o único evento daquele dia", () => {
    const dias: DiaEvento[] = [
      { data: "2026-08-06", evento: "Embarque" },
      { data: "2026-08-07", evento: "Desembarque" },
      { data: "2026-08-08", evento: "Desembarque" },
    ];

    expect(dedupeDiasPorData(dias)).toEqual([
      { data: "2026-08-06", evento: "Embarque" },
      { data: "2026-08-08", evento: "Desembarque" },
    ]);
  });
});