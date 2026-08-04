export type OperationType = "onshore" | "offshore" | "offshore-irata";
export type EligibilityStatus = "fit" | "fit-with-warnings" | "unfit";
export type CourseEligibilityStatus =
  | "valid"
  | "expiring-soon"
  | "expired"
  | "missing"
  | "no-expiration";

export const OPERATION_TYPE_LABEL: Record<OperationType, string> = {
  onshore: "Onshore",
  offshore: "Offshore",
  "offshore-irata": "Offshore IRATA",
};

export interface QualificationContext {
  operationType: OperationType;
  operationalUnitId: string;
  operationalUnitName: string;
  jobId: string;
  jobName: string;
  matrixIds: string[];
  matrixNames: string[];
}

export interface QualificationEligibilitySelection {
  operationalUnitId: string;
  jobId: string;
  operationType: OperationType;
  referenceDate: string;
}

export interface QualificationRequirement {
  qualificationId: string;
  qualificationName: string;
  needTypeName: string;
  mandatory: boolean;
  sourceMatrixName: string;
}

export interface QualificationWorker {
  drakeWorkerId: string;
  registration: string;
  fullName: string;
  jobName: string | null;
  workerType: string | null;
  workerState: string | null;
  currentOperationalUnitName: string | null;
}

export interface WorkerQualification {
  drakeWorkerId: string;
  qualificationId: string;
  qualificationName: string;
  indicatedCourseName: string | null;
  expirationDate: string | null;
}

export interface EvaluatedCourse {
  qualificationId: string;
  qualificationName: string;
  courseName: string;
  needTypeName: string;
  mandatory: boolean;
  sourceMatrixName: string;
  status: CourseEligibilityStatus;
  expirationDate: string | null;
}

export interface WorkerEligibility {
  worker: QualificationWorker;
  status: EligibilityStatus;
  courses: EvaluatedCourse[];
  validCount: number;
  warningCount: number;
  blockingCount: number;
  nextExpirationDate: string | null;
}

export interface EligibilityEvaluation {
  context: QualificationContext;
  referenceDate: string;
  requirements: QualificationRequirement[];
  workers: WorkerEligibility[];
}

export interface EvaluateEligibilityInput {
  context: QualificationContext;
  referenceDate: string;
  requirements: QualificationRequirement[];
  workers: QualificationWorker[];
  qualifications: WorkerQualification[];
  expiringSoonDays?: number;
}

const DAY_MS = 86_400_000;
const ACTIVE_WORKER = "ATIVO";
const EMPLOYEE_WORKER_TYPE = "FUNCIONARIO";

export function isMandatoryMarker(value: string | null | undefined): boolean {
  const marker = normalizeText(value);
  return marker === "M" || marker === "MO" || marker.startsWith("MANDATORIO");
}

export function evaluateQualificationEligibility(
  input: EvaluateEligibilityInput,
): EligibilityEvaluation {
  const reference = parseIsoDate(input.referenceDate);
  const warningLimit = addDays(reference, input.expiringSoonDays ?? 30);
  const requirements = deduplicateRequirements(input.requirements);
  const qualificationsByWorker = indexQualifications(input.qualifications);
  const normalizedJob = normalizeText(input.context.jobName);

  const workers = input.workers
    .filter((worker) => normalizeText(worker.workerState) === ACTIVE_WORKER)
    .filter((worker) => normalizeText(worker.workerType) === EMPLOYEE_WORKER_TYPE)
    .filter((worker) => normalizeText(worker.jobName) === normalizedJob)
    .map((worker) => {
      const evidence = qualificationsByWorker.get(worker.drakeWorkerId);
      const courses = requirements.map((requirement) =>
        evaluateCourse(requirement, findEvidence(evidence, requirement), reference, warningLimit),
      );
      const blockingCount = courses.filter(
        (course) => course.mandatory && isBlockingCourseStatus(course.status),
      ).length;
      const warningCount = courses.filter(
        (course) =>
          course.status === "expiring-soon" ||
          (!course.mandatory && isBlockingCourseStatus(course.status)),
      ).length;
      const validCount = courses.filter(
        (course) => course.status === "valid" || course.status === "expiring-soon",
      ).length;
      const status: EligibilityStatus =
        blockingCount > 0 ? "unfit" : warningCount > 0 ? "fit-with-warnings" : "fit";

      return {
        worker,
        status,
        courses,
        validCount,
        warningCount,
        blockingCount,
        nextExpirationDate: findNextExpiration(courses, reference),
      };
    })
    .sort(compareWorkerEligibility);

  return {
    context: input.context,
    referenceDate: input.referenceDate,
    requirements,
    workers,
  };
}

function evaluateCourse(
  requirement: QualificationRequirement,
  evidence: WorkerQualification | undefined,
  reference: Date,
  warningLimit: Date,
): EvaluatedCourse {
  const expiration = evidence?.expirationDate ? parseIsoDate(evidence.expirationDate) : null;
  let status: CourseEligibilityStatus;
  if (!evidence) status = "missing";
  else if (!expiration) status = "no-expiration";
  else if (expiration < reference) status = "expired";
  else if (expiration <= warningLimit) status = "expiring-soon";
  else status = "valid";

  return {
    qualificationId: requirement.qualificationId,
    qualificationName: requirement.qualificationName,
    courseName: evidence?.indicatedCourseName || requirement.qualificationName,
    needTypeName: requirement.needTypeName,
    mandatory: requirement.mandatory,
    sourceMatrixName: requirement.sourceMatrixName,
    status,
    expirationDate: evidence?.expirationDate ?? null,
  };
}

function deduplicateRequirements(
  requirements: QualificationRequirement[],
): QualificationRequirement[] {
  const byQualification = new Map<string, QualificationRequirement>();
  for (const requirement of requirements) {
    const key = normalizeText(requirement.qualificationName) || requirement.qualificationId;
    const existing = byQualification.get(key);
    if (!existing || (!existing.mandatory && requirement.mandatory)) {
      byQualification.set(key, requirement);
    }
  }
  return [...byQualification.values()].sort((left, right) => {
    if (left.mandatory !== right.mandatory) return left.mandatory ? -1 : 1;
    return left.qualificationName.localeCompare(right.qualificationName, "pt-BR");
  });
}

type WorkerEvidenceIndex = {
  byId: Map<string, WorkerQualification>;
  byName: Map<string, WorkerQualification>;
};

function indexQualifications(
  qualifications: WorkerQualification[],
): Map<string, WorkerEvidenceIndex> {
  const byWorker = new Map<string, WorkerEvidenceIndex>();
  for (const qualification of qualifications) {
    let evidence = byWorker.get(qualification.drakeWorkerId);
    if (!evidence) {
      evidence = { byId: new Map(), byName: new Map() };
      byWorker.set(qualification.drakeWorkerId, evidence);
    }
    keepLatest(evidence.byId, qualification.qualificationId, qualification);
    keepLatest(evidence.byName, normalizeText(qualification.qualificationName), qualification);
  }
  return byWorker;
}

function keepLatest(
  index: Map<string, WorkerQualification>,
  key: string,
  qualification: WorkerQualification,
): void {
  if (!key) return;
  const existing = index.get(key);
  if (!existing || compareExpiration(qualification.expirationDate, existing.expirationDate) > 0) {
    index.set(key, qualification);
  }
}

function findEvidence(
  evidence: WorkerEvidenceIndex | undefined,
  requirement: QualificationRequirement,
): WorkerQualification | undefined {
  return (
    evidence?.byId.get(requirement.qualificationId) ??
    evidence?.byName.get(normalizeText(requirement.qualificationName))
  );
}

function compareExpiration(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function isBlockingCourseStatus(status: CourseEligibilityStatus): boolean {
  return status === "missing" || status === "expired" || status === "no-expiration";
}

function findNextExpiration(courses: EvaluatedCourse[], reference: Date): string | null {
  const dates = courses
    .map((course) => course.expirationDate)
    .filter((value): value is string => Boolean(value))
    .filter((value) => parseIsoDate(value) >= reference)
    .sort();
  return dates[0] ?? null;
}

function compareWorkerEligibility(left: WorkerEligibility, right: WorkerEligibility): number {
  const rank: Record<EligibilityStatus, number> = {
    fit: 0,
    "fit-with-warnings": 1,
    unfit: 2,
  };
  return (
    rank[left.status] - rank[right.status] ||
    left.worker.fullName.localeCompare(right.worker.fullName, "pt-BR")
  );
}

export function normalizeQualificationText(value: string | null | undefined): string {
  return normalizeText(value);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Data de referência inválida: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Data inválida: ${value}`);
  return parsed;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}
