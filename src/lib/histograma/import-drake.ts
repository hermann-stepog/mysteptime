import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { normalizeUnidadeOperacional } from "@/lib/histogramaNovo";
import { ensureTimesheetParaPeriodo } from "@/lib/timesheetAutoGen";
import { buildEmbarkationSnapshot, type EmbarkationSourceRow } from "./drake-snapshot";
import {
  synchronizeDrakeHistogramSnapshot,
  type DrakeSnapshotWindow,
} from "./drake-snapshot-sync.server";

export type DrakeField =
  | "empresa"
  | "unidade_operacional"
  | "centro_de_custo"
  | "matricula"
  | "nome"
  | "funcao"
  | "data_inicio"
  | "data_fim"
  | "dias"
  | "funcao_operacao";

export const DRAKE_HEADER_MAP: Record<string, DrakeField> = {
  "empresa do trabalhador": "empresa",
  "unidade oprecional": "unidade_operacional",
  "unidade operacional": "unidade_operacional",
  "centro de custo": "centro_de_custo",
  bsp: "centro_de_custo",
  matricula: "matricula",
  trabalhador: "nome",
  funcao: "funcao",
  "inicio do embarque": "data_inicio",
  "termino do embarque": "data_fim",
  "dias do embarque": "dias",
  "funcao de operacao do trabalhador": "funcao_operacao",
};

export type ParsedDrakeRow = EmbarkationSourceRow;

export interface DrakeImportSummary {
  created: number;
  updated: number;
  insertedEvents: number;
  skipped: number;
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parseExcelDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return isoDate(new Date(epoch.getTime() + value * 86_400_000));
  }
  const text = String(value).trim();
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const [, day, month, rawYear] = br;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

export function parseDrakeWorkbook(buffer: ArrayBuffer | Buffer): ParsedDrakeRow[] {
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const headerRow = rows[0].map(normalizeHeader);
  const columnIndex: Partial<Record<DrakeField, number>> = {};
  headerRow.forEach((header, index) => {
    const field = DRAKE_HEADER_MAP[header];
    if (field && columnIndex[field] === undefined) columnIndex[field] = index;
  });

  const required: DrakeField[] = ["empresa", "matricula", "nome", "data_inicio", "data_fim"];
  const missing = required.filter((field) => columnIndex[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Colunas não encontradas na planilha: ${missing.join(", ")}.`);
  }

  const get = (row: unknown[], field: DrakeField): string => {
    const index = columnIndex[field];
    return index === undefined ? "" : String(row[index] ?? "").trim();
  };

  return rows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell !== ""))
    .map(({ row, rowNumber }) => {
      const parsed: ParsedDrakeRow = {
        matricula: get(row, "matricula"),
        nome: get(row, "nome"),
        empresa: get(row, "empresa") || null,
        funcao: get(row, "funcao") || null,
        funcao_operacao: get(row, "funcao_operacao") || null,
        unidade_operacional: normalizeUnidadeOperacional(get(row, "unidade_operacional")),
        centro_de_custo: get(row, "centro_de_custo") || null,
        data_inicio:
          parseExcelDate(
            columnIndex.data_inicio === undefined ? null : row[columnIndex.data_inicio],
          ) ?? "",
        data_fim:
          parseExcelDate(columnIndex.data_fim === undefined ? null : row[columnIndex.data_fim]) ??
          "",
        dias: columnIndex.dias === undefined ? null : Number(row[columnIndex.dias]) || null,
      };
      if (
        !parsed.empresa ||
        !parsed.matricula ||
        !parsed.nome ||
        !parsed.data_inicio ||
        !parsed.data_fim
      ) {
        throw new Error(
          `A linha ${rowNumber} do relatório de embarque está incompleta. Empresa, matrícula, nome, início e término são obrigatórios. A sincronização foi cancelada sem alterar o banco.`,
        );
      }
      return parsed;
    });
}

/**
 * Reconcilia um snapshot completo do relatório 1 em uma única transação no banco.
 * Registros manuais não são atualizados nem removidos; somente a origem "drake" dentro da
 * janela consultada participa da reconciliação.
 */
export async function importDrakeEmbarkation(
  db: SupabaseClient,
  rows: ParsedDrakeRow[],
  window: DrakeSnapshotWindow,
): Promise<DrakeImportSummary> {
  const snapshot = buildEmbarkationSnapshot(rows);
  const result = await synchronizeDrakeHistogramSnapshot(db, snapshot, window);
  const workerByKey = new Map(snapshot.workers.map((worker) => [worker.workerKey, worker]));

  for (const period of snapshot.periods) {
    const periodoId = result.periodIdByEventKey.get(period.eventKey);
    const worker = workerByKey.get(period.workerKey);
    if (!periodoId || !worker) {
      throw new Error("O banco não confirmou todos os eventos do relatório de embarque.");
    }
    await ensureTimesheetParaPeriodo(db, {
      periodoId,
      sourceEventKey: period.eventKey,
      unidadeOperacional: period.unidadeOperacional,
      bsp: period.centroDeCusto,
      funcaoEmbarque: worker.funcao || worker.funcaoOperacao || "—",
      dataInicio: period.dataInicio,
      dataFim: period.dataFim,
    });
  }

  return {
    created: result.createdWorkers,
    updated: result.updatedWorkers,
    insertedEvents: result.synchronizedEvents,
    skipped: rows.length - snapshot.periods.length,
  };
}

export async function importDrakeEmbarkationFromBuffer(
  db: SupabaseClient,
  buffer: ArrayBuffer | Buffer,
  window: DrakeSnapshotWindow,
): Promise<DrakeImportSummary> {
  const rows = parseDrakeWorkbook(buffer);
  if (rows.length === 0) {
    throw new Error("Nenhuma linha válida encontrada na planilha de embarque.");
  }
  return importDrakeEmbarkation(db, rows, window);
}
