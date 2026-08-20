import "@tanstack/react-start/server-only";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";

const WORKER_DASHBOARD_CONTEXT = "WorkerDashboard";
const WORKER_DASHBOARD_API_VERSION = "2026.08.7";
// O endpoint não garante ordem estável entre páginas sem um filtro salvo pelo usuário.
// Pedimos a lista completa em uma única página para não perder nem repetir colaboradores.
const WORKER_PAGE_SIZE = 5_000;
const ANNUAL_POSITION_CONCURRENCY = 16;

export interface DrakeWorkerDashboardRow {
  id: string;
  name: string;
  registration: string;
  status: string;
  companyName: string;
  jobDescription: string | null;
  payrollJobName: string | null;
}

export interface DrakeAnnualPositionDetails {
  JobDescription?: unknown;
  Uop?: unknown;
  Contract?: unknown;
  Reason?: unknown;
}

export interface DrakeAnnualPositionRow {
  Date: string;
  OccurrenceAcronym: string;
  OccurrenceDescription: string;
  OccurrenceType: string | null;
  Details: DrakeAnnualPositionDetails | null;
}

export interface DrakeWorkerAnnualPosition {
  worker: DrakeWorkerDashboardRow;
  positions: DrakeAnnualPositionRow[];
}

interface WorkerDashboardResponse {
  count: number;
  page: number;
  limit: number;
  items: DrakeWorkerDashboardRow[];
}

export async function fetchDrakeWorkers(http: DrakeHttpClient): Promise<DrakeWorkerDashboardRow[]> {
  const firstPage = await fetchWorkerPage(http, 1);
  const pages = Math.ceil(firstPage.count / firstPage.limit);
  const items = [...firstPage.items];

  for (let page = 2; page <= pages; page += 1) {
    const response = await fetchWorkerPage(http, page);
    if (response.count !== firstPage.count || response.limit !== firstPage.limit) {
      throw new Error(
        "A listagem de colaboradores mudou durante a leitura. A atualização foi cancelada para evitar um snapshot incompleto.",
      );
    }
    items.push(...response.items);
  }

  if (items.length !== firstPage.count) {
    throw new Error(
      `O Drake informou ${firstPage.count} colaboradores, mas devolveu ${items.length}. O banco não foi alterado.`,
    );
  }

  // A ficha anual só interessa ao Histograma para colaboradores ativos.
  // O filtro acontece antes das chamadas individuais de GetPositionsByYear.
  const activeItems = items.filter((worker) => normalize(worker.status) === "ATIVO");
  if (activeItems.length === 0) {
    throw new Error("O Drake não devolveu nenhum colaborador ativo. O banco não foi alterado.");
  }

  const validItems = activeItems.filter(
    (worker) => worker.id && worker.name && worker.registration && worker.companyName,
  );
  const skippedItems = activeItems.length - validItems.length;
  if (skippedItems > Math.max(5, Math.ceil(activeItems.length * 0.01))) {
    throw new Error(
      `O Drake devolveu ${skippedItems} colaboradores ativos sem identidade completa. O banco não foi alterado.`,
    );
  }

  const unique = new Map<string, DrakeWorkerDashboardRow>();
  for (const item of validItems) {
    if (unique.has(item.id)) {
      throw new Error(`O Drake devolveu o colaborador ${item.id} mais de uma vez.`);
    }
    unique.set(item.id, item);
  }

  const workers = [...unique.values()];
  if (workers.length === 0) {
    throw new Error(
      "O Drake não devolveu nenhum colaborador ativo com identidade válida. O banco não foi alterado.",
    );
  }
  return workers.sort((left, right) => left.id.localeCompare(right.id));
}

export async function fetchAnnualPositionsForWorkers(
  http: DrakeHttpClient,
  workers: DrakeWorkerDashboardRow[],
  year: number,
  onProgress?: (completed: number, total: number) => void | Promise<void>,
): Promise<DrakeWorkerAnnualPosition[]> {
  const results = new Array<DrakeWorkerAnnualPosition>(workers.length);
  let cursor = 0;
  let completed = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= workers.length) return;

      const worker = workers[index];
      const positions = await fetchWorkerAnnualPosition(http, worker, year);
      results[index] = { worker, positions };
      completed += 1;
      await onProgress?.(completed, workers.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ANNUAL_POSITION_CONCURRENCY, workers.length) }, () =>
      runWorker(),
    ),
  );
  return results;
}

async function fetchWorkerPage(
  http: DrakeHttpClient,
  page: number,
): Promise<WorkerDashboardResponse> {
  const response = await http.post(
    `/api/v2/dqlfilter/executefilter?v=${WORKER_DASHBOARD_API_VERSION}`,
    {
      failOnStatusCode: false,
      data: {
        context: WORKER_DASHBOARD_CONTEXT,
        culture: "pt-br",
        page,
        limit: WORKER_PAGE_SIZE,
        expressions: [],
        orderExpressions: [],
        dynamicParameters: {},
      },
    },
  );
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`O Drake recusou a listagem de colaboradores (HTTP ${response.status()}).`);
  }

  const value = await response.json();
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("O Drake devolveu uma listagem de colaboradores inválida.");
  }

  const count = positiveInteger(value.count, "total de colaboradores");
  const limit = positiveInteger(value.limit, "tamanho da página");
  const responsePage = positiveInteger(value.page, "número da página");
  const items = value.items.map(parseWorker);
  return { count, limit, page: responsePage, items };
}

async function fetchWorkerAnnualPosition(
  http: DrakeHttpClient,
  worker: DrakeWorkerDashboardRow,
  year: number,
): Promise<DrakeAnnualPositionRow[]> {
  const workerId = worker.id;
  const response = await http.get("/api/v1/BI/GetPositionsByYear", {
    failOnStatusCode: false,
    params: { workerId, year, recalculate: false },
  });
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(
      `O Drake não devolveu a ficha anual do colaborador ${workerId} (HTTP ${response.status()}).`,
    );
  }

  const value = await response.json();
  if (!isRecord(value) || !Array.isArray(value.Positions)) {
    throw new Error(`A ficha anual do colaborador ${workerId} é inválida.`);
  }

  const positions = value.Positions.map((item) => parseAnnualPosition(item, workerId));
  validateCompleteYear(positions, workerId, worker.status, year);
  return positions.sort((left, right) => left.Date.localeCompare(right.Date));
}

function parseWorker(value: unknown): DrakeWorkerDashboardRow {
  if (!isRecord(value)) throw new Error("O Drake devolveu um colaborador inválido.");
  return {
    id: optionalString(value.id) ?? "",
    name: optionalString(value.name) ?? "",
    registration: optionalString(value.registration) ?? "",
    status: optionalString(value.status) ?? "",
    companyName: optionalString(value.companyName) ?? "",
    jobDescription: optionalString(value.jobDescription),
    payrollJobName: optionalString(value.payrollJobName),
  };
}

function parseAnnualPosition(value: unknown, workerId: string): DrakeAnnualPositionRow {
  if (!isRecord(value))
    throw new Error(`A ficha anual do colaborador ${workerId} contém uma linha inválida.`);
  const date = requiredString(value.Date, "data da ficha anual").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`A ficha anual do colaborador ${workerId} contém uma data inválida.`);
  }
  return {
    Date: date,
    OccurrenceAcronym: requiredString(value.OccurrenceAcronym, "sigla da ocorrência"),
    OccurrenceDescription: requiredString(value.OccurrenceDescription, "descrição da ocorrência"),
    OccurrenceType: optionalString(value.OccurrenceType),
    Details: isRecord(value.Details) ? value.Details : null,
  };
}

function validateCompleteYear(
  positions: DrakeAnnualPositionRow[],
  workerId: string,
  workerStatus: string,
  year: number,
): void {
  const dates = new Set(positions.map((position) => position.Date));
  if (positions.length === 0) {
    if (normalize(workerStatus) !== "ATIVO") return;
    throw new Error(
      `A ficha anual do colaborador ativo ${workerId} está vazia. O banco não foi alterado.`,
    );
  }
  if (dates.size !== positions.length) {
    throw new Error(
      `A ficha anual do colaborador ${workerId} está vazia ou contém datas repetidas. O banco não foi alterado.`,
    );
  }
  if ([...dates].some((date) => !date.startsWith(`${year}-`))) {
    throw new Error(`A ficha anual do colaborador ${workerId} contém datas de outro ano.`);
  }
  const orderedDates = [...dates].sort();
  const expectedDays = daysBetween(orderedDates[0], orderedDates[orderedDates.length - 1]) + 1;
  if (positions.length !== expectedDays) {
    throw new Error(
      `A ficha anual do colaborador ${workerId} possui lacunas entre ${orderedDates[0]} e ${orderedDates[orderedDates.length - 1]}. O banco não foi alterado.`,
    );
  }
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`O Drake não informou ${field}.`);
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`O Drake devolveu ${field} inválido.`);
  }
  return parsed;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
