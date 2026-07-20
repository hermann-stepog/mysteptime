import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { HistNovoColaborador } from "@/lib/histogramaNovo";

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

export interface ParsedDrakeRow {
  matricula: string;
  nome: string;
  empresa: string | null;
  funcao: string | null;
  funcao_operacao: string | null;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  data_inicio: string;
  data_fim: string;
  dias: number | null;
}

export interface DrakeImportSummary {
  created: number;
  updated: number;
  insertedEvents: number;
  skipped: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function parseExcelDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return isoDate(new Date(epoch.getTime() + v * 86400000));
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export function parseDrakeWorkbook(buf: ArrayBuffer | Buffer): ParsedDrakeRow[] {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) throw new Error("Planilha vazia.");

  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<DrakeField, number>> = {};
  headerRow.forEach((h, i) => {
    const key = DRAKE_HEADER_MAP[h];
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });

  const required: DrakeField[] = ["matricula", "nome", "data_inicio", "data_fim"];
  const missing = required.filter((k) => colIndex[k] === undefined);
  if (missing.length)
    throw new Error(`Colunas não encontradas na planilha: ${missing.join(", ")}.`);

  const get = (r: unknown[], k: DrakeField): string => {
    const i = colIndex[k];
    return i === undefined ? "" : String(r[i] ?? "").trim();
  };

  return rows
    .slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => ({
      matricula: get(r, "matricula"),
      nome: get(r, "nome"),
      empresa: get(r, "empresa") || null,
      funcao: get(r, "funcao") || null,
      funcao_operacao: get(r, "funcao_operacao") || null,
      unidade_operacional: get(r, "unidade_operacional") || null,
      centro_de_custo: get(r, "centro_de_custo") || null,
      data_inicio:
        parseExcelDate(colIndex.data_inicio !== undefined ? r[colIndex.data_inicio] : null) ?? "",
      data_fim: parseExcelDate(colIndex.data_fim !== undefined ? r[colIndex.data_fim] : null) ?? "",
      dias: colIndex.dias !== undefined ? Number(r[colIndex.dias]) || null : null,
    }))
    .filter((r) => r.matricula && r.nome && r.data_inicio && r.data_fim);
}

/** Importa relatório de embarque (mesmo fluxo do botão Importar Excel Drake). */
export async function importDrakeEmbarkation(
  supabase: SupabaseClient,
  rows: ParsedDrakeRow[],
): Promise<DrakeImportSummary> {
  const matriculas = Array.from(new Set(rows.map((r) => r.matricula)));
  const existing: HistNovoColaborador[] = [];
  for (const lote of chunk(matriculas, 300)) {
    const { data, error: exErr } = await supabase
      .from("hist_novo_colaboradores")
      .select("*")
      .in("matricula", lote);
    if (exErr) throw exErr;
    existing.push(...((data ?? []) as HistNovoColaborador[]));
  }
  const byMatricula = new Map(existing.map((c) => [c.matricula, c]));

  const toInsert: Array<{
    matricula: string;
    nome: string;
    empresa: string | null;
    funcao: string | null;
    funcao_operacao: string | null;
  }> = [];
  const toUpdate: Array<{
    id: string;
    nome: string;
    empresa: string | null;
    funcao: string | null;
    funcao_operacao: string | null;
  }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.matricula)) continue;
    seen.add(r.matricula);
    const ex = byMatricula.get(r.matricula);
    if (!ex) {
      toInsert.push({
        matricula: r.matricula,
        nome: r.nome,
        empresa: r.empresa,
        funcao: r.funcao,
        funcao_operacao: r.funcao_operacao,
      });
    } else if (
      ex.nome !== r.nome ||
      ex.empresa !== r.empresa ||
      ex.funcao !== r.funcao ||
      ex.funcao_operacao !== r.funcao_operacao
    ) {
      toUpdate.push({
        id: ex.id,
        nome: r.nome || ex.nome,
        empresa: r.empresa ?? ex.empresa,
        funcao: r.funcao ?? ex.funcao,
        funcao_operacao: r.funcao_operacao ?? ex.funcao_operacao,
      });
    }
  }

  let insertedColabs: HistNovoColaborador[] = [];
  if (toInsert.length) {
    const { data, error } = await supabase
      .from("hist_novo_colaboradores")
      .insert(toInsert)
      .select("*");
    if (error) throw error;
    insertedColabs = (data ?? []) as HistNovoColaborador[];
  }
  for (const u of toUpdate) {
    const { error } = await supabase
      .from("hist_novo_colaboradores")
      .update({
        nome: u.nome,
        empresa: u.empresa,
        funcao: u.funcao,
        funcao_operacao: u.funcao_operacao,
      })
      .eq("id", u.id);
    if (error) throw error;
  }

  const allColabs = [...existing, ...insertedColabs];
  const idByMatricula = new Map(allColabs.map((c) => [c.matricula, c.id]));

  const periodosToInsert = rows
    .map((r) => ({
      colaborador_id: idByMatricula.get(r.matricula),
      unidade_operacional: r.unidade_operacional,
      centro_de_custo: r.centro_de_custo,
      tipo: "E",
      data_inicio: r.data_inicio,
      data_fim: r.data_fim,
      dias: r.dias,
      origem: "drake",
    }))
    .filter((p): p is typeof p & { colaborador_id: string } => !!p.colaborador_id);

  const { data: drakeAntigos, error: drakeErr } = await supabase
    .from("hist_novo_periodos")
    .select("id")
    .eq("origem", "drake");
  if (drakeErr) throw drakeErr;
  const drakeIds = (drakeAntigos ?? []).map((p: { id: string }) => p.id);
  if (drakeIds.length) {
    for (let i = 0; i < drakeIds.length; i += 500) {
      const lote = drakeIds.slice(i, i + 500);
      const { error: unlinkErr } = await supabase
        .from("timesheet_embarques")
        .update({ periodo_id: null })
        .in("periodo_id", lote);
      if (unlinkErr) throw unlinkErr;
    }
    const { error: delErr } = await supabase
      .from("hist_novo_periodos")
      .delete()
      .eq("origem", "drake");
    if (delErr) throw delErr;
  }

  for (let i = 0; i < periodosToInsert.length; i += 500) {
    const lote = periodosToInsert.slice(i, i + 500);
    const { error: pErr } = await supabase.from("hist_novo_periodos").insert(lote);
    if (pErr) throw pErr;
  }

  return {
    created: toInsert.length,
    updated: toUpdate.length,
    insertedEvents: periodosToInsert.length,
    skipped: rows.length - periodosToInsert.length,
  };
}

export async function importDrakeEmbarkationFromBuffer(
  supabase: SupabaseClient,
  buf: ArrayBuffer | Buffer,
): Promise<DrakeImportSummary> {
  const rows = parseDrakeWorkbook(buf);
  if (!rows.length) throw new Error("Nenhuma linha válida encontrada na planilha de embarque.");
  return importDrakeEmbarkation(supabase, rows);
}
