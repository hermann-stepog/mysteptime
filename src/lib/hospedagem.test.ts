import { describe, expect, it } from "vitest";
import { rateiosDaHospedagem } from "./hospedagem";

describe("rateiosDaHospedagem", () => {
  it("mantém o valor inteiro no lançamento com um único BSP", () => {
    expect(rateiosDaHospedagem({
      id: "h1",
      unidade: "FORTE",
      unidade_2: null,
      unidade_3: null,
      bsp: "BSP 1",
      bsp_2: null,
      bsp_3: null,
      valor_total: 1800,
      valor_2: null,
      valor_3: null,
    })).toEqual([{ key: "h1:1", unidade: "FORTE", bsp: "BSP 1", valor: 1800 }]);
  });

  it("distribui um único total entre as unidades e BSPs selecionados", () => {
    const rateios = rateiosDaHospedagem({
      id: "h2",
      unidade: "FPPA - CIDADE DE PARATY",
      unidade_2: "CDI - CIDADE ILHA BELA",
      unidade_3: "FORTE",
      bsp: "BSP 25-1032",
      bsp_2: "BSP 25-1031",
      bsp_3: "BSP 25-906",
      valor_total: 1800,
      valor_2: 360,
      valor_3: 180,
    });

    expect(rateios).toEqual([
      { key: "h2:1", unidade: "FPPA - CIDADE DE PARATY", bsp: "BSP 25-1032", valor: 1260 },
      { key: "h2:2", unidade: "CDI - CIDADE ILHA BELA", bsp: "BSP 25-1031", valor: 360 },
      { key: "h2:3", unidade: "FORTE", bsp: "BSP 25-906", valor: 180 },
    ]);
    expect(rateios.reduce((total, rateio) => total + rateio.valor, 0)).toBe(1800);
  });

  it("usa a unidade principal como compatibilidade para rateios antigos", () => {
    expect(rateiosDaHospedagem({
      id: "legado",
      unidade: "FORTE",
      unidade_2: null,
      unidade_3: null,
      bsp: "BSP 1",
      bsp_2: "BSP 2",
      bsp_3: null,
      valor_total: 1000,
      valor_2: 250,
      valor_3: null,
    })[1]).toEqual({ key: "legado:2", unidade: "FORTE", bsp: "BSP 2", valor: 250 });
  });
});
