import { describe, expect, it } from "vitest";
import {
  bspOptionsHistograma,
  buildUnidadeCanonMap,
  chaveBsp,
  embarcouNoFiltroUnidadeBsp,
  periodoForaDoFiltroUnidadeBsp,
  type HistNovoPeriodo,
} from "./histogramaNovo";

function per(p: Partial<HistNovoPeriodo>): HistNovoPeriodo {
  return {
    id: "x",
    colaborador_id: "c",
    unidade_operacional: "FPPA - CIDADE DE PARATY",
    centro_de_custo: null,
    bsp: "BSP 25-1032",
    tipo: "E",
    data_inicio: "2026-10-05",
    data_fim: "2026-10-19",
    dias: 15,
    origem: "drake",
    created_at: "2026-10-01",
    ...p,
  } as HistNovoPeriodo;
}

describe("filtro de Unidade/BSP do Histograma", () => {
  it("junta BSP com e sem o prefixo", () => {
    expect(chaveBsp("BSP 25-1032")).toBe("25-1032");
    expect(chaveBsp(" 25-1032 ")).toBe("25-1032");
    expect(chaveBsp("")).toBeNull();
    expect(bspOptionsHistograma([per({}), per({ bsp: "25-1032" })], [])).toEqual(["25-1032"]);
  });

  const unidade = "FPPA - CIDADE DE PARATY";

  it("só entra quem EMBARCOU na unidade/BSP dentro do intervalo", () => {
    const canon = buildUnidadeCanonMap([per({})]);
    const folga = [per({ tipo: "F" })];
    const embarque = [per({ bsp: "25-1032" })];
    const fora = [per({ data_inicio: "2026-12-01", data_fim: "2026-12-10" })];
    const embarcou = (ps: HistNovoPeriodo[]) =>
      embarcouNoFiltroUnidadeBsp(ps, [unidade], ["25-1032"], canon, "2026-10-01", "2026-11-30");
    expect(embarcou(folga)).toBe(false);
    expect(embarcou(embarque)).toBe(true);
    expect(embarcou(fora)).toBe(false);
  });

  it("esmaece só dias em outra unidade/BSP", () => {
    const canon = buildUnidadeCanonMap([per({})]);
    const outra = per({ unidade_operacional: "FPSO ESPIRITO SANTO", bsp: "BSP 25-900" });
    const semLugar = per({ tipo: "F", unidade_operacional: null, bsp: null });
    expect(periodoForaDoFiltroUnidadeBsp(outra, [unidade], ["25-1032"], canon)).toBe(true);
    expect(periodoForaDoFiltroUnidadeBsp(per({}), [unidade], ["25-1032"], canon)).toBe(false);
    expect(periodoForaDoFiltroUnidadeBsp(semLugar, [unidade], ["25-1032"], canon)).toBe(false);
    expect(periodoForaDoFiltroUnidadeBsp(outra, [], [], canon)).toBe(false);
  });
});
