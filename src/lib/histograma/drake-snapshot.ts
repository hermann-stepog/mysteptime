export type DrakeSnapshotSource = "drake" | "disponibilidade";

export interface DrakeWorkerSnapshotRow {
  workerKey: string;
  matricula: string;
  nome: string;
  empresa: string;
  funcao: string | null;
  funcaoOperacao: string | null;
}

export interface DrakePeriodSnapshotRow {
  eventKey: string;
  workerKey: string;
  unidadeOperacional: string | null;
  centroDeCusto: string | null;
  tipo: string;
  dataInicio: string;
  dataFim: string;
  dias: number | null;
  sourceEventName: string;
}

export interface DrakeHistogramSnapshot {
  source: DrakeSnapshotSource;
  workers: DrakeWorkerSnapshotRow[];
  periods: DrakePeriodSnapshotRow[];
}

export interface EmbarkationSourceRow {
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

export interface AvailabilitySourceRow {
  matricula: string;
  nome: string;
  empresa: string;
  funcao: string | null;
  evento: string;
  tipo: string;
  data_inicio: string;
  data_fim: string;
}

export function buildEmbarkationSnapshot(rows: EmbarkationSourceRow[]): DrakeHistogramSnapshot {
  const validRows = rows.map((row) => {
    const workerKey = buildWorkerKey(row.empresa, row.matricula);
    assertPeriod(row.data_inicio, row.data_fim, "embarque", workerKey);
    return { row, workerKey };
  });

  return {
    source: "drake",
    workers: buildWorkers(
      validRows.map(({ row, workerKey }) => ({
        workerKey,
        matricula: row.matricula,
        nome: row.nome,
        empresa: requiredIdentityValue(row.empresa, "empresa", row.matricula),
        funcao: row.funcao,
        funcaoOperacao: row.funcao_operacao,
        referenceDate: row.data_fim,
      })),
    ),
    periods: deduplicatePeriods(
      validRows.map(({ row, workerKey }) => ({
        eventKey: stableKey([
          "drake",
          workerKey,
          row.unidade_operacional,
          row.centro_de_custo,
          row.data_inicio,
        ]),
        workerKey,
        unidadeOperacional: row.unidade_operacional,
        centroDeCusto: row.centro_de_custo,
        tipo: "E",
        dataInicio: row.data_inicio,
        dataFim: row.data_fim,
        dias: row.dias,
        sourceEventName: "EMBARQUE",
      })),
    ),
  };
}

export function buildAvailabilitySnapshot(rows: AvailabilitySourceRow[]): DrakeHistogramSnapshot {
  const validRows = rows.map((row) => {
    const workerKey = buildWorkerKey(row.empresa, row.matricula);
    assertPeriod(row.data_inicio, row.data_fim, row.evento, workerKey);
    return { row, workerKey };
  });

  return {
    source: "disponibilidade",
    workers: buildWorkers(
      validRows.map(({ row, workerKey }) => ({
        workerKey,
        matricula: row.matricula,
        nome: row.nome,
        empresa: row.empresa,
        // Função de folha não substitui a função de embarque já sincronizada pelo relatório 1.
        funcao: null,
        funcaoOperacao: null,
        referenceDate: row.data_fim,
      })),
    ),
    periods: deduplicatePeriods(
      validRows.map(({ row, workerKey }) => ({
        eventKey: stableKey(["disponibilidade", workerKey, row.evento, row.data_inicio]),
        workerKey,
        unidadeOperacional: null,
        centroDeCusto: null,
        tipo: row.tipo,
        dataInicio: row.data_inicio,
        dataFim: row.data_fim,
        dias: inclusiveDays(row.data_inicio, row.data_fim),
        sourceEventName: row.evento,
      })),
    ),
  };
}

export function buildWorkerKey(empresa: string | null, matricula: string): string {
  return stableKey([
    "worker",
    requiredIdentityValue(empresa, "empresa", matricula),
    requiredIdentityValue(matricula, "matrícula", matricula),
  ]);
}

function buildWorkers(
  rows: Array<DrakeWorkerSnapshotRow & { referenceDate: string }>,
): DrakeWorkerSnapshotRow[] {
  const latest = new Map<string, DrakeWorkerSnapshotRow & { referenceDate: string }>();
  for (const row of rows) {
    const current = latest.get(row.workerKey);
    if (!current || row.referenceDate > current.referenceDate) latest.set(row.workerKey, row);
  }
  return [...latest.values()]
    .map(({ referenceDate: _referenceDate, ...worker }) => worker)
    .sort((left, right) => left.workerKey.localeCompare(right.workerKey));
}

function deduplicatePeriods(rows: DrakePeriodSnapshotRow[]): DrakePeriodSnapshotRow[] {
  const unique = new Map<string, DrakePeriodSnapshotRow>();
  for (const row of rows) {
    const existing = unique.get(row.eventKey);
    if (!existing) {
      unique.set(row.eventKey, row);
      continue;
    }
    if (periodFingerprint(existing) !== periodFingerprint(row)) {
      throw new Error(
        `O Drake devolveu duas versões conflitantes do mesmo evento (${row.sourceEventName}, ${row.dataInicio}). A sincronização foi cancelada para não sobrepor dados.`,
      );
    }
  }
  return [...unique.values()].sort((left, right) => left.eventKey.localeCompare(right.eventKey));
}

function periodFingerprint(row: DrakePeriodSnapshotRow): string {
  return stableKey([
    row.workerKey,
    row.unidadeOperacional,
    row.centroDeCusto,
    row.tipo,
    row.dataInicio,
    row.dataFim,
    row.dias == null ? null : String(row.dias),
    row.sourceEventName,
  ]);
}

function stableKey(parts: Array<string | null>): string {
  return parts
    .map((part) => normalizeIdentityPart(part))
    .map((part) => `${part.length}:${part}`)
    .join("|");
}

function normalizeIdentityPart(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function requiredIdentityValue(value: string | null, field: string, matricula: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      `O Drake não informou ${field} para a matrícula ${matricula || "desconhecida"}. A sincronização foi cancelada para evitar associar dados à pessoa errada.`,
    );
  }
  return normalized;
}

function assertPeriod(
  startDate: string,
  endDate: string,
  eventName: string,
  workerKey: string,
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error(`O Drake devolveu datas inválidas no evento ${eventName} (${workerKey}).`);
  }
  if (startDate > endDate) {
    throw new Error(
      `O Drake devolveu um evento com término anterior ao início (${eventName}, ${startDate}–${endDate}).`,
    );
  }
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
}
