import "@tanstack/react-start/server-only";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";

const DOMAIN_URL = "/api/v2/dqlfilter/GetDomainSets";
const MATRIX_ITEMS_URL = "/api/v2/Compliance/Matrix/Items";
const DOMAIN_PAGE_SIZE = 100;
const MATRIX_PAGE_SIZE = 5_000;
const MAX_DOMAIN_PAGES = 500;
const MAX_MATRIX_ROWS = 100_000;

export const QUALIFICATION_DOMAIN_IDENTIFIERS = [
  "QUALIFICATION_MATRICES",
  "WORKER_TYPES",
  "QUALIFICATION_NEED_TYPES",
  "OPERATIONAL_UNITS",
  "CONTRACTS",
  "DEPARTMENTS",
  "COUNTRIES",
  "OPERATION_JOBS",
  "ACTIVITIES",
  "QUALIFICATIONS",
] as const;

export type QualificationDomainIdentifier = (typeof QUALIFICATION_DOMAIN_IDENTIFIERS)[number];

export interface DrakeQualificationDomainOption {
  id: string;
  text: string;
  order: number;
}

export type DrakeQualificationDomains = Record<
  QualificationDomainIdentifier,
  DrakeQualificationDomainOption[]
>;

export interface DrakeMatrixItem {
  id: string;
  jobName: string | null;
  qualificationName: string;
  marker: string;
  operationalUnitName: string | null;
  contractName: string | null;
  departmentName: string | null;
  countryName: string | null;
  activityName: string | null;
}

export interface DrakeMatrixQuery {
  matrixId: string;
  workerTypeId: string;
  operationalUnitId: string;
  jobId: string;
  needTypeIds: string[];
}

export async function fetchAllQualificationDomains(
  request: DrakeHttpClient,
): Promise<DrakeQualificationDomains> {
  const entries = await Promise.all(
    QUALIFICATION_DOMAIN_IDENTIFIERS.map(
      async (identifier) =>
        [identifier, await fetchQualificationDomain(request, identifier)] as const,
    ),
  );
  return Object.fromEntries(entries) as DrakeQualificationDomains;
}

export async function fetchQualificationDomain(
  request: DrakeHttpClient,
  identifier: QualificationDomainIdentifier,
): Promise<DrakeQualificationDomainOption[]> {
  const options: DrakeQualificationDomainOption[] = [];
  for (let page = 1; page <= MAX_DOMAIN_PAGES; page += 1) {
    const response = await request.get(DOMAIN_URL, {
      failOnStatusCode: false,
      timeout: 60_000,
      params: {
        domainIdentifier: identifier,
        filter: "",
        page,
        limit: DOMAIN_PAGE_SIZE,
      },
    });
    if (response.status() !== 200) {
      throw new Error(`O Drake recusou o dropdown ${identifier} (status ${response.status()}).`);
    }
    const value = await response.json();
    const pageOptions = parseQualificationDomainOptions(value, (page - 1) * DOMAIN_PAGE_SIZE);
    options.push(...pageOptions);
    if (Array.isArray(value) && value.length < DOMAIN_PAGE_SIZE) return options;
  }
  throw new Error(`Paginação excessiva no dropdown ${identifier}.`);
}

export async function fetchDrakeMatrixItems(
  request: DrakeHttpClient,
  query: DrakeMatrixQuery,
): Promise<DrakeMatrixItem[]> {
  if (query.needTypeIds.length === 0) {
    throw new Error("Selecione ao menos um tipo de necessidade de qualificação.");
  }

  const rows: DrakeMatrixItem[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (rows.length < total) {
    const response = await request.get(buildMatrixItemsUrl(query, rows.length), {
      failOnStatusCode: false,
      timeout: 120_000,
    });
    if (response.status() !== 200) {
      throw new Error(`O Drake recusou a matriz de qualificação (status ${response.status()}).`);
    }
    const page = parseMatrixItemsPage(await response.json());
    total = page.totalCount;
    if (total > MAX_MATRIX_ROWS) {
      throw new Error(`Quantidade inesperada de requisitos na matriz: ${total}.`);
    }
    if (page.data.length === 0 && rows.length < total) {
      throw new Error("O Drake interrompeu a paginação da matriz de qualificação.");
    }
    rows.push(...page.data);
  }
  return rows;
}

export function parseQualificationDomainOptions(
  value: unknown,
  offset = 0,
): DrakeQualificationDomainOption[] {
  if (!Array.isArray(value)) throw new Error("Resposta inválida de dropdown do Drake.");
  return value.flatMap((item, index) => {
    if (!isRecord(item)) throw new Error("Opção inválida em dropdown do Drake.");
    const id = optionalString(item, "id");
    const text = optionalString(item, "text");
    if (!id || !text) return [];
    return [{ id, text, order: offset + index }];
  });
}

export function parseMatrixItemsPage(value: unknown): {
  data: DrakeMatrixItem[];
  totalCount: number;
} {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Resposta inválida da matriz de qualificação do Drake.");
  }
  const totalCount = Number(value.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) {
    throw new Error("Total inválido na matriz de qualificação do Drake.");
  }
  return {
    data: value.data.map(parseMatrixItem),
    totalCount,
  };
}

function buildMatrixItemsUrl(query: DrakeMatrixQuery, skip: number): string {
  const params = new URLSearchParams({
    matrixId: query.matrixId,
    workerType: query.workerTypeId,
    operationalUnitId: query.operationalUnitId,
    contractId: "undefined",
    departmentId: "undefined",
    jobId: query.jobId,
    countryId: "undefined",
    activityId: "undefined",
    qualificationId: "undefined",
    skip: String(skip),
    take: String(MATRIX_PAGE_SIZE),
    requireTotalCount: "true",
  });
  query.needTypeIds.forEach((typeId) => params.append("typeIds", typeId));
  return `${MATRIX_ITEMS_URL}?${params.toString()}`;
}

function parseMatrixItem(value: unknown): DrakeMatrixItem {
  if (!isRecord(value)) throw new Error("Linha inválida na matriz de qualificação.");
  return {
    id: requiredString(value, "id"),
    jobName: optionalString(value, "job"),
    qualificationName: requiredString(value, "qualification"),
    marker: requiredString(value, "type"),
    operationalUnitName: optionalString(value, "operationalUnit"),
    contractName: optionalString(value, "contract"),
    departmentName: optionalString(value, "department"),
    countryName: optionalString(value, "country"),
    activityName: optionalString(value, "activity"),
  };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record, key);
  if (!value) throw new Error(`Campo obrigatório ausente no Drake: ${key}.`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Campo inválido no Drake: ${key}.`);
  return value.trim() || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
