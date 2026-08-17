import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function canonicalMatricula(value) {
  const raw = String(value ?? "").trim();
  if (/^\d+$/.test(raw)) return raw.replace(/^0+(?=\d)/, "");
  return normalizeText(raw);
}

export function splitLegacyCode(value) {
  const legacyCode = String(value ?? "").trim();
  const match = legacyCode.match(/^(.+?)_(\d+)$/);
  if (!match) return { legacyCode, matriculaBase: null, suffix: null };
  return { legacyCode, matriculaBase: match[1], suffix: `_${match[2]}` };
}

export function parseAccessDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+.*)?$/);
  if (match) return validIso(Number(match[3]), Number(match[2]), Number(match[1]));

  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) return validIso(Number(match[1]), Number(match[2]), Number(match[3]));

  return null;
}

function validIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInclusive(start, end) {
  if (!start || !end) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return Boolean(aStart && aEnd && bStart && bEnd && aStart <= bEnd && aEnd >= bStart);
}

export function sameNullableText(a, b) {
  return normalizeText(a) === normalizeText(b);
}

export function hashRecord(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function parseDelimited(text, delimiter = ";") {
  const input = text.replace(/^\uFEFF/, "");
  const matrix = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      matrix.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field.replace(/\r$/, ""));
    matrix.push(row);
  }
  if (!matrix.length) return [];

  const headers = matrix[0].map((header) => header.trim());
  return matrix
    .slice(1)
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
    );
}

export async function readCsv(filePath, { optional = false, delimiter = ";" } = {}) {
  try {
    return parseDelimited(await readFile(filePath, "utf8"), delimiter);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }
}

function csvCell(value, delimiter) {
  const text =
    value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (text.includes('"') || text.includes(delimiter) || /[\r\n]/.test(text))
    return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export async function writeCsv(filePath, rows, headers = null, delimiter = ";") {
  await mkdir(path.dirname(filePath), { recursive: true });
  const columns = headers ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [columns.map((column) => csvCell(column, delimiter)).join(delimiter)];
  for (const row of rows)
    lines.push(columns.map((column) => csvCell(row[column], delimiter)).join(delimiter));
  await writeFile(filePath, `\uFEFF${lines.join("\n")}\n`, "utf8");
}

export function pick(row, names) {
  if (!row) return "";
  const entries = new Map(Object.entries(row).map(([key, value]) => [normalizeText(key), value]));
  for (const name of names) {
    const value = entries.get(normalizeText(name));
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

export function classifyExisting(candidate, existingPeriods) {
  const exact = existingPeriods.find(
    (current) =>
      current.colaborador_id === candidate.colaborador_id &&
      current.tipo === candidate.tipo &&
      current.data_inicio === candidate.data_inicio &&
      current.data_fim === candidate.data_fim &&
      sameNullableText(current.unidade_operacional, candidate.unidade_operacional) &&
      sameNullableText(current.centro_de_custo || current.bsp, candidate.bsp),
  );
  if (exact)
    return {
      status: "skip_exact",
      existingId: exact.id,
      reason: "Mesmo colaborador, tipo, datas, unidade e BSP.",
    };

  const overlaps = existingPeriods.filter(
    (current) =>
      current.colaborador_id === candidate.colaborador_id &&
      intervalsOverlap(
        current.data_inicio,
        current.data_fim,
        candidate.data_inicio,
        candidate.data_fim,
      ),
  );
  if (!overlaps.length) return { status: "insert", existingId: null, reason: null };

  const sameContext = overlaps.every(
    (current) =>
      current.tipo === candidate.tipo &&
      sameNullableText(current.unidade_operacional, candidate.unidade_operacional) &&
      sameNullableText(current.centro_de_custo || current.bsp, candidate.bsp),
  );
  return {
    status: sameContext ? "review_overlap_same_context" : "block_overlap_conflict",
    existingId: overlaps[0].id,
    reason: sameContext
      ? "Intervalo sobreposto com mesmo contexto, mas datas diferentes; revisar união/recorte."
      : "Intervalo sobreposto com tipo, unidade ou BSP divergente.",
  };
}
