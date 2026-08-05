import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { TipoPeriodo } from "@/lib/histogramaNovo";
import { normalizeHeader, parseExcelDate } from "./drake-spreadsheet-parser";
import { buildAvailabilitySnapshot, type AvailabilitySourceRow } from "./drake-snapshot";
import {
  synchronizeDrakeHistogramSnapshot,
  type DrakeSnapshotWindow,
} from "./drake-snapshot-sync.server";

export const DISPONIBILIDADE_EVENTO_MAP: Record<string, TipoPeriodo | null> = {
  standby: "STB",
  folga: "F",
  "atestado medico": "AT",
  ferias: "FE",
  "folga indenizada": "FI",
  "folga indenizada cancelamento": "FI",
  "folga indenizada ferias": "FI",
  "folga indenizada hotel": "FI",
  "folga indenizada treinamento": "FI",
  "feriado indenizado": "FI",
  "trabalho externo": null,
  afastamento: "AT",
  "licenca medica": "AT",
  embarque: null,
  dobra: null,
  "desembarque em dia nao util": "DDN",
  periculosidade: null,
  sobreaviso: null,
  hotel: "HTL",
  "embarque cancelado": "CANC",
  falta: null,
  treinamento: null,
  "no show": null,
};

export type ParsedDisponibilidadeRow = AvailabilitySourceRow & { tipo: TipoPeriodo };

export interface DisponibilidadeImportSummary {
  insertedEvents: number;
  skipped: number;
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parseDisponibilidadeDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isoDate(value);
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return parseExcelDate(value);
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseDisponibilidadeWorkbook(
  buffer: ArrayBuffer | Buffer,
): ParsedDisponibilidadeRow[] {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const header = rows[0].map(normalizeHeader);
  const companyIndex = header.indexOf("nome da empresa do trabalhador");
  const registrationIndex = header.indexOf("matricula do trabalhador");
  const nameIndex = header.indexOf("nome do trabalhador");
  const eventIndex = header.indexOf("descricao do evento");
  const functionIndex = header.indexOf("funcao de folha do trabalhador");
  const startIndex = header.indexOf("data de inicio do evento");
  const endIndex = header.indexOf("data de termino do evento");
  const stateIndex = header.indexOf("situacao do trabalhador");

  const required = [companyIndex, registrationIndex, nameIndex, eventIndex, startIndex, endIndex];
  if (required.some((index) => index === -1)) {
    throw new Error(
      "Colunas esperadas não encontradas no relatório de disponibilidade. Empresa, matrícula, nome, evento, início e término são obrigatórios para evitar associações incorretas.",
    );
  }

  const parsed: ParsedDisponibilidadeRow[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (!row.some((cell) => cell !== "")) continue;
    if (stateIndex !== -1 && normalizeHeader(row[stateIndex]) !== "ativo") continue;

    const empresa = String(row[companyIndex] ?? "").trim();
    const matricula = String(row[registrationIndex] ?? "").trim();
    const nome = String(row[nameIndex] ?? "").trim();
    const evento = String(row[eventIndex] ?? "").trim();
    const tipo = DISPONIBILIDADE_EVENTO_MAP[normalizeHeader(evento)];
    const data_inicio = parseDisponibilidadeDate(row[startIndex]);
    const data_fim = parseDisponibilidadeDate(row[endIndex]);
    if (!tipo) continue;
    if (!empresa || !matricula || !nome || !evento || !data_inicio || !data_fim) {
      throw new Error(
        `A linha ${index + 2} do relatório de disponibilidade está incompleta. Empresa, matrícula, nome, evento, início e término são obrigatórios. A sincronização foi cancelada sem alterar o banco.`,
      );
    }

    parsed.push({
      empresa,
      matricula,
      nome,
      funcao: functionIndex === -1 ? null : String(row[functionIndex] ?? "").trim() || null,
      evento,
      tipo,
      data_inicio,
      data_fim,
    });
  }
  return parsed;
}

/** Reconcilia o relatório 14 sem apagar ou atualizar períodos de outras origens. */
export async function importDisponibilidade(
  db: SupabaseClient,
  rows: ParsedDisponibilidadeRow[],
  window: DrakeSnapshotWindow,
): Promise<DisponibilidadeImportSummary> {
  const snapshot = buildAvailabilitySnapshot(rows);
  const result = await synchronizeDrakeHistogramSnapshot(db, snapshot, window);
  return {
    insertedEvents: result.synchronizedEvents,
    skipped: rows.length - snapshot.periods.length,
  };
}

export async function importDisponibilidadeFromBuffer(
  db: SupabaseClient,
  buffer: ArrayBuffer | Buffer,
  window: DrakeSnapshotWindow,
): Promise<DisponibilidadeImportSummary> {
  const rows = parseDisponibilidadeWorkbook(buffer);
  if (rows.length === 0) {
    throw new Error("Nenhuma linha válida/mapeável encontrada na planilha de disponibilidade.");
  }
  return importDisponibilidade(db, rows, window);
}
