export type EligibilityStatus = "fit" | "fit-with-warnings" | "unfit";
export type CourseEligibilityStatus = "valid" | "expiring-soon" | "expired" | "missing";

export interface QualificationContext {
  contextKey: string;
  matrixId: string;
  matrixName: string;
  operationalUnitName: string;
  jobName: string;
}

export interface QualificationRequirement {
  qualificationId: string;
  qualificationName: string;
  indicatedCourseName: string | null;
  needTypeName: string;
  mandatory: boolean;
}

export interface QualificationWorker {
  drakeWorkerId: string;
  registration: string;
  fullName: string;
  jobName: string | null;
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

export function isMandatoryNeedType(value: string | null | undefined): boolean {
  return normalizeText(value).startsWith("MANDATORIO");
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
    .filter((worker) => normalizeText(worker.workerState) === "ATIVO")
    .filter((worker) => normalizeText(worker.jobName) === normalizedJob)
    .map((worker) => {
      const evidence = qualificationsByWorker.get(worker.drakeWorkerId) ?? new Map();
      const courses = requirements.map((requirement) =>
        evaluateCourse(
          requirement,
          evidence.get(requirement.qualificationId),
          reference,
          warningLimit,
        ),
      );
      const blockingCount = courses.filter(
        (course) =>
          course.mandatory && (course.status === "missing" || course.status === "expired"),
      ).length;
      const warningCount = courses.filter(
        (course) =>
          course.status === "expiring-soon" ||
          (!course.mandatory && (course.status === "missing" || course.status === "expired")),
      ).length;
      const validCount = courses.filter((course) => course.status === "valid").length;
      const status: EligibilityStatus =
        blockingCount > 0 ? "unfit" : warningCount > 0 ? "fit-with-warnings" : "fit";

      return { worker, status, courses, validCount, warningCount, blockingCount };
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
  if (!expiration) status = "missing";
  else if (expiration < reference) status = "expired";
  else if (expiration <= warningLimit) status = "expiring-soon";
  else status = "valid";

  return {
    qualificationId: requirement.qualificationId,
    qualificationName: requirement.qualificationName,
    courseName: requirement.indicatedCourseName || requirement.qualificationName,
    needTypeName: requirement.needTypeName,
    mandatory: requirement.mandatory,
    status,
    expirationDate: evidence?.expirationDate ?? null,
  };
}

function deduplicateRequirements(
  requirements: QualificationRequirement[],
): QualificationRequirement[] {
  const byQualification = new Map<string, QualificationRequirement>();
  for (const requirement of requirements) {
    const existing = byQualification.get(requirement.qualificationId);
    if (!existing || (!existing.mandatory && requirement.mandatory)) {
      byQualification.set(requirement.qualificationId, requirement);
    }
  }
  return [...byQualification.values()].sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    return displayCourseName(a).localeCompare(displayCourseName(b), "pt-BR");
  });
}

function indexQualifications(
  qualifications: WorkerQualification[],
): Map<string, Map<string, WorkerQualification>> {
  const byWorker = new Map<string, Map<string, WorkerQualification>>();
  for (const qualification of qualifications) {
    let byQualification = byWorker.get(qualification.drakeWorkerId);
    if (!byQualification) {
      byQualification = new Map();
      byWorker.set(qualification.drakeWorkerId, byQualification);
    }
    const existing = byQualification.get(qualification.qualificationId);
    if (!existing || compareExpiration(qualification.expirationDate, existing.expirationDate) > 0) {
      byQualification.set(qualification.qualificationId, qualification);
    }
  }
  return byWorker;
}

function compareExpiration(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
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

function displayCourseName(requirement: QualificationRequirement): string {
  return requirement.indicatedCourseName || requirement.qualificationName;
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
    throw new Error(`Data de referencia invalida: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Data invalida: ${value}`);
  return parsed;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}
