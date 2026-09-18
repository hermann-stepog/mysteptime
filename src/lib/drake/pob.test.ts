import { describe, expect, it } from "vitest";
import { countPob, pobToday } from "./pob";

const columns = ["Unidade Operacional", "Matricula", "Inicio Embarque", "Fim Embarque"].map(name => ({ name }));
const date = "2026-09-18";
describe("POB geral do Drake", () => {
  it("conta uma matrícula uma vez entre unidades e inclui o primeiro embarque", () => {
    expect(countPob({ columns, rows: [
      ["U1", "001", "18/09/2026", "30/09/2026"],
      ["U2", "001", "18/09/2026", "30/09/2026"],
      ["U2", "002", "10/09/2026", "18/09/2026"],
      ["U3", "003", "19/09/2026", "30/09/2026"],
      ["U4", "004", "01/09/2026", "17/09/2026"],
    ] }, date)).toBe(2);
  });
  it("aceita zero somente de uma resposta válida e completa", () => {
    expect(countPob({ columns, rows: [] }, date)).toBe(0);
    expect(() => countPob({ scheduled: true, rows: [], columns: [] }, date)).toThrow();
    expect(() => countPob({ columns, rows: [], totalRows: 5 }, date)).toThrow();
    expect(() => countPob({ columns, rows: [], totalPages: 2 }, date)).toThrow();
    expect(() => countPob({ columns: [], rows: [] }, date)).toThrow();
  });
  it("recusa matrícula ou data ausente em vez de inventar um total", () => {
    expect(() => countPob({ columns, rows: [["U1", "", "18/09/2026", "30/09/2026"]] }, date)).toThrow();
    expect(() => countPob({ columns, rows: [["U1", "001", null, "30/09/2026"]] }, date)).toThrow();
  });
  it("usa o dia de São Paulo durante a virada de data UTC", () => {
    expect(pobToday(new Date("2026-09-19T01:00:00Z"))).toBe("2026-09-18");
    expect(pobToday(new Date("2026-09-19T03:00:00Z"))).toBe("2026-09-19");
  });
});
