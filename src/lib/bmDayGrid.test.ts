import { describe, expect, it } from "vitest";
import { addDaysStr } from "./timesheetOffshore";
import {
  computeDayCodes,
  countDayQuantities,
  dedupeDiasPorData,
  filterDayGridByColaboradorIds,
  type ColaboradorDayGrid,
  type DiaEvento,
} from "./bmDayGrid";

// Recorte do BM BSP 25-1033, período 30/07/2026 a 31/08/2026 — Edinaldo: 1 P, vários E e 1 D.
function diasEdinaldo(): DiaEvento[] {
  const dias: DiaEvento[] = [{ data: "2026-07-30", evento: "Embarque" }];
  for (let i = 1; i <= 14; i += 1) {
    dias.push({ data: addDaysStr("2026-07-30", i), evento: "Embarque" });
  }
  dias.push({ data: addDaysStr("2026-07-30", 15), evento: "Desembarque" });
  return dias;
}

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

  it("Edinaldo: P + vários E + D → Dias Emb é a soma de P e E, não 1", () => {
    const codes = computeDayCodes(diasEdinaldo());
    const siglas = Array.from(codes.values());
    const quantidades = countDayQuantities(codes);

    expect(siglas[0]).toBe("P");
    expect(siglas.filter((code) => code === "E")).toHaveLength(14);
    expect(siglas.at(-1)).toBe("D");
    expect(quantidades.diasEmbarque).not.toBe(1);
    expect(quantidades.diasEmbarque).toBe(15);
    expect(quantidades.diasDobra).toBe(0);
  });

  it("não conta Desembarque (D) como dia embarcado", () => {
    const codes = computeDayCodes([
      { data: "2026-07-30", evento: "Embarque" },
      { data: "2026-07-31", evento: "Embarque" },
      { data: "2026-08-01", evento: "Desembarque" },
    ]);
    expect(countDayQuantities(codes).diasEmbarque).toBe(2);
  });

  it("restringe a grade aos colaboradores do BM, sem cabeças extras na mob/demob", () => {
    const grid: ColaboradorDayGrid[] = [
      { colaboradorId: "edinaldo", colaboradorNome: "Edinaldo", funcao: "Soldador", bsp: "25-1033", dias: [] },
      { colaboradorId: "outro", colaboradorNome: "Outro", funcao: "Pintor", bsp: "25-1033", dias: [] },
    ];
    expect(filterDayGridByColaboradorIds(grid, ["edinaldo", "evanio"])).toEqual([grid[0]]);
  });
});
