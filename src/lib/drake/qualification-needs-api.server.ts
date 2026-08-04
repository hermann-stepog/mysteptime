import "@tanstack/react-start/server-only";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";

const INDIVIDUAL_QUALIFICATION_NEEDS_URL = "/api/v2/Compliance/IndividualQualificationNeeds/GetAll";
const DEFAULT_PAGE_SIZE = 5_000;
const MAX_SOURCE_ROWS = 250_000;

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
