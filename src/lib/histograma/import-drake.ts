import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { HistNovoColaborador, HistNovoPeriodo } from "@/lib/histogramaNovo";

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
  unchangedCount: number;
  periodsUpdatedCount: number;
  preservedReferencedCount: number;
  deletedUnreferencedCount: number;
}

export type DesiredEmbarkationPeriod = {
  colaborador_id: string;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  tipo: "E";
  data_inicio: string;
  data_fim: string;
  dias: number | null;
  origem: "drake";
};

export type PeriodMergePlan = {
  toInsert: DesiredEmbarkationPeriod[];
  toUpdate: Array<{ id: string; patch: Partial<DesiredEmbarkationPeriod> }>;
  unchangedIds: string[];
  /** Períodos antigos sem match no relatório e sem timesheet — podem ser removidos. */
  toDeleteUnreferenced: string[];
  /** Períodos antigos sem match no relatório, mas referenciados — preservar. */
  toPreserveReferenced: Array<{ id: string; linkedTimesheetCount: number }>;
};

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

/**
 * Chave natural do período de embarque Drake.
 * Confirmada pelo schema e pelo uso no histograma: colaborador + tipo + datas.
 */
export function embarkationPeriodNaturalKey(input: {
  colaborador_id: string;
  tipo: string;
  data_inicio: string;
  data_fim: string;
}): string {
  return `${input.colaborador_id}|${input.tipo}|${input.data_inicio}|${input.data_fim}`;
}

function periodPayloadChanged(
  existing: HistNovoPeriodo,
  desired: DesiredEmbarkationPeriod,
): Partial<DesiredEmbarkationPeriod> | null {
  const patch: Partial<DesiredEmbarkationPeriod> = {};
  if ((existing.unidade_operacional ?? null) !== (desired.unidade_operacional ?? null)) {
    patch.unidade_operacional = desired.unidade_operacional;
  }
  if ((existing.centro_de_custo ?? null) !== (desired.centro_de_custo ?? null)) {
    patch.centro_de_custo = desired.centro_de_custo;
  }
  if ((existing.dias ?? null) !== (desired.dias ?? null)) {
    patch.dias = desired.dias;
  }
  if ((existing.origem ?? null) !== "drake") {
    patch.origem = "drake";
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Planeja merge sem apagar períodos referenciados por timesheet_embarques.
 * Não nullifica periodo_id; não usa CASCADE.
 */
export function planEmbarkationPeriodMerge(input: {
  existingDrakePeriods: HistNovoPeriodo[];
  desiredPeriods: DesiredEmbarkationPeriod[];
  referencedCounts: Map<string, number>;
}): PeriodMergePlan {
  const desiredByKey = new Map<string, DesiredEmbarkationPeriod>();
  for (const desired of input.desiredPeriods) {
    desiredByKey.set(embarkationPeriodNaturalKey(desired), desired);
  }

  const existingByKey = new Map<string, HistNovoPeriodo[]>();
  for (const existing of input.existingDrakePeriods) {
    const key = embarkationPeriodNaturalKey(existing);
    const list = existingByKey.get(key) ?? [];
    list.push(existing);
    existingByKey.set(key, list);
  }

  const toInsert: DesiredEmbarkationPeriod[] = [];
  const toUpdate: Array<{ id: string; patch: Partial<DesiredEmbarkationPeriod> }> = [];
  const unchangedIds: string[] = [];
  const toDeleteUnreferenced: string[] = [];
  const toPreserveReferenced: Array<{ id: string; linkedTimesheetCount: number }> = [];
  const matchedExistingIds = new Set<string>();

  for (const [key, desired] of desiredByKey) {
    const candidates = existingByKey.get(key) ?? [];
    if (candidates.length === 0) {
      toInsert.push(desired);
      continue;
    }

    // Preferir período já referenciado por timesheet; senão o mais antigo (id estável).
    const preferred =
      candidates.find((c) => (input.referencedCounts.get(c.id) ?? 0) > 0) ??
      [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0]!;

    matchedExistingIds.add(preferred.id);
    const patch = periodPayloadChanged(preferred, desired);
    if (patch) toUpdate.push({ id: preferred.id, patch });
    else unchangedIds.push(preferred.id);

    for (const extra of candidates) {
      if (extra.id === preferred.id) continue;
      matchedExistingIds.add(extra.id);
      const linked = input.referencedCounts.get(extra.id) ?? 0;
      if (linked > 0) {
        toPreserveReferenced.push({ id: extra.id, linkedTimesheetCount: linked });
      } else {
        toDeleteUnreferenced.push(extra.id);
      }
    }
  }

  for (const existing of input.existingDrakePeriods) {
    if (matchedExistingIds.has(existing.id)) continue;
    const linked = input.referencedCounts.get(existing.id) ?? 0;
    if (linked > 0) {
      toPreserveReferenced.push({ id: existing.id, linkedTimesheetCount: linked });
    } else {
      toDeleteUnreferenced.push(existing.id);
    }
  }

  return {
    toInsert,
    toUpdate,
    unchangedIds,
    toDeleteUnreferenced,
    toPreserveReferenced,
  };
}

async function loadReferencedPeriodCounts(
  supabase: SupabaseClient,
  periodIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of periodIds) counts.set(id, 0);
  if (!periodIds.length) return counts;

  for (const lote of chunk(periodIds, 300)) {
    const { data, error } = await supabase
      .from("timesheet_embarques")
      .select("periodo_id")
      .in("periodo_id", lote);
    if (error) throw error;
    for (const row of data ?? []) {
      const pid = (row as { periodo_id: string | null }).periodo_id;
      if (!pid) continue;
      counts.set(pid, (counts.get(pid) ?? 0) + 1);
    }
  }
  return counts;
}

function logPreservedPeriods(
  preserved: Array<{ id: string; linkedTimesheetCount: number }>,
): void {
  for (const item of preserved) {
    console.info(
      "[embarkation-import] Periodo preservado por possuir timesheets vinculados",
      {
        periodIdPresent: true,
        linkedTimesheetCount: item.linkedTimesheetCount,
        action: "preserved",
      },
    );
  }
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

  const toInsertColabs: Array<{
    matricula: string;
    nome: string;
    empresa: string | null;
    funcao: string | null;
    funcao_operacao: string | null;
  }> = [];
  const toUpdateColabs: Array<{
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
      toInsertColabs.push({
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
      toUpdateColabs.push({
        id: ex.id,
        nome: r.nome || ex.nome,
        empresa: r.empresa ?? ex.empresa,
        funcao: r.funcao ?? ex.funcao,
        funcao_operacao: r.funcao_operacao ?? ex.funcao_operacao,
      });
    }
  }

  let insertedColabs: HistNovoColaborador[] = [];
  if (toInsertColabs.length) {
    const { data, error } = await supabase
      .from("hist_novo_colaboradores")
      .insert(toInsertColabs)
      .select("*");
    if (error) throw error;
    insertedColabs = (data ?? []) as HistNovoColaborador[];
  }
  for (const u of toUpdateColabs) {
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

  const desiredByKey = new Map<string, DesiredEmbarkationPeriod>();
  for (const r of rows) {
    const colaborador_id = idByMatricula.get(r.matricula);
    if (!colaborador_id) continue;
    const desired: DesiredEmbarkationPeriod = {
      colaborador_id,
      unidade_operacional: r.unidade_operacional,
      centro_de_custo: r.centro_de_custo,
      tipo: "E",
      data_inicio: r.data_inicio,
      data_fim: r.data_fim,
      dias: r.dias,
      origem: "drake",
    };
    desiredByKey.set(embarkationPeriodNaturalKey(desired), desired);
  }
  const desiredPeriods = [...desiredByKey.values()];

  const { data: existingDrakeRows, error: existingErr } = await supabase
    .from("hist_novo_periodos")
    .select("*")
    .eq("origem", "drake")
    .eq("tipo", "E");
  if (existingErr) throw existingErr;
  const existingDrakePeriods = (existingDrakeRows ?? []) as HistNovoPeriodo[];

  const referencedCounts = await loadReferencedPeriodCounts(
    supabase,
    existingDrakePeriods.map((p) => p.id),
  );

  const plan = planEmbarkationPeriodMerge({
    existingDrakePeriods,
    desiredPeriods,
    referencedCounts,
  });

  logPreservedPeriods(plan.toPreserveReferenced);

  let deletedUnreferencedCount = 0;
  let preservedReferencedCount = plan.toPreserveReferenced.length;

  // Ordem segura: UPDATE (preserva id) → INSERT → DELETE só não referenciados.
  // Não nullifica timesheet_embarques.periodo_id; não usa CASCADE.
  for (const item of plan.toUpdate) {
    const { error } = await supabase
      .from("hist_novo_periodos")
      .update(item.patch)
      .eq("id", item.id);
    if (error) throw error;
  }

  for (const lote of chunk(plan.toInsert, 500)) {
    if (!lote.length) continue;
    const { error: pErr } = await supabase.from("hist_novo_periodos").insert(lote);
    if (pErr) throw pErr;
  }

  for (const lote of chunk(plan.toDeleteUnreferenced, 500)) {
    if (!lote.length) continue;
    // Revalida referências imediatamente antes do DELETE (evita corrida).
    const latestCounts = await loadReferencedPeriodCounts(supabase, lote);
    const safeToDelete: string[] = [];
    for (const id of lote) {
      const linked = latestCounts.get(id) ?? 0;
      if (linked > 0) {
        logPreservedPeriods([{ id, linkedTimesheetCount: linked }]);
        preservedReferencedCount += 1;
        continue;
      }
      safeToDelete.push(id);
    }
    if (!safeToDelete.length) continue;
    const { error: delErr } = await supabase
      .from("hist_novo_periodos")
      .delete()
      .in("id", safeToDelete);
    if (delErr) throw delErr;
    deletedUnreferencedCount += safeToDelete.length;
  }

  return {
    created: toInsertColabs.length,
    updated: toUpdateColabs.length,
    insertedEvents: plan.toInsert.length,
    skipped: rows.length - desiredPeriods.length,
    unchangedCount: plan.unchangedIds.length,
    periodsUpdatedCount: plan.toUpdate.length,
    preservedReferencedCount,
    deletedUnreferencedCount,
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
