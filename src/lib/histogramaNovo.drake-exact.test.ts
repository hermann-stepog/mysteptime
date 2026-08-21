import { describe, expect, it } from "vitest";
import {
  buildEmbarkationCycles,
  bspDoPeriodo,
  computeDayStatus,
  displayAbbr,
  type HistNovoPeriodo,
} from "./histogramaNovo";

function periodo(
  tipo: string,
  dataInicio: string,
  dataFim: string,
  id = `${tipo}-${dataInicio}`,
  origem = "drake",
): HistNovoPeriodo {
  return {
    id,
    colaborador_id: "worker-test",
    unidade_operacional: null,
    centro_de_custo: null,
    bsp: null,
    tipo,
    data_inicio: dataInicio,
    data_fim: dataFim,
    dias: null,
    origem,
    created_at: "2026-08-12T00:00:00.000Z",
  };
}

describe("fidelidade absoluta da Ficha Anual do Drake", () => {
  it("prioriza a BSP corrigida no Mysteptime sobre o valor bruto do Drake", () => {
    const corrigido = {
      ...periodo("E", "2026-04-01", "2026-04-01"),
      centro_de_custo: "BSP DO DRAKE",
      bsp: "BSP CORRIGIDA",
    };

    expect(bspDoPeriodo(corrigido)).toBe("BSP CORRIGIDA");
  });

  it("mantém H como H mesmo quando existe embarque logo depois", () => {
    const hotel = periodo("HTL", "2026-04-15", "2026-04-15", "hotel");
    const embarque = periodo("E", "2026-04-16", "2026-04-18", "embarque");

    const result = computeDayStatus([hotel, embarque], "2026-04-15");

    expect(result.status).toBe("HTL");
    expect(displayAbbr(result.status)).toBe("H");
  });

  it("mantém DDN em todos os dias explicitamente informados pelo Drake", () => {
    const ddn = periodo("DDN", "2026-04-19", "2026-04-26", "ddn");

    for (const date of [
      "2026-04-19",
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
      "2026-04-26",
    ]) {
      expect(computeDayStatus([ddn], date).status).toBe("DDN");
    }
  });

  it("não transforma F do Drake em DES depois de um embarque", () => {
    const embarque = periodo("E", "2026-04-16", "2026-04-18", "embarque");
    const folga = periodo("F", "2026-04-19", "2026-04-30", "folga");

    expect(
      computeDayStatus([embarque, folga], "2026-04-19").status,
    ).toBe("F");
  });

  it("não transforma E do Drake em Dobra no 15º dia ou depois", () => {
    const embarque = periodo("E", "2026-04-01", "2026-04-30", "embarque");

    expect(computeDayStatus([embarque], "2026-04-15").status).toBe("E");
    expect(computeDayStatus([embarque], "2026-04-20").status).toBe("E");
    expect(computeDayStatus([embarque], "2026-04-30").status).toBe("E");
  });

  it("exibe Dobra do Drake como D somente quando o Drake informou D", () => {
    const dobra = periodo("DB", "2026-04-15", "2026-04-15", "dobra");

    const result = computeDayStatus([dobra], "2026-04-15");

    expect(result.status).toBe("DB");
    expect(displayAbbr(result.status)).toBe("D");
  });

  it("mantém DES explícito como DES", () => {
    const desembarque = periodo("DES", "2026-04-19", "2026-04-19");

    expect(
      computeDayStatus([desembarque], "2026-04-19").status,
    ).toBe("DES");
  });

  it("não fabrica embarque nem desembarque no meio de E, Dobra, E", () => {
    const periods = [
      periodo("E", "2026-04-01", "2026-04-10", "embarque-1"),
      periodo("DB", "2026-04-11", "2026-04-12", "dobra"),
      periodo("E", "2026-04-13", "2026-04-15", "embarque-2"),
    ];

    expect(buildEmbarkationCycles(periods)).toMatchObject([
      {
        dataInicio: "2026-04-01",
        dataFim: "2026-04-15",
        dataDesembarque: "2026-04-16",
      },
    ]);
  });

  it("mantém ciclos separados quando existe um dia sem E ou Dobra", () => {
    const periods = [
      periodo("E", "2026-04-01", "2026-04-05", "embarque-1"),
      periodo("E", "2026-04-07", "2026-04-10", "embarque-2"),
    ];

    expect(
      buildEmbarkationCycles(periods).map((cycle) => [
        cycle.dataInicio,
        cycle.dataDesembarque,
      ]),
    ).toEqual([
      ["2026-04-01", "2026-04-06"],
      ["2026-04-07", "2026-04-11"],
    ]);
  });

  it("mantém EC e DI explícitos sem convertê-los para STB", () => {
    const ec = periodo("EC", "2026-04-10", "2026-04-10");
    const di = periodo("DI", "2026-04-11", "2026-04-11");

    expect(computeDayStatus([ec], "2026-04-10").status).toBe("EC");
    expect(computeDayStatus([di], "2026-04-11").status).toBe("DI");
  });

  it("mantém LM LMV TR e AD exatamente como vieram do Drake", () => {
    expect(
      computeDayStatus(
        [periodo("LM", "2026-04-01", "2026-04-01")],
        "2026-04-01",
      ).status,
    ).toBe("LM");

    expect(
      computeDayStatus(
        [periodo("LMV", "2026-04-02", "2026-04-02")],
        "2026-04-02",
      ).status,
    ).toBe("LMV");

    expect(
      computeDayStatus(
        [periodo("TR", "2026-04-03", "2026-04-03")],
        "2026-04-03",
      ).status,
    ).toBe("TR");

    expect(
      computeDayStatus(
        [periodo("AD", "2026-04-04", "2026-04-04")],
        "2026-04-04",
      ).status,
    ).toBe("AD");
  });

  it("posição do Drake vence Programado e BASE locais na célula", () => {
    const drakeFolga = periodo("F", "2026-04-20", "2026-04-20", "drake-folga");
    const programado = periodo("P", "2026-04-20", "2026-04-20", "programado", "programado");
    const base = periodo("BASE", "2026-04-20", "2026-04-20", "base", "manual");

    expect(
      computeDayStatus(
        [programado, base, drakeFolga],
        "2026-04-20",
      ).status,
    ).toBe("F");
  });

  it("recusa tipo Drake desconhecido em vez de inventar STB", () => {
    const desconhecido = periodo("XYZ", "2026-04-20", "2026-04-20");

    expect(() =>
      computeDayStatus([desconhecido], "2026-04-20"),
    ).toThrow(/tipo não suportado/i);
  });

  it("mantém Embarque Cancelado visualmente como EC", () => {
    const cancelado = periodo("CANC", "2026-04-20", "2026-04-20");

    const result = computeDayStatus([cancelado], "2026-04-20");

    expect(result.status).toBe("CANC");
    expect(displayAbbr(result.status)).toBe("EC");
  });
  it("mantém FIH explícito do Drake exatamente como FIH", () => {
    const fih = periodo(
      "FIH",
      "2026-04-15",
      "2026-04-15",
      "fih",
    );

    const result = computeDayStatus(
      [fih],
      "2026-04-15",
    );

    expect(result.status).toBe("FIH");
    expect(displayAbbr(result.status)).toBe("FIH");
  });
  it("mantém AFA explícito do Drake exatamente como AFA", () => {
    const afa = periodo(
      "AFA",
      "2026-05-10",
      "2026-05-15",
      "afa",
    );

    for (const date of [
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
    ]) {
      const result = computeDayStatus([afa], date);

      expect(result.status).toBe("AFA");
      expect(displayAbbr(result.status)).toBe("AFA");
    }
  });
  it("mantém FIF explícito do Drake exatamente como FIF", () => {
    const fif = periodo(
      "FIF",
      "2026-06-01",
      "2026-06-05",
      "fif",
    );

    for (const date of [
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ]) {
      const result = computeDayStatus([fif], date);

      expect(result.status).toBe("FIF");
      expect(displayAbbr(result.status)).toBe("FIF");
    }
  });
  it("mantém FIC FIT FT e NS explícitos exatamente como o Drake informou", () => {
    const casos = [
      ["FIC", "2026-07-01"],
      ["FIT", "2026-07-02"],
      ["FT", "2026-07-03"],
      ["NS", "2026-07-04"],
    ] as const;

    for (const [tipo, date] of casos) {
      const p = periodo(
        tipo,
        date,
        date,
        `drake-${tipo}`,
      );

      const result = computeDayStatus(
        [p],
        date,
      );

      expect(result.status).toBe(tipo);
      expect(displayAbbr(result.status)).toBe(tipo);
    }
  });

  describe("regra temporal do Programado contra o Drake", () => {
    function programado(
      date: string,
      id: string,
    ): HistNovoPeriodo {
      return {
        ...periodo("P", date, date, id),
        origem: "manual",
      } as HistNovoPeriodo;
    }

    it("no passado troca P por E quando o Drake confirma embarque", () => {
      const date = "2000-01-10";

      const p = programado(date, "p-passado-e");
      const drake = periodo(
        "E",
        date,
        date,
        "drake-e",
      );

      expect(
        computeDayStatus([p, drake], date).status,
      ).toBe("E");
    });

    it("no passado troca P por STB quando o embarque não aconteceu", () => {
      const date = "2000-01-11";

      const p = programado(date, "p-passado-stb");
      const drake = periodo(
        "STB",
        date,
        date,
        "drake-stb",
      );

      expect(
        computeDayStatus([p, drake], date).status,
      ).toBe("STB");
    });

    it("no passado remove P quando não existe confirmação do Drake", () => {
      const date = "2000-01-12";
      const p = programado(date, "p-passado-sem-drake");

      expect(
        computeDayStatus([p], date).status,
      ).toBe("STB");
    });

    it("não exibe P histórico nem quando ele veio do próprio Drake", () => {
      const date = "2000-01-13";
      const drakeProgramado = periodo(
        "P",
        date,
        date,
        "drake-p-passado",
      );

      expect(
        computeDayStatus([drakeProgramado], date).status,
      ).toBe("STB");
    });

    it("no futuro mantém P quando o Drake ainda está em STB", () => {
      const date = "2099-01-10";

      const p = programado(date, "p-futuro-stb");
      const drake = periodo(
        "STB",
        date,
        date,
        "drake-stb-futuro",
      );

      expect(
        computeDayStatus([p, drake], date).status,
      ).toBe("P");
    });

    it("no futuro mantém P quando ainda não existe posição Drake", () => {
      const date = "2099-01-11";

      const p = programado(
        date,
        "p-futuro-sem-drake",
      );

      expect(
        computeDayStatus([p], date).status,
      ).toBe("P");
    });

    it("no futuro troca P por E se o Drake já confirmou embarque", () => {
      const date = "2099-01-12";

      const p = programado(date, "p-futuro-e");
      const drake = periodo(
        "E",
        date,
        date,
        "drake-e-futuro",
      );

      expect(
        computeDayStatus([p, drake], date).status,
      ).toBe("E");
    });

    it("no futuro outra ocorrência explícita do Drake também vence P", () => {
      const date = "2099-01-13";

      const p = programado(date, "p-futuro-fe");
      const drake = periodo(
        "FE",
        date,
        date,
        "drake-fe-futuro",
      );

      expect(
        computeDayStatus([p, drake], date).status,
      ).toBe("FE");
    });

    it("aplica a mesma regra à continuação E de origem programado", () => {
      const date = "2099-01-14";

      const continuacao = {
        ...periodo(
          "E",
          date,
          date,
          "continuacao-programada",
        ),
        origem: "programado",
      } as HistNovoPeriodo;

      const drake = periodo(
        "STB",
        date,
        date,
        "drake-stb-continuacao",
      );

      expect(
        computeDayStatus(
          [continuacao, drake],
          date,
        ).status,
      ).toBe("P");
    });
  });
});
