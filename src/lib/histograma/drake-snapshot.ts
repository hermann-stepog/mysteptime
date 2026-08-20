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

export interface AnnualPositionWorkerRow {
  drakeWorkerId: string;
  matricula: string;
  nome: string;
  empresa: string;
  funcao: string | null;
  funcaoOperacao: string | null;
  positions: AnnualPositionDayRow[];
}

export interface AnnualPositionDayRow {
  date: string;
  occurrenceAcronym: string;
  occurrenceDescription: string;
  occurrenceType: string | null;
  unidadeOperacional: string | null;
  centroDeCusto: string | null;
}

export interface DrakeTimesheetPlanDay {
  data: string;
  evento: "Embarque" | "Dobra";
  bsp: string | null;
}

export interface DrakeTimesheetPlan {
  sourceEventKey: string;
  workerKey: string;
  unidadeOperacional: string | null;
  centroDeCusto: string | null;
  dataInicio: string;
  dataFim: string;
  days: DrakeTimesheetPlanDay[];
}

export interface AnnualPositionSnapshotOptions {
  /** P só representa programação futura; hoje e passado nunca entram no espelho. */
  asOfDate?: string;
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

/**
 * Converte a ficha diária do Drake em períodos contíguos usados pela grade do Histograma.
 * A identidade do trabalhador continua empresa + matrícula para reutilizar os registros já
 * existentes; o UUID do Drake participa somente da chave imutável dos eventos.
 */
export function buildAnnualPositionSnapshot(
  rows: AnnualPositionWorkerRow[],
  options: AnnualPositionSnapshotOptions = {},
): DrakeHistogramSnapshot {
  const consolidatedRows = consolidateAnnualPositionRows(rows);
  const workers = consolidatedRows.map((row) => ({
    workerKey: buildWorkerKey(row.empresa, row.matricula),
    matricula: row.matricula,
    nome: row.nome,
    empresa: row.empresa,
    funcao: row.funcao,
    funcaoOperacao: row.funcaoOperacao,
  }));
  const periods: DrakePeriodSnapshotRow[] = [];

  for (const row of consolidatedRows) {
    const workerKey = buildWorkerKey(row.empresa, row.matricula);
    const days = [...row.positions].sort((left, right) => left.date.localeCompare(right.date));
    let current: DrakePeriodSnapshotRow | null = null;

    for (const day of days) {
      assertPeriod(day.date, day.date, day.occurrenceDescription, workerKey);
      const tipo = mapAnnualPositionType(
        day.occurrenceAcronym,
        day.occurrenceDescription,
        day.occurrenceType,
      );
      if (tipo === "P" && options.asOfDate && day.date <= options.asOfDate) {
        current = null;
        continue;
      }
      const unidade = day.unidadeOperacional?.trim() || null;
      const centro = day.centroDeCusto?.trim() || null;
      const fingerprint = stableKey([
        tipo,
        unidade,
        centro,
      ]);
      const currentFingerprint = current
        ? stableKey([
            current.tipo,
            current.unidadeOperacional,
            current.centroDeCusto,
          ])
        : null;

      if (current && addIsoDay(current.dataFim, 1) === day.date && fingerprint === currentFingerprint) {
        current.dataFim = day.date;
        current.dias = inclusiveDays(current.dataInicio, current.dataFim);
        continue;
      }

      current = {
        eventKey: stableKey(["drake-annual-position", row.drakeWorkerId, day.date]),
        workerKey,
        unidadeOperacional: unidade,
        centroDeCusto: centro,
        tipo,
        dataInicio: day.date,
        dataFim: day.date,
        dias: 1,
        sourceEventName: day.occurrenceDescription,
      };
      periods.push(current);
    }
  }

  return {
    source: "drake",
    workers: buildWorkers(workers.map((worker) => ({ ...worker, referenceDate: "9999-12-31" }))),
    periods: deduplicatePeriods(periods),
  };
}

/**
 * Monta os embarques do Timesheet exclusivamente com os dias E/D já
 * informados pela Ficha Anual. Não completa calendário nem infere Dobra.
 */
export function buildDrakeTimesheetPlans(
  snapshot: DrakeHistogramSnapshot,
): DrakeTimesheetPlan[] {
  const sourceDays = snapshot.periods
    .filter((period) => period.tipo === "E" || period.tipo === "DB")
    .flatMap((period) =>
      datesInRange(period.dataInicio, period.dataFim).map((data) => ({
        workerKey: period.workerKey,
        unidadeOperacional: normalizedNullable(period.unidadeOperacional),
        centroDeCusto: normalizedNullable(period.centroDeCusto),
        data,
        evento: period.tipo === "DB" ? ("Dobra" as const) : ("Embarque" as const),
      })),
    )
    .sort(
      (left, right) =>
        left.workerKey.localeCompare(right.workerKey) || left.data.localeCompare(right.data),
    );

  const plans: DrakeTimesheetPlan[] = [];
  let current: DrakeTimesheetPlan | null = null;

  for (const day of sourceDays) {
    const continuesCurrent =
      current &&
      current.workerKey === day.workerKey &&
      addIsoDay(current.dataFim, 1) === day.data &&
      normalizeIdentityPart(current.unidadeOperacional) ===
        normalizeIdentityPart(day.unidadeOperacional) &&
      normalizeIdentityPart(current.centroDeCusto) ===
        normalizeIdentityPart(day.centroDeCusto);

    if (!continuesCurrent) {
      current = {
        sourceEventKey: stableKey(["drake-timesheet", day.workerKey, day.data]),
        workerKey: day.workerKey,
        unidadeOperacional: day.unidadeOperacional,
        centroDeCusto: day.centroDeCusto,
        dataInicio: day.data,
        dataFim: day.data,
        days: [],
      };
      plans.push(current);
    }

    if (!current) {
      throw new Error("Não foi possível montar o timesheet da Ficha Anual do Drake.");
    }

    if (current.days.some((existing) => existing.data === day.data)) {
      throw new Error(
        `A Ficha Anual do Drake possui mais de um evento de timesheet em ${day.data}.`,
      );
    }

    current.dataFim = day.data;
    current.days.push({
      data: day.data,
      evento: day.evento,
      bsp: day.centroDeCusto,
    });
  }

  return plans;
}

interface AnnualPositionWorkerGroup {
  workerKey: string;
  drakeWorkerIds: Set<string>;
  matricula: string;  nome: string;
  empresa: string;
  funcao: string | null;
  funcaoOperacao: string | null;
  positionsByDate: Map<string, AnnualPositionDayRow>;
}

/**
 * O Worker Dashboard pode devolver mais de um UUID do Drake para a mesma identidade de negócio
 * (empresa + matrícula). A grade possui um único colaborador para essa identidade, portanto as
 * fichas idênticas são consolidadas antes de gerar períodos. Divergências no mesmo dia cancelam
 * a sincronização antes de qualquer escrita no banco.
 */
function consolidateAnnualPositionRows(
  rows: AnnualPositionWorkerRow[],
): AnnualPositionWorkerRow[] {
  const groups = new Map<string, AnnualPositionWorkerGroup>();
  const orderedRows = [...rows].sort((left, right) =>
    left.drakeWorkerId.localeCompare(right.drakeWorkerId),
  );

  for (const row of orderedRows) {
    const workerKey = buildWorkerKey(row.empresa, row.matricula);
    let group = groups.get(workerKey);
    if (!group) {
      group = {
        workerKey,
        drakeWorkerIds: new Set<string>(),
        matricula: row.matricula,        nome: row.nome,
        empresa: row.empresa,
        funcao: row.funcao,
        funcaoOperacao: row.funcaoOperacao,
        positionsByDate: new Map<string, AnnualPositionDayRow>(),
      };
      groups.set(workerKey, group);
    }

    group.drakeWorkerIds.add(row.drakeWorkerId);
    const selectedWorkerName = [group.nome, row.nome]
      .filter((name) => normalizeIdentityPart(name).length > 0)
      .sort((left, right) => {
        const normalizedComparison = normalizeIdentityPart(left).localeCompare(
          normalizeIdentityPart(right),
        );
        if (normalizedComparison !== 0) return normalizedComparison;
        return left.localeCompare(right);
      })[0];

    if (selectedWorkerName) group.nome = selectedWorkerName;
    if (!group.funcao && row.funcao) group.funcao = row.funcao;
    if (!group.funcaoOperacao && row.funcaoOperacao) group.funcaoOperacao = row.funcaoOperacao;

    for (const day of row.positions) {
      const existing = group.positionsByDate.get(day.date);
      if (!existing) {
        group.positionsByDate.set(day.date, { ...day });
        continue;
      }
      if (annualPositionDayFingerprint(existing) !== annualPositionDayFingerprint(day)) {
        throw new Error(
          `O Drake devolveu posições conflitantes para ${row.empresa}/${row.matricula} em ${day.date}. O banco não foi alterado.`,
        );
      }
    }
  }

  return [...groups.values()]
    .map((group) => ({
      drakeWorkerId: [...group.drakeWorkerIds].sort()[0]!,
      matricula: group.matricula,
      nome: group.nome,
      empresa: group.empresa,
      funcao: group.funcao,
      funcaoOperacao: group.funcaoOperacao,
      positions: [...group.positionsByDate.values()].sort((left, right) =>
        left.date.localeCompare(right.date),
      ),
    }))
    .sort((left, right) =>
      buildWorkerKey(left.empresa, left.matricula).localeCompare(
        buildWorkerKey(right.empresa, right.matricula),
      ),
    );
}

function annualPositionDayFingerprint(day: AnnualPositionDayRow): string {
  return stableKey([
    day.occurrenceAcronym,
    day.occurrenceDescription,
    day.occurrenceType,
    day.unidadeOperacional,
    day.centroDeCusto,
  ]);
}

export interface AnnualPositionOccurrenceCatalogItem {
  acronym: string;
  description: string;
  occurrenceType: string | null;
  mappedType: string | null;
  mapped: boolean;
  count: number;
}

export interface AnnualPositionOccurrenceCatalog {
  all: AnnualPositionOccurrenceCatalogItem[];
  unknown: AnnualPositionOccurrenceCatalogItem[];
}

export function catalogAnnualPositionOccurrences(
  rows: AnnualPositionWorkerRow[],
): AnnualPositionOccurrenceCatalog {
  const byKey = new Map<
    string,
    {
      acronym: string;
      description: string;
      occurrenceType: string | null;
      count: number;
    }
  >();

  for (const worker of rows) {
    for (const position of worker.positions) {
      const acronym =
        position.occurrenceAcronym?.trim() ?? "";

      const description =
        position.occurrenceDescription?.trim() ?? "";

      const occurrenceType =
        position.occurrenceType?.trim() || null;

      const key = JSON.stringify([
        acronym,
        description,
        occurrenceType,
      ]);

      const current = byKey.get(key);

      if (current) {
        current.count += 1;
        continue;
      }

      byKey.set(key, {
        acronym,
        description,
        occurrenceType,
        count: 1,
      });
    }
  }

  const all: AnnualPositionOccurrenceCatalogItem[] = [];

  for (const item of byKey.values()) {
    let mappedType: string | null = null;
    let mapped = true;

    try {
      mappedType = mapAnnualPositionType(
        item.acronym,
        item.description,
        item.occurrenceType,
      );
    } catch {
      mapped = false;
    }

    all.push({
      ...item,
      mappedType,
      mapped,
    });
  }

  all.sort(
    (left, right) =>
      left.acronym.localeCompare(right.acronym) ||
      left.description.localeCompare(right.description) ||
      (left.occurrenceType ?? "").localeCompare(
        right.occurrenceType ?? "",
      ),
  );

  return {
    all,
    unknown: all.filter((item) => !item.mapped),
  };
}

export function mapAnnualPositionType(
  acronym: string,
  description: string,
  occurrenceType: string | null,
): string {
  const code = normalizeIdentityPart(acronym);
  const text = normalizeIdentityPart(`${description} ${occurrenceType ?? ""}`);

  if (!code) {
    throw new Error(
      `Ficha Anual do Drake retornou ocorrência sem sigla: "${description}". ` +
      "A sincronização foi interrompida para não inventar um status.",
    );
  }

  switch (code) {
    case "P":
      return "P";

    case "E":
      return "E";

    case "D":
    case "DB":
      return "DB";

    case "F":
      return "F";

    case "FE":
      return "FE";

    case "STB":
      return "STB";

    case "AFA":
      return "AFA";

    case "AT":
      return "AT";

    case "LM":
      return "LM";

    case "LMV":
      return "LMV";

    case "TR":
      return "TR";

    case "AD":
      return "AD";

    case "DDN":
      return "DDN";

    case "DES":
      return "DES";

    case "TE":
      return "TE";

    case "DI":
      return "DI";

    case "FI":
      return "FI";

    case "FIH":
      return "FIH";

    case "FIF":
      return "FIF";

    case "FIC":
      return "FIC";

    case "FIT":
      return "FIT";

    case "FT":
      return "FT";

    case "NS":
      return "NS";

    case "H":
    case "HTL":
      return "HTL";

    case "EC":
      return text.includes("EMBARQUE CANCELADO") ? "CANC" : "EC";

    case "CANC":
      return "CANC";

    default:
      throw new Error(
        `Ocorrência da Ficha Anual do Drake sem mapeamento: ` +
        `sigla="${acronym}", descrição="${description}", tipo="${occurrenceType ?? ""}". ` +
        "A sincronização foi interrompida para preservar o espelho exato do Drake.",
      );
  }
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

function addIsoDay(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addIsoDay(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function normalizedNullable(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
