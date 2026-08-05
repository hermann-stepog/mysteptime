import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHistogramSnapshot } from "./drake-snapshot";

export interface DrakeSnapshotWindow {
  startDate: string;
  endDate: string;
}

export interface DrakeSnapshotSyncResult {
  createdWorkers: number;
  updatedWorkers: number;
  synchronizedEvents: number;
  removedStaleEvents: number;
  periodIdByEventKey: Map<string, string>;
}

interface RawSyncResult {
  created_workers?: unknown;
  updated_workers?: unknown;
  synchronized_events?: unknown;
  removed_stale_events?: unknown;
  periods?: unknown;
}

const REQUIRED_MIGRATION = "20260805130000_drake_histogram_atomic_sync.sql";

export async function synchronizeDrakeHistogramSnapshot(
  db: SupabaseClient,
  snapshot: DrakeHistogramSnapshot,
  window: DrakeSnapshotWindow,
): Promise<DrakeSnapshotSyncResult> {
  validateWindow(window);
  if (snapshot.workers.length === 0 || snapshot.periods.length === 0) {
    throw new Error(
      "O relatório do Drake não contém trabalhadores e eventos suficientes. O banco não foi alterado.",
    );
  }

  const { data, error } = await db.rpc("sync_drake_histogram_snapshot", {
    p_source: snapshot.source,
    p_window_start: window.startDate,
    p_window_end: window.endDate,
    p_workers: snapshot.workers.map((worker) => ({
      worker_key: worker.workerKey,
      matricula: worker.matricula,
      nome: worker.nome,
      empresa: worker.empresa,
      funcao: worker.funcao,
      funcao_operacao: worker.funcaoOperacao,
    })),
    p_periods: snapshot.periods.map((period) => ({
      event_key: period.eventKey,
      worker_key: period.workerKey,
      unidade_operacional: period.unidadeOperacional,
      centro_de_custo: period.centroDeCusto,
      tipo: period.tipo,
      data_inicio: period.dataInicio,
      data_fim: period.dataFim,
      dias: period.dias,
      source_event_name: period.sourceEventName,
    })),
  });
  if (error) {
    if (/sync_drake_histogram_snapshot|schema cache|PGRST202|PGRST205/i.test(error.message)) {
      throw new Error(
        `O banco ainda não possui a proteção de integridade do Drake. Aplique a migration ${REQUIRED_MIGRATION} antes de atualizar novamente.`,
      );
    }
    throw error;
  }

  return parseSyncResult(data);
}

function parseSyncResult(value: unknown): DrakeSnapshotSyncResult {
  if (!isRecord(value))
    throw new Error("O banco devolveu um resultado inválido da sincronização Drake.");
  const raw = value as RawSyncResult;
  const periods = Array.isArray(raw.periods) ? raw.periods : [];
  const periodIdByEventKey = new Map<string, string>();
  for (const period of periods) {
    if (!isRecord(period)) continue;
    const eventKey = stringValue(period.event_key);
    const id = stringValue(period.id);
    if (eventKey && id) periodIdByEventKey.set(eventKey, id);
  }

  return {
    createdWorkers: integerValue(raw.created_workers),
    updatedWorkers: integerValue(raw.updated_workers),
    synchronizedEvents: integerValue(raw.synchronized_events),
    removedStaleEvents: integerValue(raw.removed_stale_events),
    periodIdByEventKey,
  };
}

function validateWindow(window: DrakeSnapshotWindow): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(window.startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(window.endDate) ||
    window.startDate > window.endDate
  ) {
    throw new Error("Janela inválida para sincronização dos relatórios do Drake.");
  }
}

function integerValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("O banco devolveu uma contagem inválida da sincronização Drake.");
  }
  return parsed;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
