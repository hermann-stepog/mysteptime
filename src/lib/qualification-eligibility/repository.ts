import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  QualificationContext,
  QualificationRequirement,
  QualificationWorker,
  WorkerQualification,
} from "./domain";

type AppDb = SupabaseClient<Database>;
type DbContext = Database["public"]["Tables"]["drake_qualification_contexts"]["Row"];
type DbRequirement = Database["public"]["Tables"]["drake_qualification_requirements"]["Row"];
type DbWorker = Database["public"]["Tables"]["drake_qualification_workers"]["Row"];
type DbQualification = Database["public"]["Tables"]["drake_worker_qualifications"]["Row"];
export type QualificationSyncState =
  Database["public"]["Tables"]["drake_qualification_sync_state"]["Row"];

const PAGE_SIZE = 1_000;
const FILTER_BATCH_SIZE = 80;

export interface EligibilitySourceData {
  requirements: QualificationRequirement[];
  workers: QualificationWorker[];
  qualifications: WorkerQualification[];
}

export async function fetchQualificationContexts(db: AppDb): Promise<QualificationContext[]> {
  const rows = await fetchAllPages<DbContext>((from, to) =>
    db
      .from("drake_qualification_contexts")
      .select("*")
      .order("operational_unit_name")
      .order("job_name")
      .order("matrix_name")
      .range(from, to),
  );
  return rows.map(mapContext);
}

export async function fetchQualificationSyncState(
  db: AppDb,
): Promise<QualificationSyncState | null> {
  const { data, error } = await db
    .from("drake_qualification_sync_state")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchEligibilitySourceData(
  db: AppDb,
  context: QualificationContext,
): Promise<EligibilitySourceData> {
  const { data: requirementRows, error: requirementError } = await db
    .from("drake_qualification_requirements")
    .select("*")
    .eq("context_key", context.contextKey)
    .order("is_mandatory", { ascending: false })
    .order("qualification_name");
  if (requirementError) throw requirementError;

  const workers = await fetchAllPages<DbWorker>((from, to) =>
    db
      .from("drake_qualification_workers")
      .select("*")
      .eq("job_name", context.jobName)
      .order("full_name")
      .order("drake_worker_id")
      .range(from, to),
  );
  const requirements = (requirementRows ?? []).map(mapRequirement);
  const qualificationIds = requirements.map((item) => item.qualificationId);
  const workerIds = workers.map((worker) => worker.drake_worker_id);
  const qualifications = await fetchQualifications(db, workerIds, qualificationIds);

  return {
    requirements,
    workers: workers.map(mapWorker),
    qualifications: qualifications.map(mapQualification),
  };
}

async function fetchQualifications(
  db: AppDb,
  workerIds: string[],
  qualificationIds: string[],
): Promise<DbQualification[]> {
  if (workerIds.length === 0 || qualificationIds.length === 0) return [];
  const rows: DbQualification[] = [];
  for (const workerBatch of chunk(workerIds, FILTER_BATCH_SIZE)) {
    for (const qualificationBatch of chunk(qualificationIds, FILTER_BATCH_SIZE)) {
      const { data, error } = await db
        .from("drake_worker_qualifications")
        .select("*")
        .in("drake_worker_id", workerBatch)
        .in("qualification_id", qualificationBatch);
      if (error) throw error;
      rows.push(...(data ?? []));
    }
  }
  return rows;
}

async function fetchAllPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const { data, error } = await fetchPage(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function mapContext(row: DbContext): QualificationContext {
  return {
    contextKey: row.context_key,
    matrixId: row.matrix_id,
    matrixName: row.matrix_name,
    operationalUnitName: row.operational_unit_name,
    jobName: row.job_name,
  };
}

function mapRequirement(row: DbRequirement): QualificationRequirement {
  return {
    qualificationId: row.qualification_id,
    qualificationName: row.qualification_name,
    indicatedCourseName: row.indicated_course_name,
    needTypeName: row.qualification_need_type_name,
    mandatory: row.is_mandatory,
  };
}

function mapWorker(row: DbWorker): QualificationWorker {
  return {
    drakeWorkerId: row.drake_worker_id,
    registration: row.registration,
    fullName: row.full_name,
    jobName: row.job_name,
    workerState: row.worker_state,
    currentOperationalUnitName: row.current_operational_unit_name,
  };
}

function mapQualification(row: DbQualification): WorkerQualification {
  return {
    drakeWorkerId: row.drake_worker_id,
    qualificationId: row.qualification_id,
    qualificationName: row.qualification_name,
    indicatedCourseName: row.indicated_course_name,
    expirationDate: row.expiration_date,
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
