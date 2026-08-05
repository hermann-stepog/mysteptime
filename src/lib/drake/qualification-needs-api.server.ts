import "@tanstack/react-start/server-only";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";

const INDIVIDUAL_QUALIFICATION_NEEDS_URL = "/api/v2/Compliance/IndividualQualificationNeeds/GetAll";
const QUALIFICATION_ATTENDANCES_URL =
  "/api/v2/Compliance/IndividualQualificationNeeds/GetNeedsAttendances";
const DEFAULT_PAGE_SIZE = 5_000;
const MAX_SOURCE_ROWS = 250_000;
const ATTENDANCE_PAGE_SIZE = 100;
const ATTENDANCE_LOOKUP_CONCURRENCY = 8;

export interface DrakeIndividualQualificationNeed {
  id: string;
  workerId: string;
  workerName: string;
  workerType: string | null;
  workerState: string | null;
  workerRegistration: string;
  jobName: string | null;
  qualificationId: string;
  qualificationName: string;
  indicatedCourseId: string | null;
  indicatedCourseName: string | null;
  issueDate: string | null;
  expirationDate: string | null;
  relationshipSetId: string | null;
  relationshipSetName: string | null;
  matrixId: string | null;
  matrixName: string | null;
  qualificationNeedTypeId: string | null;
  qualificationNeedTypeName: string | null;
  operationalUnitName: string | null;
  currentOperationalUnitName: string | null;
}

export interface QualificationNeedsPageProgress {
  loaded: number;
  total: number;
}

export interface QualificationAttendanceProgress {
  loaded: number;
  total: number;
}

export async function fetchAllDrakeQualificationNeeds(
  request: DrakeHttpClient,
  options?: {
    pageSize?: number;
    onPage?: (progress: QualificationNeedsPageProgress) => void | Promise<void>;
  },
): Promise<DrakeIndividualQualificationNeed[]> {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10_000) {
    throw new Error("Tamanho de pagina invalido para necessidades de qualificacao.");
  }

  const rows: DrakeIndividualQualificationNeed[] = [];
  let total = Number.POSITIVE_INFINITY;

  while (rows.length < total) {
    const response = await request.get(INDIVIDUAL_QUALIFICATION_NEEDS_URL, {
      failOnStatusCode: false,
      timeout: 60_000,
      params: {
        skip: rows.length,
        take: pageSize,
        requireTotalCount: true,
      },
    });
    if (response.status() !== 200) {
      throw new Error(
        `O Drake recusou a consulta de necessidades de qualificacao (status ${response.status()}).`,
      );
    }

    const page = parseQualificationNeedsPage(await response.json());
    total = page.totalCount;
    if (total > MAX_SOURCE_ROWS) {
      throw new Error(`Quantidade inesperada de necessidades de qualificacao: ${total}.`);
    }
    if (page.data.length === 0 && rows.length < total) {
      throw new Error("O Drake interrompeu a paginacao das necessidades de qualificacao.");
    }

    rows.push(...page.data);
    await options?.onPage?.({ loaded: rows.length, total });
  }

  return rows;
}

export function parseQualificationNeedsPage(value: unknown): {
  data: DrakeIndividualQualificationNeed[];
  totalCount: number;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Resposta invalida das necessidades de qualificacao do Drake.");
  }
  const totalCount = Number(value.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) {
    throw new Error("Total invalido nas necessidades de qualificacao do Drake.");
  }
  return {
    data: value.data.map(parseQualificationNeed),
    totalCount,
  };
}

export async function fetchPermanentQualificationIssueDates(
  request: DrakeHttpClient,
  needs: DrakeIndividualQualificationNeed[],
  onProgress?: (progress: QualificationAttendanceProgress) => void | Promise<void>,
): Promise<Map<string, string>> {
  const candidates = uniquePermanentEvidenceCandidates(needs);
  const issueDates = new Map<string, string>();
  let nextIndex = 0;
  let completed = 0;

  const workers = Array.from(
    { length: Math.min(ATTENDANCE_LOOKUP_CONCURRENCY, candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex++];
        if (!candidate) return;
        const attendances = await fetchQualificationAttendances(request, candidate);
        const latestPermanentIssueDate = attendances
          .filter((attendance) => attendance.issueDate && !attendance.expirationDate)
          .map((attendance) => attendance.issueDate as string)
          .sort()
          .at(-1);
        if (latestPermanentIssueDate) {
          const key = qualificationEvidenceKey(candidate.workerId, candidate.qualificationId);
          const existing = issueDates.get(key);
          if (!existing || latestPermanentIssueDate > existing) {
            issueDates.set(key, latestPermanentIssueDate);
          }
        }
        completed += 1;
        if (completed === candidates.length || completed % 25 === 0) {
          await onProgress?.({ loaded: completed, total: candidates.length });
        }
      }
    },
  );
  await Promise.all(workers);
  if (candidates.length === 0) await onProgress?.({ loaded: 0, total: 0 });
  return issueDates;
}

export function parseQualificationAttendances(value: unknown): Array<{
  issueDate: string | null;
  expirationDate: string | null;
}> {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Resposta inválida do histórico de qualificações do Drake.");
  }
  return value.data.map((item) => {
    if (!isRecord(item)) throw new Error("Atendimento de qualificação inválido no Drake.");
    return {
      issueDate: optionalString(item, "emissao"),
      expirationDate: optionalString(item, "validade"),
    };
  });
}

function parseQualificationNeed(value: unknown): DrakeIndividualQualificationNeed {
  if (!isRecord(value)) throw new Error("Linha invalida nas necessidades de qualificacao.");
  return {
    id: requiredString(value, "id"),
    workerId: requiredString(value, "workerId"),
    workerName: requiredString(value, "workerName"),
    workerType: optionalString(value, "workerType"),
    workerState: optionalString(value, "workerState"),
    workerRegistration: requiredString(value, "workerRegistration"),
    jobName: optionalString(value, "jobName"),
    qualificationId: requiredString(value, "qualificationId"),
    qualificationName: requiredString(value, "qualificationName"),
    indicatedCourseId: optionalString(value, "indicatedCourseId"),
    indicatedCourseName: optionalString(value, "indicatedCourseName"),
    issueDate: optionalString(value, "issueDate"),
    expirationDate: optionalString(value, "expirationDate"),
    relationshipSetId: optionalString(value, "relationshipSetId"),
    relationshipSetName: optionalString(value, "relationshipSetName"),
    matrixId: optionalString(value, "matrixId"),
    matrixName: optionalString(value, "matrixName"),
    qualificationNeedTypeId: optionalString(value, "qualificationNeedTypeId"),
    qualificationNeedTypeName: optionalString(value, "qualificationNeedTypeName"),
    operationalUnitName: optionalString(value, "operationalUnitName"),
    currentOperationalUnitName: optionalString(value, "currentOperationalUnitName"),
  };
}

async function fetchQualificationAttendances(
  request: DrakeHttpClient,
  candidate: DrakeIndividualQualificationNeed,
): Promise<Array<{ issueDate: string | null; expirationDate: string | null }>> {
  const rows: Array<{ issueDate: string | null; expirationDate: string | null }> = [];
  let total = Number.POSITIVE_INFINITY;
  while (rows.length < total) {
    const response = await request.get(QUALIFICATION_ATTENDANCES_URL, {
      failOnStatusCode: false,
      timeout: 60_000,
      params: {
        workerId: candidate.workerId,
        qualificationId: candidate.qualificationId,
        relationshipSetId: candidate.relationshipSetId,
        skip: rows.length,
        take: ATTENDANCE_PAGE_SIZE,
        requireTotalCount: true,
      },
    });
    if (response.status() !== 200) {
      throw new Error(
        `O Drake recusou o histórico de qualificações (status ${response.status()}).`,
      );
    }
    const value = await response.json();
    if (!isRecord(value)) throw new Error("Resposta inválida do histórico de qualificações.");
    total = Number(value.totalCount);
    if (!Number.isInteger(total) || total < 0) {
      throw new Error("Total inválido no histórico de qualificações do Drake.");
    }
    const page = parseQualificationAttendances(value);
    if (page.length === 0 && rows.length < total) {
      throw new Error("O Drake interrompeu o histórico de qualificações.");
    }
    rows.push(...page);
  }
  return rows;
}

function uniquePermanentEvidenceCandidates(
  needs: DrakeIndividualQualificationNeed[],
): DrakeIndividualQualificationNeed[] {
  const candidates = new Map<string, DrakeIndividualQualificationNeed>();
  for (const need of needs) {
    if (
      need.issueDate ||
      need.expirationDate ||
      !need.relationshipSetId ||
      normalizeText(need.workerState) !== "ATIVO" ||
      normalizeText(need.workerType) !== "FUNCIONARIO"
    ) {
      continue;
    }
    const key = `${qualificationEvidenceKey(need.workerId, need.qualificationId)}|${need.relationshipSetId}`;
    if (!candidates.has(key)) candidates.set(key, need);
  }
  return [...candidates.values()];
}

export function qualificationEvidenceKey(workerId: string, qualificationId: string): string {
  return `${workerId}|${qualificationId}`;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key);
  if (!value) throw new Error(`Campo obrigatorio ausente no Drake: ${key}.`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Campo invalido no Drake: ${key}.`);
  return value.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}
