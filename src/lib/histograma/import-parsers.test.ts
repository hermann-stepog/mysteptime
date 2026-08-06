import { describe, expect, it } from "vitest";
import { normalizeHeader, parseExcelDate } from "../histograma/import-drake";
import {
  DISPONIBILIDADE_EVENTO_MAP,
  parseDisponibilidadeDate,
} from "../histograma/import-disponibilidade";

describe("import parsers", () => {
  it("normaliza headers Drake", () => {
    expect(normalizeHeader("Início do Embarque")).toBe("inicio do embarque");
  });

  it("parseia datas BR e ISO", () => {
    expect(parseExcelDate("07/01/2026")).toBe("2026-01-07");
    expect(parseExcelDate("2026-01-07")).toBe("2026-01-07");
  });

  it("mapeia eventos de disponibilidade e ignora Trabalho Externo", () => {
    expect(DISPONIBILIDADE_EVENTO_MAP.standby).toBe("STB");
    expect(DISPONIBILIDADE_EVENTO_MAP["trabalho externo"]).toBeNull();
    expect(parseDisponibilidadeDate("07/01/2026 00:00:00")).toBe("2026-01-07");
  });
});
