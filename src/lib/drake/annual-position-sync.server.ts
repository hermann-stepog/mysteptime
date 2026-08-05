import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import {
  fetchDrakeWorkers,
  fetchAnnualPositionsForWorkers,
} from "./worker-annual-position-api.server";
import {
  buildAnnualPositionSnapshot,
  type AnnualPositionWorkerRow,
} from "@/lib/histograma/drake-snapshot";
import { synchronizeDrakeAnnualPositionSnapshot } from "@/lib/histograma/drake-snapshot-sync.server";
import { normalizeUnidadeOperacional } from "@/lib/histogramaNovo";
import { ensureTimesheetParaPeriodo } from "@/lib/timesheetAutoGen";

export interface AnnualPositionSyncProgress {
  completedWorkers: number;
  totalWorkers: number;
}

export interface AnnualPositionSyncResult {
  createdWorkers: number;
  updatedWorkers: number;
  synchronizedEvents: number;
  removedStaleEvents: number;
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
  hooks: AnnualPositionSyncHooks = {},
): Promise<AnnualPositionSyncResult> {
  const workers = await fetchDrakeWorkers(http);
  await hooks.onWorkersLoaded?.(workers.length);
  const annualPositions = await fetchAnnualPositionsForWorkers(
    http,
    workers,
    year,
    (completedWorkers, totalWorkers) =>
      hooks.onWorkerProgress?.({ completedWorkers, totalWorkers }),
  );
  await hooks.onPositionsLoaded?.();

  const sourceRows: AnnualPositionWorkerRow[] = annualPositions.map(({ worker, positions, schedules }) => ({
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
        // Contract na ficha anual é o cliente, não o centro de custo. O campo correto vem da
        // programação logística exibida no mesmo dashboard do colaborador.
        centroDeCusto: schedule?.CostCenterDescription ?? null,
      };
    }),
  }));
  const snapshot = buildAnnualPositionSnapshot(sourceRows);
  await hooks.onBeforeDatabaseSync?.();
  const result = await synchronizeDrakeAnnualPositionSnapshot(db, snapshot, {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  });

  const workerByKey = new Map(snapshot.workers.map((worker) => [worker.workerKey, worker]));
  for (const period of snapshot.periods) {
    if (period.tipo !== "E") continue;
    const periodoId = result.periodIdByEventKey.get(period.eventKey);
    const worker = workerByKey.get(period.workerKey);
    if (!periodoId || !worker) {
      throw new Error("O banco não confirmou todos os embarques da ficha anual do Drake.");
    }
    await ensureTimesheetParaPeriodo(db, {
      periodoId,
      sourceEventKey: period.eventKey,
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
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}
