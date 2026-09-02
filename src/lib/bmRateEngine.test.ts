import { describe, expect, it } from "vitest";
import { addDaysStr } from "./timesheetOffshore";
import { aggregateMaoDeObra, type Rate, type TimesheetDiaComColaborador } from "./bmRateEngine";
import { computeDayCodes, countDayQuantities } from "./bmDayGrid";

const RATE: Rate = {
  bsp: "25-1033",
  client: "Cliente",
  vessel: "Atlanta",
  funcao: "Soldador",
  rate_embarque: 100,
  rate_dobra: 150,
  rate_hotel: 80,
  rate_hora_extra: 20,
  rate_adicional_noturno: 10,
  active: true,
};

function dia(partial: Partial<TimesheetDiaComColaborador> & Pick<TimesheetDiaComColaborador, "data" | "evento">): TimesheetDiaComColaborador {
  return {
    colaborador_id: "edinaldo",
    colaborador_nome: "Edinaldo de Oliveira Barbosa",
    funcao_embarque: "Soldador",
    bsp: "25-1033",
    horas_extras: 0,
    adicional_noturno: false,
    total_horas: 12,
    ...partial,
  };
}

function diasEdinaldo(): TimesheetDiaComColaborador[] {
  const dias: TimesheetDiaComColaborador[] = [dia({ data: "2026-07-30", evento: "Embarque" })];
  for (let i = 1; i <= 14; i += 1) {
    dias.push(dia({ data: addDaysStr("2026-07-30", i), evento: "Embarque" }));
  }
  dias.push(dia({ data: addDaysStr("2026-07-30", 15), evento: "Desembarque" }));
  return dias;
}

describe("aggregateMaoDeObra — dias embarcados alinhados ao calendário", () => {
  it("Edinaldo 30/07–31/08/2026: quantidade, rate e total fecham com P+E do calendário (não 1)", () => {
    const dias = diasEdinaldo();
    const esperado = countDayQuantities(computeDayCodes(dias)).diasEmbarque;
    const [linha] = aggregateMaoDeObra(dias, [RATE], "Cliente", "Atlanta");

    expect(esperado).toBe(15);
    expect(linha.dias_embarque).toBe(esperado);
    expect(linha.dias_embarque).not.toBe(1);
    expect(linha.rate_embarque).toBe(100);
    expect(linha.valor_total).toBe(15 * 100);
  });

  it("duplicatas de re-sincronização não inflacionam Dias Emb nem o total", () => {
    const base = diasEdinaldo();
    const duplicadas = [...base, ...base.map((d) => ({ ...d, horas_extras: 0 }))];
    const [linha] = aggregateMaoDeObra(duplicadas, [RATE], "Cliente", "Atlanta");
    expect(linha.dias_embarque).toBe(15);
    expect(linha.valor_total).toBe(1500);
  });

  it("Dobra e hotel entram nas colunas certas, sem misturar com Dias Emb", () => {
    const dias = [
      dia({ data: "2026-07-30", evento: "Hotel Pré Embarque" }),
      dia({ data: "2026-07-31", evento: "Embarque" }),
      dia({ data: "2026-08-01", evento: "Dobra" }),
      dia({ data: "2026-08-02", evento: "Desembarque" }),
    ];
    const [linha] = aggregateMaoDeObra(dias, [RATE], "Cliente", "Atlanta");
    expect(linha.dias_embarque).toBe(1);
    expect(linha.dias_dobra).toBe(1);
    expect(linha.dias_hotel).toBe(1);
    expect(linha.valor_total).toBe(100 + 150 + 80);
  });
});
