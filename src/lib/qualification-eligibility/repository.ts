import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { QualificationWorker, WorkerQualification } from "./domain";

type AppDb = SupabaseClient<Database>;
type DbOption = Database["public"]["Tables"]["drake_qualification_options"]["Row"];
type DbWorker = Database["public"]["Tables"]["drake_qualification_workers"]["Row"];
type DbQualification = Database["public"]["Tables"]["drake_worker_qualifications"]["Row"];
export type QualificationSyncState =
  Database["public"]["Tables"]["drake_qualification_sync_state"]["Row"];

const PAGE_SIZE = 1_000;
const WORKER_FILTER_BATCH_SIZE = 20;
const UNIT_DOMAIN = "OPERATIONAL_UNITS";
const JOB_DOMAIN = "OPERATION_JOBS";

export interface QualificationFilterOption {
  id: string;
  name: string;
}

export interface QualificationFilterCatalog {
  operationalUnits: QualificationFilterOption[];
  jobs: QualificationFilterOption[];
}

export interface WorkerQualificationSource {
  workers: QualificationWorker[];
  qualifications: WorkerQualification[];
}

export async function fetchQualificationFilterCatalog(
  db: AppDb,
): Promise<QualificationFilterCatalog> {
  const rows = await fetchAllPages<DbOption>((from, to) =>
    db
      .from("drake_qualification_options")
      .select("*")
      .in("domain_identifier", [UNIT_DOMAIN, JOB_DOMAIN])
      .order("domain_identifier")
      .order("sort_order")
      .order("option_id")
      .range(from, to),
  );

  return {
    operationalUnits: mapOptions(rows, UNIT_DOMAIN),
    jobs: mapOptions(rows, JOB_DOMAIN),
  };
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

export async function fetchWorkerQualificationSource(
  db: AppDb,
  jobName: string,
): Promise<WorkerQualificationSource> {
  const workerRows = await fetchAllPages<DbWorker>((from, to) =>
    db
      .from("drake_qualification_workers")
      .select("*")
      .eq("job_name", jobName)
      .eq("worker_state", "Ativo")
      .eq("worker_type", "Funcionario")
      .order("full_name")
      .order("drake_worker_id")
      .range(from, to),
  );
  const qualificationRows = await fetchQualifications(
    db,
    workerRows.map((worker) => worker.drake_worker_id),
  );

  return {
    workers: workerRows.map(mapWorker),
    qualifications: qualificationRows.map(mapQualification),
  };
}

async function fetchQualifications(db: AppDb, workerIds: string[]): Promise<DbQualification[]> {
  if (workerIds.length === 0) return [];
  const rows: DbQualification[] = [];
  for (const workerBatch of chunk(workerIds, WORKER_FILTER_BATCH_SIZE)) {
    rows.push(
      ...(await fetchAllPages<DbQualification>((from, to) =>
        db
          .from("drake_worker_qualifications")
          .select("*")
          .in("drake_worker_id", workerBatch)
          .order("drake_worker_id")
          .order("qualification_id")
          .range(from, to),
      )),
    );
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

function mapOptions(rows: DbOption[], domain: string): QualificationFilterOption[] {
  return rows
    .filter((row) => row.domain_identifier === domain)
    .map((row) => ({ id: row.option_id, name: row.option_name }));
}

function mapWorker(row: DbWorker): QualificationWorker {
  return {
    drakeWorkerId: row.drake_worker_id,
    registration: row.registration,
    fullName: row.full_name,
    jobName: row.job_name,
    workerType: row.worker_type,
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
    issueDate: row.issue_date,
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
