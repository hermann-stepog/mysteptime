import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "@/lib/drake/http/drake-http-client.types.server";
import {
  fetchAllDrakeQualificationNeeds,
  type DrakeIndividualQualificationNeed,
  type QualificationNeedsPageProgress,
} from "@/lib/drake/qualification-needs-api.server";
import {
  fetchAllQualificationDomains,
  type DrakeQualificationDomains,
} from "@/lib/drake/qualification-matrix-api.server";

const UPSERT_BATCH_SIZE = 500;

export const QUALIFICATION_STORAGE_MIGRATIONS = [
  "20260803150000_course_eligibility.sql",
  "20260803183000_qualification_matrix_options.sql",
] as const;

const QUALIFICATION_STORAGE_PROBES = [
  ["drake_qualification_workers", "drake_worker_id"],
  ["drake_qualification_contexts", "context_key"],
  ["drake_qualification_requirements", "context_key"],
  ["drake_worker_qualifications", "drake_worker_id"],
  ["drake_qualification_sync_state", "option_count"],
  ["drake_qualification_options", "domain_identifier"],
] as const;

export class QualificationStorageNotReadyError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Qualification storage schema is not ready.");
    this.name = "QualificationStorageNotReadyError";
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface QualificationSyncSummary {
  sourceRows: number;
  workers: number;
  options: number;
  qualifications: number;
}

export interface QualificationSyncCallbacks {
  onPage?: (progress: QualificationNeedsPageProgress) => void | Promise<void>;
  onBeforeImport?: () => void | Promise<void>;
}

interface SnapshotRowBase {
  sync_id: string;
  synced_at: string;
}

interface WorkerRow extends SnapshotRowBase {
  drake_worker_id: string;
  registration: string;
  full_name: string;
  job_name: string | null;
  worker_type: string | null;
  worker_state: string | null;
  current_operational_unit_name: string | null;
}

interface OptionRow extends SnapshotRowBase {
  domain_identifier: string;
  option_id: string;
  option_name: string;
  sort_order: number;
}

interface QualificationRow extends SnapshotRowBase {
  drake_worker_id: string;
  qualification_id: string;
  qualification_name: string;
  indicated_course_id: string | null;
  indicated_course_name: string | null;
  expiration_date: string | null;
}

export interface QualificationSnapshot {
  workers: WorkerRow[];
  options: OptionRow[];
  qualifications: QualificationRow[];
}

export async function syncDrakeQualificationNeeds(
  request: DrakeHttpClient,
  db: SupabaseClient,
  callbacks?: QualificationSyncCallbacks,
): Promise<QualificationSyncSummary> {
  await assertQualificationStorageReady(db);

  const [source, domains] = await Promise.all([
    fetchAllDrakeQualificationNeeds(request, { onPage: callbacks?.onPage }),
    fetchAllQualificationDomains(request),
  ]);
  const syncId = crypto.randomUUID();
  const syncedAt = new Date().toISOString();
  const snapshot = buildQualificationSnapshot(source, domains, syncId, syncedAt);

  await callbacks?.onBeforeImport?.();

  await upsertInBatches(db, "drake_qualification_workers", snapshot.workers, "drake_worker_id");
  await upsertInBatches(
    db,
    "drake_qualification_options",
    snapshot.options,
    "domain_identifier,option_id",
  );
  await upsertInBatches(
    db,
    "drake_worker_qualifications",
    snapshot.qualifications,
    "drake_worker_id,qualification_id",
  );

  await removeStaleRows(db, "drake_qualification_requirements", syncId);
  await removeStaleRows(db, "drake_qualification_contexts", syncId);
  await removeStaleRows(db, "drake_worker_qualifications", syncId);
  await removeStaleRows(db, "drake_qualification_options", syncId);
  await removeStaleRows(db, "drake_qualification_workers", syncId);

  const summary: QualificationSyncSummary = {
    sourceRows: source.length,
    workers: snapshot.workers.length,
    options: snapshot.options.length,
    qualifications: snapshot.qualifications.length,
  };
  const { error: stateError } = await db.from("drake_qualification_sync_state").upsert(
    {
      singleton: true,
      last_success_at: syncedAt,
      source_row_count: summary.sourceRows,
      worker_count: summary.workers,
      context_count: 0,
      requirement_count: 0,
      qualification_count: summary.qualifications,
      option_count: summary.options,
    },
    { onConflict: "singleton" },
  );
  if (stateError) throw stateError;

  return summary;
}

export async function assertQualificationStorageReady(db: SupabaseClient): Promise<void> {
  const results = await Promise.all(
    QUALIFICATION_STORAGE_PROBES.map(async ([table, column]) => {
      const { error } = await db.from(table).select(column).limit(1);
      return error;
    }),
  );

  const error = results.find((candidate) => candidate !== null);
  if (!error) return;
  if (isMissingQualificationStorageError(error)) {
    throw new QualificationStorageNotReadyError(error);
  }
  throw error;
}

function isMissingQualificationStorageError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";

  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42703" ||
    /schema cache|could not find (?:the table|the .* column)|does not exist/i.test(message)
  );
}

export function buildQualificationSnapshot(
  source: DrakeIndividualQualificationNeed[],
  domains: DrakeQualificationDomains,
  syncId: string,
  syncedAt: string,
): QualificationSnapshot {
  const base = { sync_id: syncId, synced_at: syncedAt };
  const workers = new Map<string, WorkerRow>();
  const qualifications = new Map<string, QualificationRow>();

  for (const need of source) {
    workers.set(need.workerId, {
      ...base,
      drake_worker_id: need.workerId,
      registration: need.workerRegistration,
      full_name: need.workerName,
      job_name: need.jobName,
      worker_type: need.workerType,
      worker_state: need.workerState,
      current_operational_unit_name: need.currentOperationalUnitName,
    });

    const qualificationKey = `${need.workerId}|${need.qualificationId}`;
    const qualification: QualificationRow = {
      ...base,
      drake_worker_id: need.workerId,
      qualification_id: need.qualificationId,
      qualification_name: need.qualificationName,
      indicated_course_id: need.indicatedCourseId,
      indicated_course_name: need.indicatedCourseName,
      expiration_date: toDateOnly(need.expirationDate),
    };
    const existing = qualifications.get(qualificationKey);
    if (
      !existing ||
      compareNullableDate(qualification.expiration_date, existing.expiration_date) > 0
    ) {
      qualifications.set(qualificationKey, qualification);
    }
  }

  const options = Object.entries(domains).flatMap(([identifier, values]) =>
    values.map<OptionRow>((option) => ({
      ...base,
      domain_identifier: identifier,
      option_id: option.id,
      option_name: option.text,
      sort_order: option.order,
    })),
  );

  return {
    workers: [...workers.values()],
    options,
    qualifications: [...qualifications.values()],
  };
}

function toDateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`Validade inválida recebida do Drake: ${value.slice(0, 30)}.`);
  return match[0];
}

function compareNullableDate(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

async function upsertInBatches<T extends object>(
  db: SupabaseClient,
  table: string,
  rows: T[],
  onConflict: string,
): Promise<void> {
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(index, index + UPSERT_BATCH_SIZE) as never, { onConflict });
    if (error) throw error;
  }
}

async function removeStaleRows(db: SupabaseClient, table: string, syncId: string): Promise<void> {
  const { error } = await db.from(table).delete().neq("sync_id", syncId);
  if (error) throw error;
}
