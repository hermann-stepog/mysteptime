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
      JSON.stringify([
        normalizedUnitKey(row.unidade_operacional),
        normalize(sanitizeDrakeBsp(row.centro_de_custo, row.unidade_operacional)),
      ]),
    ),
  );
  if (distinctValues.size > 1) {
    throw new Error(
      `O relatório de embarque do Drake possui BSPs conflitantes para a mesma Ficha Anual (${workerKey}, ${date}).`,
    );
  }

  return unitMatches[0]!;
}

/**
 * Folga Indenizada ("FI" — o colaborador embarcou durante a própria folga) não tem linha
 * própria no relatório de embarque (esse relatório só cobre dias E/D) e a Ficha Anual não traz
 * BSP nenhuma pra esses dias — por isso `centro_de_custo` sempre chegava vazio do Drake pra FI,
 * mesmo quando o relatório de embarque da pessoa mostra a BSP certa num período próximo, na
 * mesma unidade (pedido dela). Diferente de resolveEmbarkationReportRow acima (que exige a data
 * caindo DENTRO do período e lança erro se não achar — usado só pra E/D, onde isso é garantido),
 * esta versão não exige sobreposição de data, não lança erro, e devolve null quando não achar
 * nada na mesma unidade (fica sem BSP mesmo, em vez de arriscar pegar de unidade errada).
 */
export function resolveNearestEmbarkationReportRowForUnit(
  index: EmbarkationReportIndex,
  workerKey: string,
  date: string,
  annualPositionUnit: string | null,
): EmbarkationSourceRow | null {
  const targetUnit = normalizedUnitKey(annualPositionUnit);
  if (!targetUnit) return null;
  const candidatos = (index.get(workerKey) ?? []).filter(
    (row) => normalizedUnitKey(row.unidade_operacional) === targetUnit && sanitizeDrakeBsp(row.centro_de_custo, row.unidade_operacional),
  );
  if (candidatos.length === 0) return null;
  const refTime = new Date(date).getTime();
  const distancia = (row: EmbarkationSourceRow) => Math.min(
    Math.abs(new Date(row.data_inicio).getTime() - refTime),
    Math.abs(new Date(row.data_fim).getTime() - refTime),
  );
  return candidatos.reduce((melhor, atual) => (distancia(atual) < distancia(melhor) ? atual : melhor));
}

/**
 * O relatório de embarque aceita texto livre e há registros em que a unidade foi
 * copiada para a coluna BSP. Esse valor não identifica um contrato e deve chegar
 * vazio ao Mysteptime para ser corrigido manualmente.
 */
export function sanitizeDrakeBsp(
  value: string | null,
  unidadeOperacional: string | null,
): string | null {
  const bsp = value?.trim() || null;
  if (!bsp) return null;
  return normalizedUnitKey(bsp) === normalizedUnitKey(unidadeOperacional) ? null : bsp;
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
