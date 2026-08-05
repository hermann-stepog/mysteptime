import { describe, expect, it } from "vitest";
import {
  buildAnnualPositionSnapshot,
  mapAnnualPositionType,
  type AnnualPositionWorkerRow,
} from "./drake-snapshot";

function worker(positions: AnnualPositionWorkerRow["positions"]): AnnualPositionWorkerRow {
  return {
    drakeWorkerId: "8be8b75e-8ac6-4a93-a646-b3bb00313321",
    matricula: "900378",
    nome: "ADELMO MOREIRA LOPES",
    empresa: "STEP",
    funcao: "INSPETOR DE SOLDAGEM",
    funcaoOperacao: null,
    positions,
  };
}

describe("ficha anual de posição do Drake", () => {
  it("agrupa somente dias consecutivos com a mesma posição", () => {
    const snapshot = buildAnnualPositionSnapshot([
      worker([
        day("2026-04-01", "E", "EMBARQUE", "RAIA", "BSP 26-100"),
        day("2026-04-02", "E", "EMBARQUE", "RAIA", "BSP 26-100"),
        day("2026-04-03", "F", "FOLGA", null, null),
        day("2026-04-04", "F", "FOLGA", null, null),
      ]),
    ]);

    expect(snapshot.source).toBe("drake");
    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.periods).toHaveLength(2);
    expect(snapshot.periods[0]).toMatchObject({
      tipo: "E",
      dataInicio: "2026-04-01",
      dataFim: "2026-04-02",
      unidadeOperacional: "RAIA",
      centroDeCusto: "BSP 26-100",
      dias: 2,
    });
    expect(snapshot.periods[1]).toMatchObject({
      tipo: "F",
      dataInicio: "2026-04-03",
      dataFim: "2026-04-04",
      dias: 2,
    });
  });

  it("não mistura períodos quando unidade ou contrato mudam", () => {
    const snapshot = buildAnnualPositionSnapshot([
      worker([
        day("2026-05-01", "E", "EMBARQUE", "FORTE", "BSP A"),
        day("2026-05-02", "E", "EMBARQUE", "FORTE", "BSP B"),
      ]),
    ]);
    expect(snapshot.periods).toHaveLength(2);
  });

  it("traduz as ocorrências para os status já aceitos pela grade", () => {
    expect(mapAnnualPositionType("E", "EMBARQUE", null)).toBe("E");
    expect(mapAnnualPositionType("D", "DOBRA", null)).toBe("E");
    expect(mapAnnualPositionType("F", "FOLGA", null)).toBe("F");
    expect(mapAnnualPositionType("FE", "FÉRIAS", null)).toBe("FE");
    expect(mapAnnualPositionType("H", "HOTEL", null)).toBe("HTL");
    expect(mapAnnualPositionType("EC", "EMBARQUE CANCELADO", null)).toBe("CANC");
    expect(mapAnnualPositionType("EC", "EMPRESA EM CASA", null)).toBe("EC");
    expect(mapAnnualPositionType("DES", "DESEMBARQUE", null)).toBe("F");
    expect(mapAnnualPositionType("LM", "LICENÇA MÉDICA", null)).toBe("AT");
    expect(mapAnnualPositionType("TR", "TREINAMENTO", null)).toBe("STB");
  });
});

function day(
  date: string,
  occurrenceAcronym: string,
  occurrenceDescription: string,
  unidadeOperacional: string | null,
  centroDeCusto: string | null,
) {
  return {
    date,
    occurrenceAcronym,
    occurrenceDescription,
    occurrenceType: null,
    unidadeOperacional,
    centroDeCusto,
  };
}
