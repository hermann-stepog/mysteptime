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
 * Importação autoritativa da ficha anual.
 *
 * Regras de sincronização:
 * - colaboradores existentes não são sobrescritos;
 * - períodos locais permanecem armazenados para auditoria, mas nunca bloqueiam o Drake;
 * - períodos antigos de origem Drake/Disponibilidade são substituídos pela Ficha Anual atual;
 * - a grade resolve o Drake primeiro; somente programação futura pode sobrepô-lo visualmente;
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

  // A Ficha Anual é a fonte autoritativa. Períodos locais permanecem no banco
  // para auditoria, mas não podem retirar nenhum dia do snapshot do Drake.
  const { replaceableAutomatic, protectedExisting } =
    partitionAnnualPositionExistingPeriods(existing);

  const plan = planAppendOnlyPeriods(protectedExisting, desired);
  const synchronizedEventKeys = new Set(plan.inserts.map(({ row }) => row.drake_event_key));
  const staleAutomatic = selectStaleAutomaticPeriods(replaceableAutomatic, synchronizedEventKeys);

  const insertedPeriods: InsertedAnnualPositionPeriod[] = [];
  for (const batch of chunk(plan.inserts, 400)) {
    const { data, error } = await db
      .from("hist_novo_periodos")
      .upsert(
        batch.map(({ row }) => toDatabasePeriodRow(row)),
        {
          onConflict: "drake_event_key",
        },
      )
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
 * Planeja o espelho completo do Drake. Registros locais podem continuar armazenados,
 * porém não retiram, dividem nem substituem dias da fonte autoritativa.
 */
export function planAppendOnlyPeriods(
  _existing: ExistingProtectedPeriod[],
  desired: DesiredDatabasePeriod[],
): AnnualPositionAppendPlan {
  const inserts: PlannedInsert[] = [];

  for (const target of [...desired].sort(compareDesiredPeriods)) {
    const eventKey = segmentEventKey(target.eventKey, target.data_inicio, target.data_fim);
    const row: DesiredDatabasePeriod = {
      ...target,
      eventKey,
      drake_event_key: eventKey,
    };
    inserts.push({ eventKey, workerKey: row.workerKey, row });
  }

  return {
    inserts,
    preservedExistingEvents: 0,
    skippedExistingDays: 0,
  };
}

export function mapExistingAnnualWorkers(
  workers: DrakeHistogramSnapshot["workers"],
  existing: HistNovoColaborador[],
): Map<string, string> {
  const existingByWorkerKey = mapWorkersByKey(existing);
  const collaboratorIdByWorkerKey = new Map<string, string>();

  for (const worker of workers) {
    const existingWorker = existingByWorkerKey.get(worker.workerKey);

    // Não cria colaborador: empresa + matrícula precisam existir no Histograma.
    if (!existingWorker) {
      continue;
    }

    collaboratorIdByWorkerKey.set(worker.workerKey, existingWorker.id);
  }

  return collaboratorIdByWorkerKey;
}

async function mapExistingWorkersOnly(db: SupabaseClient, snapshot: DrakeHistogramSnapshot) {
  const matriculas = [...new Set(snapshot.workers.map((worker) => worker.matricula))];

  const existing = await loadWorkersByRegistrations(db, matriculas);

  const collaboratorIdByWorkerKey = mapExistingAnnualWorkers(snapshot.workers, existing);

  return {
    createdWorkers: 0,
    collaboratorIdByWorkerKey,
  };
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
      .eq("ativo", true)
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

export function partitionAnnualPositionExistingPeriods(periods: ExistingProtectedPeriod[]): {
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
    (period) => !period.drake_event_key || !synchronizedEventKeys.has(period.drake_event_key),
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

async function deleteHistogramPeriodsByIds(db: SupabaseClient, periodIds: string[]): Promise<void> {
  for (const ids of chunk(periodIds, BATCH_SIZE)) {
    const { error } = await db.from("hist_novo_periodos").delete().in("id", ids);

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

interface DateInterval {
  startDate: string;
  endDate: string;
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
