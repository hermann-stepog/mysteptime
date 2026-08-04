export type OperationType = "onshore" | "offshore" | "offshore-irata";
export type EligibilityStatus = "fit" | "fit-with-warnings" | "unfit";
export type CourseEligibilityStatus =
  | "valid"
  | "expires-during-period"
  | "expired"
  | "missing"
  | "permanent";

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
  startDate: string;
  endDate: string;
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
  issueDate: string | null;
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
  issueDate: string | null;
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
  startDate: string;
  endDate: string;
  requirements: QualificationRequirement[];
  workers: WorkerEligibility[];
}

export interface EvaluateEligibilityInput {
  context: QualificationContext;
  startDate: string;
  endDate: string;
  requirements: QualificationRequirement[];
  workers: QualificationWorker[];
  qualifications: WorkerQualification[];
}

const ACTIVE_WORKER = "ATIVO";
const EMPLOYEE_WORKER_TYPE = "FUNCIONARIO";

export function isMandatoryMarker(value: string | null | undefined): boolean {
  const marker = normalizeText(value);
  return marker === "M" || marker === "MO" || marker.startsWith("MANDATORIO");
}

export function evaluateQualificationEligibility(
  input: EvaluateEligibilityInput,
): EligibilityEvaluation {
  const periodStart = parseIsoDate(input.startDate);
  const periodEnd = parseIsoDate(input.endDate);
  if (periodStart > periodEnd) {
    throw new Error("A data final deve ser igual ou posterior à data inicial.");
  }
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
        evaluateCourse(requirement, findEvidence(evidence, requirement), periodStart, periodEnd),
      );
      const blockingCount = courses.filter(
        (course) => course.mandatory && isBlockingCourseStatus(course.status),
      ).length;
      const warningCount = courses.filter(
        (course) =>
          course.status === "expires-during-period" ||
          (!course.mandatory && isBlockingCourseStatus(course.status)),
      ).length;
      const validCount = courses.filter(
        (course) =>
          course.status === "valid" ||
          course.status === "expires-during-period" ||
          course.status === "permanent",
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
        nextExpirationDate: findNextExpiration(courses, periodStart),
      };
    })
    .sort(compareWorkerEligibility);

  return {
    context: input.context,
    startDate: input.startDate,
    endDate: input.endDate,
    requirements,
    workers,
  };
}

function evaluateCourse(
  requirement: QualificationRequirement,
  evidence: WorkerQualification | undefined,
  periodStart: Date,
  periodEnd: Date,
): EvaluatedCourse {
  const issue = evidence?.issueDate ? parseIsoDate(evidence.issueDate) : null;
  const expiration = evidence?.expirationDate ? parseIsoDate(evidence.expirationDate) : null;
  let status: CourseEligibilityStatus;
  if (!evidence || (!issue && !expiration) || (issue && issue > periodEnd)) status = "missing";
  else if (!expiration) status = "permanent";
  else if (expiration < periodStart) status = "expired";
  else if (expiration <= periodEnd) status = "expires-during-period";
  else status = "valid";

  return {
    qualificationId: requirement.qualificationId,
    qualificationName: requirement.qualificationName,
    courseName: evidence?.indicatedCourseName || requirement.qualificationName,
    needTypeName: requirement.needTypeName,
    mandatory: requirement.mandatory,
    sourceMatrixName: requirement.sourceMatrixName,
    status,
    issueDate: evidence?.issueDate ?? null,
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
  if (!existing || compareEvidence(qualification, existing) > 0) {
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

function compareEvidence(left: WorkerQualification, right: WorkerQualification): number {
  const leftPermanent = Boolean(left.issueDate && !left.expirationDate);
  const rightPermanent = Boolean(right.issueDate && !right.expirationDate);
  if (leftPermanent !== rightPermanent) return leftPermanent ? 1 : -1;
  if (left.expirationDate !== right.expirationDate) {
    if (!left.expirationDate) return -1;
    if (!right.expirationDate) return 1;
    return left.expirationDate.localeCompare(right.expirationDate);
  }
  return (left.issueDate ?? "").localeCompare(right.issueDate ?? "");
}

function isBlockingCourseStatus(status: CourseEligibilityStatus): boolean {
  return status === "missing" || status === "expired";
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
