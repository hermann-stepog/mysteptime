import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import {
  fetchDrakeWorkers,
  fetchAnnualPositionsForWorkers,
} from "./worker-annual-position-api.server";
import {
  buildAnnualPositionSnapshot,
  buildWorkerKey,
  type AnnualPositionWorkerRow,
} from "@/lib/histograma/drake-snapshot";
import { importAnnualPositionSnapshot } from "@/lib/histograma/import-annual-position.server";
import { normalizeUnidadeOperacional } from "@/lib/histogramaNovo";
import { createTimesheetForNewPeriodIfAbsent } from "@/lib/timesheetAutoGen";
import { filterWorkersWithEmbarkationHistory } from "./annual-position-eligibility";

export interface AnnualPositionSyncProgress {
  completedWorkers: number;
  totalWorkers: number;
}

export interface AnnualPositionSyncResult {
  createdWorkers: number;
  updatedWorkers: number;
  synchronizedEvents: number;
  removedStaleEvents: number;
  preservedExistingEvents: number;
  skippedExistingDays: number;
  processedWorkers: number;
}

export interface AnnualPositionSyncHooks {
  onWorkersLoaded?: (totalWorkers: number) => void | Promise<void>;
  onWorkerProgress?: (progress: AnnualPositionSyncProgress) => void | Promise<void>;
  onPositionsLoaded?: () => void | Promise<void>;
  onBeforeDatabaseSync?: () => void | Promise<void>;
}

export async function synchronizeCurrentDrakeAnnualPositions(
  db: SupabaseClient,
  http: DrakeHttpClient,
  year: number,
  cutoffDate: string,
  hooks: AnnualPositionSyncHooks = {},
): Promise<AnnualPositionSyncResult> {
  const activeWorkers = await fetchDrakeWorkers(http);

  // Congelado antes de qualquer gravacao desta execucao.
  // Um E criado agora nunca torna outro colaborador elegivel.
  const eligibleWorkerKeys = await loadEligibleWorkerKeys(db);

  const workers = filterWorkersWithEmbarkationHistory(
    activeWorkers,
    eligibleWorkerKeys,
  );

  await hooks.onWorkersLoaded?.(workers.length);
  const annualPositions = await fetchAnnualPositionsForWorkers(
    http,
    workers,
    year,
    (completedWorkers, totalWorkers) =>
      hooks.onWorkerProgress?.({ completedWorkers, totalWorkers }),
  );
  await hooks.onPositionsLoaded?.();

  const sourceRows: AnnualPositionWorkerRow[] = annualPositions.map(
    ({ worker, positions, schedules }) => ({
      drakeWorkerId: worker.id,
      matricula: worker.registration,
      nome: worker.name,
      empresa: worker.companyName,
      funcao: worker.jobDescription,
      funcaoOperacao: worker.payrollJobName,
      positions: positions.map((position) => {
        const schedule = scheduleForDate(schedules, position.Date);
        return {
          date: position.Date,
          occurrenceAcronym: position.OccurrenceAcronym,
          occurrenceDescription: position.OccurrenceDescription,
          occurrenceType: position.OccurrenceType,
          unidadeOperacional: normalizeUnidadeOperacional(
            optionalString(position.Details?.Uop) ?? schedule?.DestinationDescription,
          ),
          // Contract na ficha anual é o cliente, não o centro de custo. O centro de custo
          // exibido no Histograma vem da programação logística do mesmo colaborador.
          centroDeCusto: schedule?.CostCenterDescription ?? null,
        };
      }),
    }),
  );
  const snapshot = buildAnnualPositionSnapshot(sourceRows);
  await hooks.onBeforeDatabaseSync?.();
  const result = await importAnnualPositionSnapshot(db, snapshot, {
    startDate: cutoffDate,
    endDate: `${year}-12-31`,
  });

  const workerByKey = new Map(snapshot.workers.map((worker) => [worker.workerKey, worker]));
  for (const period of result.insertedPeriods) {
    if (period.tipo !== "E") continue;
    const worker = workerByKey.get(period.workerKey);
    if (!worker) {
      throw new Error("O Drake devolveu um novo embarque sem colaborador correspondente.");
    }
    await createTimesheetForNewPeriodIfAbsent(db, {
      colaboradorId: period.colaboradorId,
      periodoId: period.id,
      unidadeOperacional: period.unidadeOperacional,
      bsp: period.centroDeCusto,
      funcaoEmbarque: worker.funcao || worker.funcaoOperacao || "—",
      dataInicio: period.dataInicio,
      dataFim: period.dataFim,
    });
  }

  return {
    createdWorkers: result.createdWorkers,
    updatedWorkers: result.updatedWorkers,
    synchronizedEvents: result.synchronizedEvents,
    removedStaleEvents: result.removedStaleEvents,
    preservedExistingEvents: result.preservedExistingEvents,
    skippedExistingDays: result.skippedExistingDays,
    processedWorkers: workers.length,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scheduleForDate<T extends { Date: string; Type: string }>(
  schedules: T[],
  date: string,
): T | null {
  let current: T | null = null;
  for (const schedule of schedules) {
    if (schedule.Date > date) break;
    current = schedule;
  }
  return current && normalize(current.Type) === "TRABALHO" ? current : null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

async function loadEligibleWorkerKeys(
  db: SupabaseClient,
): Promise<Set<string>> {
  const collaboratorIds = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("hist_novo_periodos")
      .select("colaborador_id")
      .eq("tipo", "E")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      colaborador_id: string | null;
    }>;

    for (const row of rows) {
      if (row.colaborador_id) {
        collaboratorIds.add(row.colaborador_id);
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const eligibleWorkerKeys = new Set<string>();
  const ids = [...collaboratorIds];

  for (const batch of chunkEligibilityIds(ids, 200)) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("empresa, matricula")
      .in("id", batch);

    if (error) throw error;

    const workers = (data ?? []) as Array<{
      empresa: string | null;
      matricula: string | null;
    }>;

    for (const worker of workers) {
      if (!worker.empresa?.trim() || !worker.matricula?.trim()) {
        continue;
      }

      eligibleWorkerKeys.add(
        buildWorkerKey(worker.empresa, worker.matricula),
      );
    }
  }

  return eligibleWorkerKeys;
}

function chunkEligibilityIds<T>(
  values: T[],
  size: number,
): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}
