import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTipoPeriodo, type HistNovoColaborador } from "@/lib/histogramaNovo";
import { selectAllPages } from "@/lib/supabasePaginate";
import {
  buildWorkerKey,
  type DrakeHistogramSnapshot,
  type DrakePeriodSnapshotRow,
} from "./drake-snapshot";

export interface AnnualPositionImportWindow {
  /** Primeiro dia que a nova sincronização pode criar. Nada anterior é alterado. */
  startDate: string;
  endDate: string;
}

export interface InsertedAnnualPositionPeriod {
  id: string;
  eventKey: string;
  workerKey: string;
  colaboradorId: string;
  unidadeOperacional: string | null;
  centroDeCusto: string | null;
  tipo: string;
  dataInicio: string;
  dataFim: string;
  dias: number;
}

export interface AnnualPositionImportResult {
  createdWorkers: number;
  /** Sempre zero: colaboradores já existentes são imutáveis neste fluxo. */
  updatedWorkers: number;
  /** Quantidade de novos períodos realmente inseridos. */
  synchronizedEvents: number;
  /** Sempre zero: este fluxo nunca remove períodos existentes. */
  removedStaleEvents: number;
  /** Quantidade de períodos desejados total ou parcialmente bloqueados por dados já existentes. */
  preservedExistingEvents: number;
  skippedExistingDays: number;
  insertedPeriods: InsertedAnnualPositionPeriod[];
  collaboratorIdByWorkerKey: Map<string, string>;
}

export interface ExistingProtectedPeriod {
  id: string;
  colaborador_id: string;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  origem: string | null;
  drake_event_key?: string | null;
}

export interface DesiredDatabasePeriod {
  eventKey: string;
  workerKey: string;
  colaborador_id: string;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  bsp: null;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  dias: number;
  origem: "drake";
  drake_event_key: string;
}

export interface PlannedInsert {
  eventKey: string;
  workerKey: string;
  row: DesiredDatabasePeriod;
}

export interface AnnualPositionAppendPlan {
  inserts: PlannedInsert[];
  preservedExistingEvents: number;
  skippedExistingDays: number;
}

const BATCH_SIZE = 300;

/**
 * Importação append-only da ficha anual.
 *
 * Regras de sincronização:
 * - colaboradores existentes não são sobrescritos;
 * - períodos manual/programado/base e demais origens não automáticas são preservados;
 * - períodos antigos de origem Drake/Disponibilidade são substituídos pela Ficha Anual atual;
 * - novos períodos nunca ocupam dias protegidos por lançamentos não automáticos;
 * - uma segunda execução com o mesmo snapshot mantém o resultado idempotente. *
 * A exclusão mútua usada pela rota/scheduler continua sendo o lock em memória já existente.
 * Sem uma constraint única no banco não existe garantia distribuída entre réplicas, portanto
 * esta função não promete algo que o schema atual não consegue assegurar.
 */
export async function importAnnualPositionSnapshot(
  db: SupabaseClient,
  snapshot: DrakeHistogramSnapshot,
  window: AnnualPositionImportWindow,
): Promise<AnnualPositionImportResult> {
  validateWindow(window);
  validateSnapshot(snapshot);
  validateSnapshotPeriodsDoNotOverlap(snapshot.periods);

  const workerSync = await mapExistingWorkersOnly(db, snapshot);
  const desired = buildDesiredPeriods(snapshot, workerSync.collaboratorIdByWorkerKey, window);
  validateDesiredPeriodsDoNotOverlap(desired);

  // Nenhum colaborador elegível = nenhuma alteração no banco.
  // Em especial, um E presente apenas no snapshot atual não pode criar
  // elegibilidade durante esta mesma execução.
  if (workerSync.collaboratorIdByWorkerKey.size === 0) {
    return {
      createdWorkers: 0,
      updatedWorkers: 0,
      synchronizedEvents: 0,
      removedStaleEvents: 0,
      preservedExistingEvents: 0,
      skippedExistingDays: 0,
      insertedPeriods: [],
      collaboratorIdByWorkerKey: workerSync.collaboratorIdByWorkerKey,
    };
  }

  const collaboratorIds = [...new Set(workerSync.collaboratorIdByWorkerKey.values())];
  const existing = await loadProtectedExistingPeriods(db, collaboratorIds, window);

  // A Ficha Anual é a fonte autoritativa para os dados automáticos.
  // Períodos antigos vindos de Drake/Disponibilidade serão substituídos pelo snapshot novo.
  // Manual/programado/base e qualquer outra origem continuam protegidos.
  const { replaceableAutomatic, protectedExisting } =
    partitionAnnualPositionExistingPeriods(existing);

  const plan = planAppendOnlyPeriods(protectedExisting, desired);
  const synchronizedEventKeys = new Set(
    plan.inserts.map(({ row }) => row.drake_event_key),
  );
  const staleAutomatic = selectStaleAutomaticPeriods(
    replaceableAutomatic,
    synchronizedEventKeys,
  );

  const insertedPeriods: InsertedAnnualPositionPeriod[] = [];
  for (const batch of chunk(plan.inserts, 400)) {
    const { data, error } = await db
      .from("hist_novo_periodos")
      .upsert(batch.map(({ row }) => toDatabasePeriodRow(row)), {
        onConflict: "drake_event_key",
      })
      .select(
        "id, colaborador_id, unidade_operacional, centro_de_custo, tipo, data_inicio, data_fim",
      );
    if (error) throw error;

    const returned = (data ?? []) as Array<{
      id: string;
      colaborador_id: string;
      unidade_operacional: string | null;
      centro_de_custo: string | null;
      tipo: string;
      data_inicio: string;
      data_fim: string;
    }>;
    const idByKey = new Map(returned.map((row) => [databasePeriodKey(row), row.id]));

    for (const item of batch) {
      const id = idByKey.get(databasePeriodKey(item.row));
      if (!id) {
        throw new Error(
          "O banco não confirmou a criação de todos os novos períodos da ficha anual.",
        );
      }
      insertedPeriods.push({
        id,
        eventKey: item.eventKey,
        workerKey: item.workerKey,
        colaboradorId: item.row.colaborador_id,
        unidadeOperacional: item.row.unidade_operacional,
        centroDeCusto: item.row.centro_de_custo,
        tipo: item.row.tipo,
        dataInicio: item.row.data_inicio,
        dataFim: item.row.data_fim,
        dias: item.row.dias,
      });
    }
  }

  // IMPORTANTE:
  // só chegamos aqui depois que TODOS os novos períodos foram inseridos e confirmados.
  // O timesheet não é apagado: apenas perde a referência ao período automático antigo.
  // periodo_id já é opcional e o sistema também resolve embarques por sobreposição de datas.
  const oldAutomaticIds = staleAutomatic.map((period) => period.id);

  await unlinkTimesheetsFromPeriodIds(db, oldAutomaticIds);
  await deleteHistogramPeriodsByIds(db, oldAutomaticIds);

  return {
    createdWorkers: workerSync.createdWorkers,
    updatedWorkers: 0,
    synchronizedEvents: insertedPeriods.length,
    removedStaleEvents: staleAutomatic.length,
    preservedExistingEvents: plan.preservedExistingEvents,
    skippedExistingDays: plan.skippedExistingDays,
    insertedPeriods,
    collaboratorIdByWorkerKey: workerSync.collaboratorIdByWorkerKey,
  };
}

/**
 * Planeja somente inserts. Todo dia já coberto por qualquer período existente fica congelado.
 * Um período novo pode ser dividido em dois ou mais trechos para preencher apenas lacunas.
 */
export function planAppendOnlyPeriods(
  existing: ExistingProtectedPeriod[],
  desired: DesiredDatabasePeriod[],
): AnnualPositionAppendPlan {
  // Programacao local precisa continuar armazenada para auditoria,
  // mas NAO pode impedir a Ficha Anual do Drake de registrar o que
  // realmente aconteceu naquele dia.
  //
  // Primeiro dia programado:
  //   tipo=P, normalmente origem=manual
  //
  // Continuacao da programacao:
  //   tipo=E, origem=programado
  //
  // Ambos permanecem no banco, mas nao contam como cobertura que
  // bloqueia a insercao do snapshot autoritativo do Drake.
  const blockingExisting = existing.filter((period) => {
    const origem = (period.origem ?? "").trim().toLowerCase();

    const isProgramming =
      period.tipo === "P" ||
      (period.tipo === "E" && origem === "programado");

    return !isProgramming;
  });

  const coverageByCollaborator =
    buildCoverageByCollaborator(blockingExisting);
  const inserts: PlannedInsert[] = [];
  let preservedExistingEvents = 0;
  let skippedExistingDays = 0;

  for (const target of [...desired].sort(compareDesiredPeriods)) {
    const coverage = coverageByCollaborator.get(target.colaborador_id) ?? [];
    const uncovered = subtractCoverage(target.data_inicio, target.data_fim, coverage);
    const desiredDays = inclusiveDays(target.data_inicio, target.data_fim);
    const uncoveredDays = uncovered.reduce(
      (total, interval) => total + inclusiveDays(interval.startDate, interval.endDate),
      0,
    );

    if (uncoveredDays < desiredDays) {
      preservedExistingEvents += 1;
      skippedExistingDays += desiredDays - uncoveredDays;
    }

    for (const interval of uncovered) {
      const eventKey = segmentEventKey(
        target.eventKey,
        interval.startDate,
        interval.endDate,
      );
      const row: DesiredDatabasePeriod = {
        ...target,
        eventKey,
        drake_event_key: eventKey,
        data_inicio: interval.startDate,
        data_fim: interval.endDate,
        dias: inclusiveDays(interval.startDate, interval.endDate),
      };
      inserts.push({ eventKey: row.eventKey, workerKey: row.workerKey, row });
      addCoverage(coverage, interval.startDate, interval.endDate);
      coverageByCollaborator.set(target.colaborador_id, coverage);
    }
  }

  return { inserts, preservedExistingEvents, skippedExistingDays };
}

export function mapEligibleExistingAnnualWorkers(
  workers: DrakeHistogramSnapshot["workers"],
  existing: HistNovoColaborador[],
  collaboratorIdsWithExistingEmbarkation: ReadonlySet<string>,
): Map<string, string> {
  const existingByWorkerKey = mapWorkersByKey(existing);
  const collaboratorIdByWorkerKey = new Map<string, string>();

  for (const worker of workers) {
    const existingWorker = existingByWorkerKey.get(worker.workerKey);

    // Regra de elegibilidade:
    // - não cria colaborador;
    // - empresa + matrícula precisam existir no Histograma;
    // - o colaborador precisa possuir pelo menos um E que JÁ existia no banco
    //   antes desta sincronização.
    if (
      !existingWorker ||
      !collaboratorIdsWithExistingEmbarkation.has(existingWorker.id)
    ) {
      continue;
    }

    collaboratorIdByWorkerKey.set(worker.workerKey, existingWorker.id);
  }

  return collaboratorIdByWorkerKey;
}

async function mapExistingWorkersOnly(
  db: SupabaseClient,
  snapshot: DrakeHistogramSnapshot,
) {
  const matriculas = [
    ...new Set(snapshot.workers.map((worker) => worker.matricula)),
  ];

  const existing = await loadWorkersByRegistrations(db, matriculas);

  // Esta consulta acontece ANTES de buildDesiredPeriods e antes de qualquer INSERT
  // da sincronização. Portanto, somente um E que já existia previamente pode
  // estabelecer elegibilidade.
  const collaboratorIdsWithExistingEmbarkation =
    await loadCollaboratorIdsWithExistingEmbarkation(
      db,
      existing.map((worker) => worker.id),
    );

  const collaboratorIdByWorkerKey = mapEligibleExistingAnnualWorkers(
    snapshot.workers,
    existing,
    collaboratorIdsWithExistingEmbarkation,
  );

  return {
    createdWorkers: 0,
    collaboratorIdByWorkerKey,
  };
}

export async function loadCollaboratorIdsWithExistingEmbarkation(
  db: SupabaseClient,
  collaboratorIds: string[],
): Promise<Set<string>> {
  const eligible = new Set<string>();

  if (collaboratorIds.length === 0) {
    return eligible;
  }

  // O Supabase/PostgREST limita a quantidade de linhas devolvidas por request.
  // Como existem mais de 1000 períodos E, consultar tudo sem paginação pode
  // omitir colaboradores perfeitamente elegíveis.
  const pageSize = 1000;

  for (const ids of chunk(collaboratorIds, BATCH_SIZE)) {
    let from = 0;

    while (true) {
      const { data, error } = await db
        .from("hist_novo_periodos")
        .select("id, colaborador_id")
        .in("colaborador_id", ids)
        .eq("tipo", "E")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const rows = (data ?? []) as Array<{
        id: string;
        colaborador_id: string | null;
      }>;

      for (const row of rows) {
        if (row.colaborador_id) {
          eligible.add(row.colaborador_id);
        }
      }

      if (rows.length < pageSize) {
        break;
      }

      from += pageSize;
    }
  }

  return eligible;
}
async function loadWorkersByRegistrations(
  db: SupabaseClient,
  registrations: string[],
): Promise<HistNovoColaborador[]> {
  const workers: HistNovoColaborador[] = [];
  for (const batch of chunk(registrations, BATCH_SIZE)) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("id, matricula, nome, empresa, funcao, funcao_operacao")
      .in("matricula", batch);
    if (error) throw error;
    workers.push(...((data ?? []) as HistNovoColaborador[]));
  }
  return workers;
}

function mapWorkersByKey(workers: HistNovoColaborador[]): Map<string, HistNovoColaborador> {
  const byKey = new Map<string, HistNovoColaborador>();
  for (const worker of workers) {
    if (!worker.empresa?.trim()) continue;
    const key = buildWorkerKey(worker.empresa, worker.matricula);
    if (byKey.has(key)) {
      throw new Error(
        `Há mais de um colaborador cadastrado para empresa e matrícula ${worker.empresa}/${worker.matricula}.`,
      );
    }
    byKey.set(key, worker);
  }
  return byKey;
}

function buildDesiredPeriods(
  snapshot: DrakeHistogramSnapshot,
  collaboratorIdByWorkerKey: ReadonlyMap<string, string>,
  window: AnnualPositionImportWindow,
): DesiredDatabasePeriod[] {
  const periods: DesiredDatabasePeriod[] = [];
  for (const period of snapshot.periods) {
    const collaboratorId = collaboratorIdByWorkerKey.get(period.workerKey);
    if (!collaboratorId) {
      throw new Error(
        `A ficha anual contém um evento sem colaborador correspondente (${period.workerKey}).`,
      );
    }
    const clipped = clipToWindow(period.dataInicio, period.dataFim, window);
    if (!clipped) continue;
    periods.push({
      eventKey: period.eventKey,
      workerKey: period.workerKey,
      colaborador_id: collaboratorId,
      unidade_operacional: normalizedNullable(period.unidadeOperacional),
      centro_de_custo: normalizedNullable(period.centroDeCusto),
      bsp: null,
      tipo: period.tipo,
      data_inicio: clipped.startDate,
      data_fim: clipped.endDate,
      dias: inclusiveDays(clipped.startDate, clipped.endDate),
      origem: "drake",
      drake_event_key: period.eventKey,
    });
  }
  return periods;
}

export function partitionAnnualPositionExistingPeriods(
  periods: ExistingProtectedPeriod[],
): {
  replaceableAutomatic: ExistingProtectedPeriod[];
  protectedExisting: ExistingProtectedPeriod[];
} {
  const replaceableAutomatic: ExistingProtectedPeriod[] = [];
  const protectedExisting: ExistingProtectedPeriod[] = [];

  for (const period of periods) {
    const origem = (period.origem ?? "").trim().toLowerCase();

    if (origem === "drake" || origem === "disponibilidade") {
      replaceableAutomatic.push(period);
    } else {
      protectedExisting.push(period);
    }
  }

  return { replaceableAutomatic, protectedExisting };
}

export function selectStaleAutomaticPeriods(
  periods: ExistingProtectedPeriod[],
  synchronizedEventKeys: ReadonlySet<string>,
): ExistingProtectedPeriod[] {
  return periods.filter(
    (period) =>
      !period.drake_event_key || !synchronizedEventKeys.has(period.drake_event_key),
  );
}

async function unlinkTimesheetsFromPeriodIds(
  db: SupabaseClient,
  periodIds: string[],
): Promise<void> {
  for (const ids of chunk(periodIds, BATCH_SIZE)) {
    const { error } = await db
      .from("timesheet_embarques")
      .update({ periodo_id: null })
      .in("periodo_id", ids);

    if (error) throw error;
  }
}

async function deleteHistogramPeriodsByIds(
  db: SupabaseClient,
  periodIds: string[],
): Promise<void> {
  for (const ids of chunk(periodIds, BATCH_SIZE)) {
    const { error } = await db
      .from("hist_novo_periodos")
      .delete()
      .in("id", ids);

    if (error) throw error;
  }
}

async function loadProtectedExistingPeriods(
  db: SupabaseClient,
  collaboratorIds: string[],
  window: AnnualPositionImportWindow,
): Promise<ExistingProtectedPeriod[]> {
  const rows: ExistingProtectedPeriod[] = [];
  for (const ids of chunk(collaboratorIds, 200)) {
    const page = await selectAllPages<ExistingProtectedPeriod>((from, to) =>
      db
        .from("hist_novo_periodos")
        .select(
          "id, colaborador_id, unidade_operacional, centro_de_custo, tipo, data_inicio, data_fim, origem, drake_event_key",
        )
        .in("colaborador_id", ids)
        .gte("data_fim", window.startDate)
        .lte("data_inicio", window.endDate)
        .order("data_inicio")
        .order("id")
        .range(from, to),
    );
    rows.push(...page);
  }
  return rows;
}

function buildCoverageByCollaborator(
  periods: ExistingProtectedPeriod[],
): Map<string, DateInterval[]> {
  const result = new Map<string, DateInterval[]>();
  for (const period of periods) {
    const coverage = result.get(period.colaborador_id) ?? [];
    addCoverage(coverage, period.data_inicio, period.data_fim);
    result.set(period.colaborador_id, coverage);
  }
  return result;
}

interface DateInterval {
  startDate: string;
  endDate: string;
}

function addCoverage(coverage: DateInterval[], startDate: string, endDate: string): void {
  coverage.push({ startDate, endDate });
  coverage.sort((left, right) => left.startDate.localeCompare(right.startDate));
  const merged: DateInterval[] = [];
  for (const interval of coverage) {
    const last = merged.at(-1);
    if (!last || addIsoDay(last.endDate, 1) < interval.startDate) {
      merged.push({ ...interval });
    } else if (interval.endDate > last.endDate) {
      last.endDate = interval.endDate;
    }
  }
  coverage.splice(0, coverage.length, ...merged);
}

function subtractCoverage(
  startDate: string,
  endDate: string,
  coverage: DateInterval[],
): DateInterval[] {
  const result: DateInterval[] = [];
  let cursor = startDate;
  for (const interval of coverage) {
    if (interval.endDate < cursor) continue;
    if (interval.startDate > endDate) break;
    if (interval.startDate > cursor) {
      result.push({ startDate: cursor, endDate: addIsoDay(interval.startDate, -1) });
    }
    if (interval.endDate >= cursor) cursor = addIsoDay(interval.endDate, 1);
    if (cursor > endDate) break;
  }
  if (cursor <= endDate) result.push({ startDate: cursor, endDate });
  return result;
}

function validateSnapshotPeriodsDoNotOverlap(periods: DrakePeriodSnapshotRow[]): void {
  const byWorker = new Map<string, DrakePeriodSnapshotRow[]>();
  for (const period of periods) {
    const list = byWorker.get(period.workerKey) ?? [];
    list.push(period);
    byWorker.set(period.workerKey, list);
  }

  for (const list of byWorker.values()) {
    list.sort(
      (left, right) =>
        left.dataInicio.localeCompare(right.dataInicio) ||
        left.dataFim.localeCompare(right.dataFim) ||
        left.eventKey.localeCompare(right.eventKey),
    );
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1]!;
      const current = list[index]!;
      if (current.dataInicio <= previous.dataFim) {
        throw new Error(
          `A ficha anual contém períodos sobrepostos antes da gravação (${previous.dataInicio}–${previous.dataFim} e ${current.dataInicio}–${current.dataFim}). O banco não foi alterado.`,
        );
      }
    }
  }
}

function validateDesiredPeriodsDoNotOverlap(periods: DesiredDatabasePeriod[]): void {
  const byCollaborator = new Map<string, DesiredDatabasePeriod[]>();
  for (const period of periods) {
    const list = byCollaborator.get(period.colaborador_id) ?? [];
    list.push(period);
    byCollaborator.set(period.colaborador_id, list);
  }

  for (const list of byCollaborator.values()) {
    list.sort(compareDesiredPeriods);
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1]!;
      const current = list[index]!;
      if (current.data_inicio <= previous.data_fim) {
        throw new Error(
          `A ficha anual contém períodos sobrepostos para o mesmo colaborador (${previous.data_inicio}–${previous.data_fim} e ${current.data_inicio}–${current.data_fim}).`,
        );
      }
    }
  }
}

function compareDesiredPeriods(left: DesiredDatabasePeriod, right: DesiredDatabasePeriod): number {
  return (
    left.colaborador_id.localeCompare(right.colaborador_id) ||
    left.data_inicio.localeCompare(right.data_inicio) ||
    left.data_fim.localeCompare(right.data_fim) ||
    left.tipo.localeCompare(right.tipo) ||
    left.eventKey.localeCompare(right.eventKey)
  );
}

function toDatabasePeriodRow(period: DesiredDatabasePeriod) {
  return {
    colaborador_id: period.colaborador_id,
    unidade_operacional: period.unidade_operacional,
    centro_de_custo: period.centro_de_custo,
    bsp: period.bsp,
    tipo: period.tipo,
    data_inicio: period.data_inicio,
    data_fim: period.data_fim,
    dias: period.dias,
    origem: period.origem,
    drake_event_key: period.drake_event_key,
  };
}

function databasePeriodKey(period: {
  colaborador_id: string;
  unidade_operacional: string | null;
  centro_de_custo: string | null;
  tipo: string;
  data_inicio: string;
  data_fim: string;
}): string {
  return [
    period.colaborador_id,
    normalized(period.unidade_operacional),
    normalized(period.centro_de_custo),
    period.tipo,
    period.data_inicio,
    period.data_fim,
  ].join("|");
}

function segmentEventKey(eventKey: string, startDate: string, endDate: string): string {
  return `${eventKey}|SEGMENTO:${startDate}:${endDate}`;
}

function clipToWindow(
  startDate: string,
  endDate: string,
  window: AnnualPositionImportWindow,
): DateInterval | null {
  if (endDate < window.startDate || startDate > window.endDate) return null;
  return {
    startDate: startDate < window.startDate ? window.startDate : startDate,
    endDate: endDate > window.endDate ? window.endDate : endDate,
  };
}

function validateSnapshot(snapshot: DrakeHistogramSnapshot): void {
  if (snapshot.source !== "drake") {
    throw new Error("A importação da ficha anual recebeu uma origem inválida.");
  }
  if (snapshot.workers.length === 0) {
    throw new Error(
      "O Drake não devolveu colaboradores para a ficha anual. O banco não foi alterado.",
    );
  }
  if (snapshot.periods.length === 0) {
    throw new Error("O Drake não devolveu posições anuais. O banco não foi alterado.");
  }

  const workerKeys = new Set(snapshot.workers.map((worker) => worker.workerKey));
  const eventKeys = new Set<string>();
  for (const period of snapshot.periods) {
    if (!workerKeys.has(period.workerKey)) {
      throw new Error("A ficha anual contém um período sem trabalhador correspondente.");
    }
    if (eventKeys.has(period.eventKey)) {
      throw new Error("A ficha anual contém eventos duplicados. O banco não foi alterado.");
    }
    eventKeys.add(period.eventKey);
    validatePeriod(period);
  }
}

function validatePeriod(period: DrakePeriodSnapshotRow): void {
  if (!isTipoPeriodo(period.tipo)) {
    throw new Error(
      `A ficha anual contém um status não suportado pelo Histograma (${period.tipo}).`,
    );
  }
  if (
    !isIsoDate(period.dataInicio) ||
    !isIsoDate(period.dataFim) ||
    period.dataInicio > period.dataFim
  ) {
    throw new Error(
      `A ficha anual contém um período inválido (${period.dataInicio}–${period.dataFim}).`,
    );
  }
}

function validateWindow(window: AnnualPositionImportWindow): void {
  if (
    !isIsoDate(window.startDate) ||
    !isIsoDate(window.endDate) ||
    window.startDate > window.endDate
  ) {
    throw new Error("Janela inválida para a ficha anual do Drake.");
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizedNullable(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalized(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
}

function addIsoDay(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
