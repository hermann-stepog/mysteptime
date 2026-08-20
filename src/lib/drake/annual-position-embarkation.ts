import { buildWorkerKey, type EmbarkationSourceRow } from "@/lib/histograma/drake-snapshot";
import { normalizeUnidadeOperacional } from "@/lib/histogramaNovo";

export type EmbarkationReportIndex = ReadonlyMap<string, EmbarkationSourceRow[]>;

export function buildEmbarkationReportIndex(rows: EmbarkationSourceRow[]): EmbarkationReportIndex {
  const result = new Map<string, EmbarkationSourceRow[]>();
  for (const row of rows) {
    const key = buildWorkerKey(row.empresa, row.matricula);
    const workerRows = result.get(key) ?? [];
    workerRows.push(row);
    result.set(key, workerRows);
  }
  return result;
}

/** Usa o relatório de embarque como fonte do BSP de cada E/D da Ficha Anual. */
export function resolveEmbarkationReportRow(
  index: EmbarkationReportIndex,
  workerKey: string,
  date: string,
  annualPositionUnit: string | null,
): EmbarkationSourceRow {
  const targetUnit = normalizedUnitKey(annualPositionUnit);
  const candidates = (index.get(workerKey) ?? []).filter(
    (row) => row.data_inicio <= date && row.data_fim >= date,
  );
  const unitMatches = targetUnit
    ? candidates.filter((row) => normalizedUnitKey(row.unidade_operacional) === targetUnit)
    : candidates;

  if (unitMatches.length === 0) {
    throw new Error(
      `O relatório de embarque do Drake não possui uma linha correspondente à Ficha Anual (${workerKey}, ${date}, ${annualPositionUnit ?? "sem unidade"}).`,
    );
  }

  const distinctValues = new Set(
    unitMatches.map((row) =>
      JSON.stringify([normalizedUnitKey(row.unidade_operacional), normalize(row.centro_de_custo)]),
    ),
  );
  if (distinctValues.size > 1) {
    throw new Error(
      `O relatório de embarque do Drake possui BSPs conflitantes para a mesma Ficha Anual (${workerKey}, ${date}).`,
    );
  }

  return unitMatches[0]!;
}

function normalizedUnitKey(value: string | null): string {
  return normalize(normalizeUnidadeOperacional(value));
}

function normalize(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}
