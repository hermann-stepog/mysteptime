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

export type ParsedDisponibilidadeRow = AvailabilitySourceRow;

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
  const indexOfAny = (...names: string[]): number =>
    names.map((name) => header.indexOf(name)).find((i) => i !== -1) ?? -1;

  const iMatricula = indexOfAny("matricula do trabalhador", "matricula");
  const iNome = indexOfAny("nome do trabalhador", "trabalhador");
  const iEvento = indexOfAny("descricao do evento");
  const iInicio = indexOfAny("data de inicio do evento");
  const iFim = indexOfAny("data de termino do evento");
  const iSituacao = indexOfAny("situacao do trabalhador");
  const iFuncao = indexOfAny("funcao do trabalhador", "funcao");
  // A mesma matrícula pode pertencer a duas pessoas de empresas diferentes (o Drake numera
  // matrícula por empresa) — essa coluna resolve a ambiguidade igual ao relatório de Embarque.
  const iEmpresa = indexOfAny(
    "nome da empresa do trabalhador",
    "empresa do trabalhador",
    "empresa",
  );

  if ([iMatricula, iNome, iEvento, iInicio, iFim, iEmpresa].some((i) => i === -1)) {
    throw new Error(
      "Colunas esperadas não encontradas no relatório de disponibilidade. Empresa, matrícula, nome, evento, início e término são obrigatórios para evitar associações incorretas.",
    );
  }

  const parsed: ParsedDisponibilidadeRow[] = [];
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (!row.some((cell) => cell !== "")) return;
    // Só o quadro ativo participa da reconciliação — desligados não têm disponibilidade.
    if (iSituacao !== -1 && normalizeHeader(row[iSituacao]) !== "ativo") return;

    const evento = String(row[iEvento] ?? "").trim();
    const tipo = DISPONIBILIDADE_EVENTO_MAP[normalizeHeader(evento)];
    // Evento não mapeado (ex.: Trabalho Externo) não vira período no Histograma.
    if (!tipo) return;

    const empresa = String(row[iEmpresa] ?? "").trim();
    const matricula = String(row[iMatricula] ?? "").trim();
    const nome = String(row[iNome] ?? "").trim();
    const data_inicio = parseDisponibilidadeDate(row[iInicio]);
    const data_fim = parseDisponibilidadeDate(row[iFim]);

    if (!empresa || !matricula || !nome || !data_inicio || !data_fim) {
      throw new Error(
        `A linha ${rowNumber} do relatório de disponibilidade está incompleta. Empresa, matrícula, nome, evento, início e término são obrigatórios. A sincronização foi cancelada sem alterar o banco.`,
      );
    }

    parsed.push({
      matricula,
      nome,
      empresa,
      funcao: iFuncao === -1 ? null : String(row[iFuncao] ?? "").trim() || null,
      evento,
      tipo,
      data_inicio,
      data_fim,
    });
  });
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
