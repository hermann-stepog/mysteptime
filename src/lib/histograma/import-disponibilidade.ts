import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { TipoPeriodo } from "@/lib/histogramaNovo";
import { normalizeHeader, parseExcelDate } from "@/lib/histograma/import-drake";

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
  "embarque cancelado": null,
  falta: null,
  treinamento: null,
  "no show": null,
};

export interface ParsedDisponibilidadeRow {
  matricula: string;
  tipo: TipoPeriodo;
  data_inicio: string;
  data_fim: string;
}

export interface DisponibilidadeImportSummary {
  insertedEvents: number;
  skipped: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function parseDisponibilidadeDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isoDate(v);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return parseExcelDate(v);
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export function parseDisponibilidadeWorkbook(
  buf: ArrayBuffer | Buffer,
): ParsedDisponibilidadeRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const header = rows[0].map(normalizeHeader);
  const iMatricula = header.indexOf("matricula do trabalhador");
  const iEvento = header.indexOf("descricao do evento");
  const iInicio = header.indexOf("data de inicio do evento");
  const iFim = header.indexOf("data de termino do evento");
  const iSituacao = header.indexOf("situacao do trabalhador");
  if ([iMatricula, iEvento, iInicio, iFim].some((i) => i === -1)) {
    throw new Error(
      "Colunas esperadas não encontradas (Matrícula do Trabalhador / Descrição do Evento / Data de Início do Evento / Data de Término do Evento).",
    );
  }

  const out: ParsedDisponibilidadeRow[] = [];
  for (const r of rows.slice(1)) {
    if (!r.some((c) => c !== "")) continue;
    if (iSituacao !== -1 && normalizeHeader(r[iSituacao]) !== "ativo") continue;
    const matricula = String(r[iMatricula] ?? "").trim();
    if (!matricula) continue;
    const eventoKey = normalizeHeader(r[iEvento]);
    const tipo = DISPONIBILIDADE_EVENTO_MAP[eventoKey];
    if (!tipo) continue;
    const data_inicio = parseDisponibilidadeDate(r[iInicio]);
    const data_fim = parseDisponibilidadeDate(r[iFim]);
    if (!data_inicio || !data_fim) continue;
    out.push({ matricula, tipo, data_inicio, data_fim });
  }
  return out;
}

/** Importa relatório de disponibilidade (mesmo fluxo do botão Importar Relatório de Disponibilidade). */
export async function importDisponibilidade(
  supabase: SupabaseClient,
  rows: ParsedDisponibilidadeRow[],
): Promise<DisponibilidadeImportSummary> {
  const matriculas = Array.from(new Set(rows.map((r) => r.matricula)));
  const existentes: { id: string; matricula: string }[] = [];
  for (const lote of chunk(matriculas, 300)) {
    const { data, error: exErr } = await supabase
      .from("hist_novo_colaboradores")
      .select("id, matricula")
      .in("matricula", lote);
    if (exErr) throw exErr;
    existentes.push(...(data ?? []));
  }
  const idByMatricula = new Map(existentes.map((c) => [c.matricula, c.id]));

  const periodosToInsert = rows
    .map((r) => ({
      colaborador_id: idByMatricula.get(r.matricula),
      unidade_operacional: null,
      tipo: r.tipo,
      data_inicio: r.data_inicio,
      data_fim: r.data_fim,
      dias:
        Math.round(
          (new Date(r.data_fim).getTime() - new Date(r.data_inicio).getTime()) / 86400000,
        ) + 1,
      origem: "disponibilidade",
    }))
    .filter((p): p is typeof p & { colaborador_id: string } => !!p.colaborador_id);

  const skipped = rows.length - periodosToInsert.length;

  const { error: delErr } = await supabase
    .from("hist_novo_periodos")
    .delete()
    .eq("origem", "disponibilidade");
  if (delErr) throw delErr;

  for (let i = 0; i < periodosToInsert.length; i += 500) {
    const lote = periodosToInsert.slice(i, i + 500);
    const { error: pErr } = await supabase.from("hist_novo_periodos").insert(lote);
    if (pErr) throw pErr;
  }

  return { insertedEvents: periodosToInsert.length, skipped };
}

export async function importDisponibilidadeFromBuffer(
  supabase: SupabaseClient,
  buf: ArrayBuffer | Buffer,
): Promise<DisponibilidadeImportSummary> {
  const rows = parseDisponibilidadeWorkbook(buf);
  if (!rows.length)
    throw new Error("Nenhuma linha válida/mapeável encontrada na planilha de disponibilidade.");
  return importDisponibilidade(supabase, rows);
}
