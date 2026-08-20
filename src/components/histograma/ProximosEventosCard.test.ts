import { describe, expect, it } from "vitest";
import type { HistNovoColaborador, HistNovoPeriodo } from "@/lib/histogramaNovo";
import { buildUpcomingEvents } from "@/lib/histograma/upcoming-events";

const collaborator: HistNovoColaborador = {
  id: "worker-1",
  matricula: "100",
  nome: "COLABORADOR TESTE",
  empresa: "STEP",
  funcao: null,
  funcao_operacao: null,
};

function period(
  tipo: string,
  startDate: string,
  endDate: string,
  id: string,
  origem = "drake",
): HistNovoPeriodo {
  return {
    id,
    colaborador_id: collaborator.id,
    unidade_operacional: "RAIA",
    centro_de_custo: "BSP A",
    bsp: null,
    tipo,
    data_inicio: startDate,
    data_fim: endDate,
    dias: null,
    origem,
    created_at: "2026-04-01T00:00:00.000Z",
  };
}

describe("próximos eventos derivados da Ficha Anual", () => {
  it("usa um único embarque e um único desembarque para E, Dobra, E", () => {
    const events = buildUpcomingEvents(
      [
        period("E", "2026-04-01", "2026-04-10", "e-1"),
        period("DB", "2026-04-11", "2026-04-12", "dobra"),
        period("E", "2026-04-13", "2026-04-15", "e-2"),
      ],
      new Map([[collaborator.id, collaborator]]),
      "2026-04-01",
    );

    expect(events.map((event) => [event.tipo, event.data])).toEqual([
      ["embarque", "2026-04-01"],
    ]);

    const disembarkationWindow = buildUpcomingEvents(
      [
        period("E", "2026-04-01", "2026-04-10", "e-1"),
        period("DB", "2026-04-11", "2026-04-12", "dobra"),
        period("E", "2026-04-13", "2026-04-15", "e-2"),
      ],
      new Map([[collaborator.id, collaborator]]),
      "2026-04-10",
    );

    expect(disembarkationWindow.map((event) => [event.tipo, event.data])).toEqual([
      ["desembarque", "2026-04-16"],
    ]);
  });

  it("não mostra P hoje, vencido ou já confirmado", () => {
    const events = buildUpcomingEvents(
      [
        period("P", "2026-04-09", "2026-04-09", "p-old", "manual"),
        period("P", "2026-04-10", "2026-04-10", "p-today", "manual"),
        period("P", "2026-04-11", "2026-04-11", "p-confirmed", "manual"),
        period("E", "2026-04-12", "2026-04-14", "e-confirmed"),
        period("P", "2026-04-15", "2026-04-15", "p-future", "manual"),
      ],
      new Map([[collaborator.id, collaborator]]),
      "2026-04-10",
    );

    expect(events.filter((event) => !event.confirmado)).toMatchObject([
      { data: "2026-04-15", tipo: "embarque" },
    ]);
  });
});
