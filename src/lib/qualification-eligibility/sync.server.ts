import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "@/lib/drake/http/drake-http-client.types.server";
import {
  fetchAllDrakeQualificationNeeds,
  type DrakeIndividualQualificationNeed,
  type QualificationNeedsPageProgress,
} from "@/lib/drake/qualification-needs-api.server";
import { isMandatoryNeedType } from "./domain";

const UPSERT_BATCH_SIZE = 500;

export interface QualificationSyncSummary {
  sourceRows: number;
  workers: number;
  contexts: number;
  requirements: number;
  qualifications: number;
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

interface ContextRow extends SnapshotRowBase {
  context_key: string;
  matrix_id: string;
  matrix_name: string;
  operational_unit_name: string;
  job_name: string;
}

interface RequirementRow extends SnapshotRowBase {
  context_key: string;
  qualification_id: string;
  qualification_name: string;
  indicated_course_id: string | null;
  indicated_course_name: string | null;
  qualification_need_type_id: string | null;
  qualification_need_type_name: string;
  relationship_set_id: string | null;
  relationship_set_name: string | null;
  is_mandatory: boolean;
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
  contexts: ContextRow[];
  requirements: RequirementRow[];
  qualifications: QualificationRow[];
}

export async function syncDrakeQualificationNeeds(
  request: DrakeHttpClient,
  db: SupabaseClient,
  onPage?: (progress: QualificationNeedsPageProgress) => void | Promise<void>,
): Promise<QualificationSyncSummary> {
  const source = await fetchAllDrakeQualificationNeeds(request, { onPage });
  const syncId = crypto.randomUUID();
  const syncedAt = new Date().toISOString();
  const snapshot = buildQualificationSnapshot(source, syncId, syncedAt);

  await upsertInBatches(db, "drake_qualification_workers", snapshot.workers, "drake_worker_id");
  await upsertInBatches(db, "drake_qualification_contexts", snapshot.contexts, "context_key");
  await upsertInBatches(
    db,
    "drake_qualification_requirements",
    snapshot.requirements,
    "context_key,qualification_id",
  );
  await upsertInBatches(
    db,
    "drake_worker_qualifications",
    snapshot.qualifications,
    "drake_worker_id,qualification_id",
  );

  await removeStaleRows(db, "drake_qualification_requirements", syncId);
  await removeStaleRows(db, "drake_worker_qualifications", syncId);
  await removeStaleRows(db, "drake_qualification_contexts", syncId);
  await removeStaleRows(db, "drake_qualification_workers", syncId);

  const summary: QualificationSyncSummary = {
    sourceRows: source.length,
    workers: snapshot.workers.length,
    contexts: snapshot.contexts.length,
    requirements: snapshot.requirements.length,
    qualifications: snapshot.qualifications.length,
  };
  const { error: stateError } = await db.from("drake_qualification_sync_state").upsert(
    {
      singleton: true,
      last_success_at: syncedAt,
      source_row_count: summary.sourceRows,
      worker_count: summary.workers,
      context_count: summary.contexts,
      requirement_count: summary.requirements,
      qualification_count: summary.qualifications,
    },
    { onConflict: "singleton" },
  );
  if (stateError) throw stateError;

  return summary;
}

export function buildQualificationSnapshot(
  source: DrakeIndividualQualificationNeed[],
  syncId: string,
  syncedAt: string,
): QualificationSnapshot {
  const base = { sync_id: syncId, synced_at: syncedAt };
  const workers = new Map<string, WorkerRow>();
  const contexts = new Map<string, ContextRow>();
  const requirements = new Map<string, RequirementRow>();
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
    const existingQualification = qualifications.get(qualificationKey);
    if (
      !existingQualification ||
      compareNullableDate(qualification.expiration_date, existingQualification.expiration_date) > 0
    ) {
      qualifications.set(qualificationKey, qualification);
    }

    const operationalUnit = need.operationalUnitName || need.currentOperationalUnitName;
    if (!need.matrixId || !need.matrixName || !need.jobName || !operationalUnit) continue;

    const contextKey = createContextKey(need.matrixId, operationalUnit, need.jobName);
    contexts.set(contextKey, {
      ...base,
      context_key: contextKey,
      matrix_id: need.matrixId,
      matrix_name: need.matrixName,
      operational_unit_name: operationalUnit,
      job_name: need.jobName,
    });

    const mandatory = isMandatoryNeedType(need.qualificationNeedTypeName);
    const requirementKey = `${contextKey}|${need.qualificationId}`;
    const requirement: RequirementRow = {
      ...base,
      context_key: contextKey,
      qualification_id: need.qualificationId,
      qualification_name: need.qualificationName,
      indicated_course_id: need.indicatedCourseId,
      indicated_course_name: need.indicatedCourseName,
      qualification_need_type_id: need.qualificationNeedTypeId,
      qualification_need_type_name: need.qualificationNeedTypeName || "NAO INFORMADO",
      relationship_set_id: need.relationshipSetId,
      relationship_set_name: need.relationshipSetName,
      is_mandatory: mandatory,
    };
    const existingRequirement = requirements.get(requirementKey);
    if (!existingRequirement || (!existingRequirement.is_mandatory && mandatory)) {
      requirements.set(requirementKey, requirement);
    }
  }

  return {
    workers: [...workers.values()],
    contexts: [...contexts.values()],
    requirements: [...requirements.values()],
    qualifications: [...qualifications.values()],
  };
}

export function createContextKey(
  matrixId: string,
  operationalUnit: string,
  jobName: string,
): string {
  return JSON.stringify([matrixId, operationalUnit, jobName]);
}

function toDateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error(`Validade invalida recebida do Drake: ${value.slice(0, 30)}.`);
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
      // O nome da tabela e o shape chegam pareados apenas por este helper. O SDK nao
      // consegue inferir essa relacao quando ambos sao genericos, por isso o cast fica
      // restrito a esta fronteira de persistencia.
      .upsert(rows.slice(index, index + UPSERT_BATCH_SIZE) as never, { onConflict });
    if (error) throw error;
  }
}

async function removeStaleRows(db: SupabaseClient, table: string, syncId: string): Promise<void> {
  const { error } = await db.from(table).delete().neq("sync_id", syncId);
  if (error) throw error;
}
