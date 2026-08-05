import { describe, expect, it } from "vitest";
import {
  buildAvailabilitySnapshot,
  buildEmbarkationSnapshot,
  type EmbarkationSourceRow,
} from "./drake-snapshot";

function embarkation(patch: Partial<EmbarkationSourceRow> = {}): EmbarkationSourceRow {
  return {
    matricula: "000016",
    nome: "FABIANO CARDOSO DOS SANTOS",
    empresa: "STEP OIL & GAS SERVICOS LTDA",
    funcao: "CALDEIREIRO V",
    funcao_operacao: "CALDEIREIRO V",
    unidade_operacional: "FPSA - CIDADE DE SAQUAREMA",
    centro_de_custo: "BSP 26-522",
    data_inicio: "2026-07-22",
    data_fim: "2026-07-26",
    dias: 5,
    ...patch,
  };
}

describe("snapshot do histograma Drake", () => {
  it("remove somente duplicatas exatas do próprio relatório", () => {
    const row = embarkation();
    const snapshot = buildEmbarkationSnapshot([row, { ...row }]);

    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.periods).toHaveLength(1);
  });

  it("preserva todos os embarques reais que se sobrepõem em unidades diferentes", () => {
    const snapshot = buildEmbarkationSnapshot([
      embarkation({
        unidade_operacional: "CDI - CIDADE ILHA BELA",
        centro_de_custo: "BSP CDI",
        data_inicio: "2026-07-16",
        data_fim: "2026-07-29",
        dias: 14,
      }),
      embarkation(),
      embarkation({
        data_inicio: "2026-07-29",
        data_fim: "2026-08-11",
        dias: 14,
      }),
    ]);

    expect(snapshot.periods).toHaveLength(3);
    expect(snapshot.periods.map((period) => period.unidadeOperacional)).toContain(
      "CDI - CIDADE ILHA BELA",
    );
  });

  it("não mistura pessoas com a mesma matrícula em empresas diferentes", () => {
    const snapshot = buildEmbarkationSnapshot([
      embarkation({ empresa: "EMPRESA A", nome: "VAGNER" }),
      embarkation({ empresa: "EMPRESA B", nome: "LUIS ANDRESSO" }),
    ]);

    expect(snapshot.workers).toHaveLength(2);
    expect(new Set(snapshot.workers.map((worker) => worker.workerKey)).size).toBe(2);
  });

  it("cancela o snapshot quando o Drake devolve versões conflitantes do mesmo evento", () => {
    expect(() =>
      buildEmbarkationSnapshot([embarkation(), embarkation({ data_fim: "2026-07-27", dias: 6 })]),
    ).toThrow(/cancelada para não sobrepor dados/i);
  });

  it("usa empresa e matrícula também na disponibilidade", () => {
    const snapshot = buildAvailabilitySnapshot([
      {
        matricula: "000016",
        nome: "FABIANO CARDOSO DOS SANTOS",
        empresa: "STEP OIL & GAS SERVICOS LTDA",
        funcao: "CALDEIREIRO V",
        evento: "StandBy",
        tipo: "STB",
        data_inicio: "2026-07-18",
        data_fim: "2026-07-21",
      },
    ]);

    expect(snapshot.workers).toHaveLength(1);
    expect(snapshot.periods[0]).toMatchObject({ tipo: "STB", dias: 4 });
  });

  it("recusa trabalhador sem empresa em vez de usar só a matrícula", () => {
    expect(() => buildEmbarkationSnapshot([embarkation({ empresa: null })])).toThrow(
      /não informou empresa/i,
    );
  });
});
