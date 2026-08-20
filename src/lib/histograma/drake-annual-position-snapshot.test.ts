import { describe, expect, it } from "vitest";
import {
  buildAnnualPositionSnapshot,
  buildDrakeTimesheetPlans,
  catalogAnnualPositionOccurrences,
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

  it("remove P de hoje e do passado, mantendo somente programação futura", () => {
    const snapshot = buildAnnualPositionSnapshot(
      [
        worker([
          day("2026-08-18", "P", "PROGRAMADO", "RAIA", "BSP A"),
          day("2026-08-19", "P", "PROGRAMADO", "RAIA", "BSP A"),
          day("2026-08-20", "P", "PROGRAMADO", "RAIA", "BSP A"),
        ]),
      ],
      { asOfDate: "2026-08-19" },
    );

    expect(snapshot.periods).toHaveLength(1);
    expect(snapshot.periods[0]).toMatchObject({
      tipo: "P",
      dataInicio: "2026-08-20",
      dataFim: "2026-08-20",
    });
  });

  it("deriva o timesheet 1:1 dos dias E e D informados pelo Drake", () => {
    const snapshot = buildAnnualPositionSnapshot([
      worker([
        day("2026-04-01", "E", "EMBARQUE", "RAIA", "BSP 26-100"),
        day("2026-04-02", "D", "DOBRA", "RAIA", "BSP 26-100"),
        day("2026-04-03", "E", "EMBARQUE", "RAIA", "BSP 26-100"),
        day("2026-04-04", "F", "FOLGA", null, null),
      ]),
    ]);

    const plans = buildDrakeTimesheetPlans(snapshot);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      dataInicio: "2026-04-01",
      dataFim: "2026-04-03",
      unidadeOperacional: "RAIA",
      centroDeCusto: "BSP 26-100",
      days: [
        { data: "2026-04-01", evento: "Embarque", bsp: "BSP 26-100" },
        { data: "2026-04-02", evento: "Dobra", bsp: "BSP 26-100" },
        { data: "2026-04-03", evento: "Embarque", bsp: "BSP 26-100" },
      ],
    });
  });

  it("consolida UUIDs duplicados da mesma empresa e matrícula sem duplicar períodos", () => {
    const positions = [
      day("2026-08-06", "E", "EMBARQUE", "RAIA", "BSP A"),
      day("2026-08-07", "E", "EMBARQUE", "RAIA", "BSP A"),
    ];
    const duplicate = { ...worker(positions), drakeWorkerId: "worker-duplicate" };

    const snapshot = buildAnnualPositionSnapshot([worker(positions), duplicate]);

    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.periods).toHaveLength(1);
    expect(snapshot.periods[0]).toMatchObject({
      dataInicio: "2026-08-06",
      dataFim: "2026-08-07",
      tipo: "E",
    });
  });

  it("consolida nomes diferentes para a mesma empresa e matricula", () => {
    const positions = [
      day("2026-08-06", "E", "EMBARQUE", "RAIA", "BSP A"),
      day("2026-08-07", "E", "EMBARQUE", "RAIA", "BSP A"),
    ];

    const duplicateWithAnotherName = {
      ...worker(positions),
      drakeWorkerId: "worker-name-conflict",
      nome: "ADELMO M. LOPES",
    };

    const snapshot = buildAnnualPositionSnapshot([
      worker(positions),
      duplicateWithAnotherName,
    ]);

    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.periods).toHaveLength(1);
    expect(snapshot.periods[0]).toMatchObject({
      dataInicio: "2026-08-06",
      dataFim: "2026-08-07",
      tipo: "E",
    });
  });

  it("interrompe quando UUIDs da mesma identidade divergem no mesmo dia", () => {
    const first = worker([day("2026-08-06", "E", "EMBARQUE", "RAIA", "BSP A")]);
    const conflict = {
      ...worker([day("2026-08-06", "F", "FOLGA", null, null)]),
      drakeWorkerId: "worker-conflict",
    };

    expect(() => buildAnnualPositionSnapshot([first, conflict])).toThrow(
      /posições conflitantes.*2026-08-06/i,
    );
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
    expect(mapAnnualPositionType("D", "DOBRA", null)).toBe("DB");
    expect(mapAnnualPositionType("F", "FOLGA", null)).toBe("F");
    expect(mapAnnualPositionType("FE", "FÉRIAS", null)).toBe("FE");
    expect(mapAnnualPositionType("H", "HOTEL", null)).toBe("HTL");
    expect(mapAnnualPositionType("FIH", "FOLGA INDENIZADA HOTEL", "StandBy")).toBe("FIH");
    expect(mapAnnualPositionType("EC", "EMBARQUE CANCELADO", null)).toBe("CANC");
    expect(mapAnnualPositionType("EC", "EMPRESA EM CASA", null)).toBe("EC");
    expect(mapAnnualPositionType("DES", "DESEMBARQUE", null)).toBe("DES");
    expect(mapAnnualPositionType("LM", "LICENCA MEDICA", null)).toBe("LM");
    expect(mapAnnualPositionType("TR", "TREINAMENTO", null)).toBe("TR");
    expect(mapAnnualPositionType("LMV", "LICENCA MEDICA", null)).toBe("LMV");
    expect(mapAnnualPositionType("AD", "A DISPOSICAO", null)).toBe("AD");

    // A sigla do Drake é autoritativa. A descrição não pode reinterpretá-la.
    expect(mapAnnualPositionType("F", "DESEMBARQUE", null)).toBe("F");
    expect(mapAnnualPositionType("E", "DOBRA", null)).toBe("E");

    expect(() =>
      mapAnnualPositionType("XYZ", "EVENTO NOVO", null),
    ).toThrow(/sem mapeamento/i);
  });
  it("preserva AFA explícito da Ficha Anual", () => {
    expect(
      mapAnnualPositionType(
        "AFA",
        "AFASTAMENTO",
        "Afastamento",
      ),
    ).toBe("AFA");
  });
  it("preserva FIF explícito da Ficha Anual", () => {
    expect(
      mapAnnualPositionType(
        "FIF",
        "FOLGA INDENIZADA FÉRIAS",
        "FeriasTrabalhadas",
      ),
    ).toBe("FIF");
  });
  it("preserva FIC FIT FT e NS exatamente como vieram da Ficha Anual", () => {
    expect(
      mapAnnualPositionType(
        "FIC",
        "Folga Indenizada Cancelamento",
        "RegularComCompensacaoFolga",
      ),
    ).toBe("FIC");

    expect(
      mapAnnualPositionType(
        "FIT",
        "Folga indenizada treinamento",
        "Treinamento",
      ),
    ).toBe("FIT");

    expect(
      mapAnnualPositionType(
        "FT",
        "FALTA",
        "Falta",
      ),
    ).toBe("FT");

    expect(
      mapAnnualPositionType(
        "NS",
        "No Show",
        "Falta",
      ),
    ).toBe("NS");
  });
  it("lista todas as siglas desconhecidas de uma vez", () => {
    const catalog = catalogAnnualPositionOccurrences([
      worker([
        day(
          "2026-07-01",
          "ZZ1",
          "STATUS DESCONHECIDO UM",
          null,
          null,
        ),
        day(
          "2026-07-02",
          "ZZ2",
          "STATUS DESCONHECIDO DOIS",
          null,
          null,
        ),
        day(
          "2026-07-03",
          "ZZ1",
          "STATUS DESCONHECIDO UM",
          null,
          null,
        ),
      ]),
    ]);

    expect(
      catalog.unknown.map((item) => item.acronym),
    ).toEqual([
      "ZZ1",
      "ZZ2",
    ]);

    expect(
      catalog.unknown.find(
        (item) => item.acronym === "ZZ1",
      )?.count,
    ).toBe(2);
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
