import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import type { TipoPeriodo } from "@/lib/histogramaNovo";
import { normalizeHeader, parseExcelDate, chaveColaborador } from "@/lib/histograma/import-drake";

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

export interface ParsedDisponibilidadeRow {
  matricula: string;
  empresa: string | null;
  tipo: TipoPeriodo;
  data_inicio: string;
  data_fim: string;
}

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
  const iMatricula = header.indexOf("matricula do trabalhador");
  const iEvento = header.indexOf("descricao do evento");
  const iInicio = header.indexOf("data de inicio do evento");
  const iFim = header.indexOf("data de termino do evento");
  const iSituacao = header.indexOf("situacao do trabalhador");
  // A mesma matrícula pode pertencer a duas pessoas de empresas diferentes (o Drake numera
  // matrícula por empresa) — essa coluna resolve a ambiguidade igual ao relatório de Embarque.
  // Se não existir nessa exportação (ex.: versão antiga do relatório), fica null e o import cai
  // no fallback seguro (pular matrícula ambígua) em vez de arriscar a pessoa errada.
  const iEmpresa = ["nome da empresa do trabalhador", "empresa do trabalhador", "empresa"]
    .map((h) => header.indexOf(h))
    .find((i) => i !== -1) ?? -1;
  if ([iMatricula, iEvento, iInicio, iFim].some((i) => i === -1)) {
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
    const data_inicio = parseDisponibilidadeDate(r[iInicio]);
    const data_fim = parseDisponibilidadeDate(r[iFim]);
    if (!data_inicio || !data_fim) continue;
    const empresa = iEmpresa !== -1 ? String(r[iEmpresa] ?? "").trim() || null : null;
    out.push({ matricula, empresa, tipo, data_inicio, data_fim });
  }
  return parsed;
}

/** Reconcilia o relatório 14 sem apagar ou atualizar períodos de outras origens. */
export async function importDisponibilidade(
  db: SupabaseClient,
  rows: ParsedDisponibilidadeRow[],
  window: DrakeSnapshotWindow,
): Promise<DisponibilidadeImportSummary> {
  const matriculas = Array.from(new Set(rows.map((r) => r.matricula)));
  const existentes: { id: string; matricula: string; empresa: string | null }[] = [];
  for (const lote of chunk(matriculas, 300)) {
    const { data, error: exErr } = await supabase
      .from("hist_novo_colaboradores")
      .select("id, matricula, empresa")
      .in("matricula", lote);
    if (exErr) throw exErr;
    existentes.push(...(data ?? []));
  }
  // Matrícula sem ambiguidade (só um colaborador) resolve direto. Com ambiguidade (Drake numera
  // matrícula por empresa — a mesma matrícula pode ser de duas pessoas em empresas diferentes),
  // só resolve se essa exportação trouxe a coluna de empresa e ela bater com exatamente um
  // colaborador; senão pula (conta como "skipped") em vez de arriscar gravar na pessoa errada.
  const idsPorMatricula = new Map<string, string[]>();
  const idPorChave = new Map<string, string>();
  for (const c of existentes) {
    if (!idsPorMatricula.has(c.matricula)) idsPorMatricula.set(c.matricula, []);
    idsPorMatricula.get(c.matricula)!.push(c.id);
    idPorChave.set(chaveColaborador(c.matricula, c.empresa), c.id);
  }
  const resolverColaboradorId = (r: ParsedDisponibilidadeRow): string | undefined => {
    const candidatos = idsPorMatricula.get(r.matricula) ?? [];
    if (candidatos.length === 1) return candidatos[0];
    if (candidatos.length > 1 && r.empresa) return idPorChave.get(chaveColaborador(r.matricula, r.empresa));
    return undefined;
  };

  const periodosToInsert = rows
    .map((r) => ({
      colaborador_id: resolverColaboradorId(r),
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
