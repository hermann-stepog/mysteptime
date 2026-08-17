import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import {
  fetchDrakeWorkers,
  fetchAnnualPositionsForWorkers,
} from "./worker-annual-position-api.server";
import {
  buildAnnualPositionSnapshot,
  buildDrakeTimesheetPlans,
  buildWorkerKey,
  catalogAnnualPositionOccurrences,
  type AnnualPositionWorkerRow,
} from "@/lib/histograma/drake-snapshot";
import { importAnnualPositionSnapshot } from "@/lib/histograma/import-annual-position.server";
import { normalizeUnidadeOperacional } from "@/lib/histogramaNovo";
import { createTimesheetForNewPeriodIfAbsent } from "@/lib/timesheetAutoGen";
import { filterWorkersWithEmbarkationHistory } from "./annual-position-eligibility";

export interface AnnualPositionSyncProgress {
  completedWorkers: number;
  totalWorkers: number;
}

export interface AnnualPositionSyncResult {
  createdWorkers: number;
  updatedWorkers: number;
  synchronizedEvents: number;
  removedStaleEvents: number;
  preservedExistingEvents: number;
  skippedExistingDays: number;
  processedWorkers: number;
}

export interface AnnualPositionSyncHooks {
  onWorkersLoaded?: (totalWorkers: number) => void | Promise<void>;
  onWorkerProgress?: (progress: AnnualPositionSyncProgress) => void | Promise<void>;
  onPositionsLoaded?: () => void | Promise<void>;
  onBeforeDatabaseSync?: () => void | Promise<void>;
}

export async function synchronizeCurrentDrakeAnnualPositions(
  db: SupabaseClient,
  http: DrakeHttpClient,
  year: number,
  cutoffDate: string,
  hooks: AnnualPositionSyncHooks = {},
): Promise<AnnualPositionSyncResult> {
  const activeWorkers = await fetchDrakeWorkers(http);

  // Segurança destrutiva:
  // uma resposta vazia do Drake não pode significar "todo mundo inativo".
  // Pode ser falha de consulta, autenticação, filtro ou indisponibilidade.
  if (activeWorkers.length === 0) {
    throw new Error(
      "O Drake não devolveu colaboradores ATIVOS. A sincronização foi interrompida e o banco não foi alterado.",
    );
  }

  // Congelado antes de qualquer gravação desta execução.
  // Um E criado agora nunca torna outro colaborador elegível.
  const eligibleWorkerKeys = await loadEligibleWorkerKeys(db);

  const workers = filterWorkersWithEmbarkationHistory(
    activeWorkers,
    eligibleWorkerKeys,
  );

  await hooks.onWorkersLoaded?.(workers.length);
  const annualPositions = await fetchAnnualPositionsForWorkers(
    http,
    workers,
    year,
    (completedWorkers, totalWorkers) =>
      hooks.onWorkerProgress?.({ completedWorkers, totalWorkers }),
  );
  await hooks.onPositionsLoaded?.();

  const sourceRows: AnnualPositionWorkerRow[] = annualPositions.map(
    ({ worker, positions, schedules }) => ({
      drakeWorkerId: worker.id,
      matricula: worker.registration,
      nome: worker.name,
      empresa: worker.companyName,
      funcao: worker.jobDescription,
      funcaoOperacao: worker.payrollJobName,
      positions: positions.map((position) => {
        const schedule = scheduleForDate(schedules, position.Date);
        return {
          date: position.Date,
          occurrenceAcronym: position.OccurrenceAcronym,
          occurrenceDescription: position.OccurrenceDescription,
          occurrenceType: position.OccurrenceType,
          unidadeOperacional: normalizeUnidadeOperacional(
            optionalString(position.Details?.Uop) ?? schedule?.DestinationDescription,
          ),
          // Contract na ficha anual é o cliente, não o centro de custo. O centro de custo
          // exibido no Histograma vem da programação logística do mesmo colaborador.
          centroDeCusto: schedule?.CostCenterDescription ?? null,
        };
      }),
    }),
  );
  // Varre TODAS as ocorrências antes de qualquer gravação.
  // Assim, uma única execução revela o catálogo completo do Drake.
  const occurrenceCatalog =
    catalogAnnualPositionOccurrences(sourceRows);

  console.info(
    "[drake-update] CATALOGO COMPLETO DA FICHA ANUAL",
    occurrenceCatalog.all.map((item) => ({
      sigla: item.acronym,
      descricao: item.description,
      tipo: item.occurrenceType,
      mapeadoComo: item.mappedType,
      mapeado: item.mapped,
      quantidade: item.count,
    })),
  );

  if (occurrenceCatalog.unknown.length > 0) {
    console.error(
      "[drake-update] OCORRENCIAS SEM MAPEAMENTO",
      occurrenceCatalog.unknown.map((item) => ({
        sigla: item.acronym,
        descricao: item.description,
        tipo: item.occurrenceType,
        quantidade: item.count,
      })),
    );

    const unknownLines = occurrenceCatalog.unknown
      .map(
        (item) =>
          `- ${item.acronym || "<SEM SIGLA>"} | ` +
          `${item.description || "<SEM DESCRICAO>"} | ` +
          `${item.occurrenceType ?? "<SEM TIPO>"} | ` +
          `${item.count} ocorrência(s)`,
      )
      .join("\n");

    throw new Error(
      `A Ficha Anual do Drake possui ` +
      `${occurrenceCatalog.unknown.length} ocorrência(s) distinta(s) ` +
      `sem mapeamento:\n${unknownLines}\n` +
      "A sincronização foi interrompida antes de qualquer gravação.",
    );
  }

  // Só constrói o snapshot quando TODO o catálogo estiver conhecido.
  const snapshot = buildAnnualPositionSnapshot(sourceRows);

  // Nenhuma gravação no banco acontece antes deste hook.
  await hooks.onBeforeDatabaseSync?.();

  // Só depois de toda a fonte Drake ser considerada válida atualizamos ativo/inativo.
  await synchronizeDrakeWorkerActiveFlags(
    db,
    activeWorkers,
    eligibleWorkerKeys,
  );

  const result = await importAnnualPositionSnapshot(db, snapshot, {
    startDate: cutoffDate,
    endDate: `${year}-12-31`,
  });

  const workerByKey = new Map(snapshot.workers.map((worker) => [worker.workerKey, worker]));
  const timesheetPlans = buildDrakeTimesheetPlans(snapshot);
  for (const plan of timesheetPlans) {
    const worker = workerByKey.get(plan.workerKey);
    if (!worker) {
      throw new Error("O Drake devolveu um timesheet sem colaborador correspondente.");
    }
    const collaboratorId = result.collaboratorIdByWorkerKey.get(plan.workerKey);
    if (!collaboratorId) continue;
    const linkedPeriod = result.insertedPeriods.find(
      (period) =>
        period.workerKey === plan.workerKey &&
        period.dataInicio <= plan.dataInicio &&
        period.dataFim >= plan.dataInicio &&
        (period.tipo === "E" || period.tipo === "DB"),
    );

    await createTimesheetForNewPeriodIfAbsent(db, {
      colaboradorId: collaboratorId,
      periodoId: linkedPeriod?.id ?? null,
      sourceEventKey: plan.sourceEventKey,
      unidadeOperacional: plan.unidadeOperacional,
      bsp: plan.centroDeCusto,
      funcaoEmbarque: worker.funcao || worker.funcaoOperacao || "—",
      dataInicio: plan.dataInicio,
      dataFim: plan.dataFim,
      sourceDays: plan.days,
    });
  }

  return {
    createdWorkers: result.createdWorkers,
    updatedWorkers: result.updatedWorkers,
    synchronizedEvents: result.synchronizedEvents,
    removedStaleEvents: result.removedStaleEvents,
    preservedExistingEvents: result.preservedExistingEvents,
    skippedExistingDays: result.skippedExistingDays,
    processedWorkers: workers.length,
  };
}

async function synchronizeDrakeWorkerActiveFlags(
  db: SupabaseClient,
  activeWorkers: Awaited<
    ReturnType<typeof fetchDrakeWorkers>
  >,
  eligibleWorkerKeys: ReadonlySet<string>,
): Promise<void> {
  const activeKeys = new Set(
    activeWorkers.map((worker) =>
      buildWorkerKey(
        worker.companyName,
        worker.registration,
      ),
    ),
  );

  const workers: Array<{
    id: string;
    empresa: string | null;
    matricula: string;
    ativo: boolean;
  }> = [];

  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("id, empresa, matricula, ativo")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      empresa: string | null;
      matricula: string;
      ativo: boolean;
    }>;

    workers.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  const activateIds: string[] = [];
  const deactivateIds: string[] = [];

  for (const worker of workers) {
    if (
      !worker.empresa?.trim() ||
      !worker.matricula?.trim()
    ) {
      continue;
    }

    const workerKey = buildWorkerKey(
      worker.empresa,
      worker.matricula,
    );

    // A atualização do Drake não altera colaboradores que nunca fizeram
    // parte do Histograma operacional (sem E pré-existente).
    if (!eligibleWorkerKeys.has(workerKey)) {
      continue;
    }

    const shouldBeActive = activeKeys.has(workerKey);

    if (worker.ativo === shouldBeActive) {
      continue;
    }

    if (shouldBeActive) {
      activateIds.push(worker.id);
    } else {
      deactivateIds.push(worker.id);
    }
  }

  for (
    const batch of chunkEligibilityIds(
      activateIds,
      200,
    )
  ) {
    const { error } = await db
      .from("hist_novo_colaboradores")
      .update({ ativo: true })
      .in("id", batch);

    if (error) throw error;
  }

  for (
    const batch of chunkEligibilityIds(
      deactivateIds,
      200,
    )
  ) {
    const { error } = await db
      .from("hist_novo_colaboradores")
      .update({ ativo: false })
      .in("id", batch);

    if (error) throw error;
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scheduleForDate<T extends { Date: string; Type: string }>(
  schedules: T[],
  date: string,
): T | null {
  let current: T | null = null;
  for (const schedule of schedules) {
    if (schedule.Date > date) break;
    current = schedule;
  }
  return current && normalize(current.Type) === "TRABALHO" ? current : null;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

async function loadEligibleWorkerKeys(
  db: SupabaseClient,
): Promise<Set<string>> {
  const collaboratorIds = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("hist_novo_periodos")
      .select("colaborador_id")
      .eq("tipo", "E")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      colaborador_id: string | null;
    }>;

    for (const row of rows) {
      if (row.colaborador_id) {
        collaboratorIds.add(row.colaborador_id);
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const eligibleWorkerKeys = new Set<string>();
  const ids = [...collaboratorIds];

  for (const batch of chunkEligibilityIds(ids, 200)) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("empresa, matricula")
      .in("id", batch);

    if (error) throw error;

    const workers = (data ?? []) as Array<{
      empresa: string | null;
      matricula: string | null;
    }>;

    for (const worker of workers) {
      if (!worker.empresa?.trim() || !worker.matricula?.trim()) {
        continue;
      }

      eligibleWorkerKeys.add(
        buildWorkerKey(worker.empresa, worker.matricula),
      );
    }
  }

  return eligibleWorkerKeys;
}

function chunkEligibilityIds<T>(
  values: T[],
  size: number,
): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}
