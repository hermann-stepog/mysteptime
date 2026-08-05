import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizeHeader, parseExcelDate } from "./drake-spreadsheet-parser";
import { parseDrakeWorkbook } from "./import-drake";
import {
  DISPONIBILIDADE_EVENTO_MAP,
  parseDisponibilidadeDate,
  parseDisponibilidadeWorkbook,
} from "./import-disponibilidade";

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Relatório");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

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

  it("cancela o relatório de embarque se uma linha relevante estiver incompleta", () => {
    const buffer = workbookBuffer([
      [
        "Empresa do Trabalhador",
        "Matricula",
        "Trabalhador",
        "Inicio do Embarque",
        "Termino do Embarque",
      ],
      ["", "001", "Pessoa", "01/08/2026", "14/08/2026"],
    ]);

    expect(() => parseDrakeWorkbook(buffer)).toThrow(/cancelada sem alterar o banco/i);
  });

  it("cancela a disponibilidade se um evento mapeado estiver incompleto", () => {
    const buffer = workbookBuffer([
      [
        "Nome da Empresa do Trabalhador",
        "Matricula do Trabalhador",
        "Nome do Trabalhador",
        "Descricao do Evento",
        "Data de Inicio do Evento",
        "Data de Termino do Evento",
        "Situacao do Trabalhador",
      ],
      ["Empresa", "", "Pessoa", "Standby", "01/08/2026", "14/08/2026", "Ativo"],
    ]);

    expect(() => parseDisponibilidadeWorkbook(buffer)).toThrow(/cancelada sem alterar o banco/i);
  });
});
