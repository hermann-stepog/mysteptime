import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import {
  fetchDrakeWorkers,
  fetchAnnualPositionsForWorkers,
  filterAnnualPositionsByWindow,
} from "./worker-annual-position-api.server";
import {
  buildAnnualPositionSnapshot,
  buildDrakeTimesheetPlans,
  buildWorkerKey,
  catalogAnnualPositionOccurrences,
  type AnnualPositionWorkerRow,
  type EmbarkationSourceRow,
} from "@/lib/histograma/drake-snapshot";
import { importAnnualPositionSnapshot } from "@/lib/histograma/import-annual-position.server";
import { normalizeUnidadeOperacional } from "@/lib/histogramaNovo";
import { selectAllPages } from "@/lib/supabasePaginate";
import { createTimesheetForNewPeriodIfAbsent } from "@/lib/timesheetAutoGen";
import { filterWorkersAlreadyInHistogram } from "./annual-position-eligibility";
import {
  buildEmbarkationReportIndex,
  resolveEmbarkationReportRow,
  sanitizeDrakeBsp,
} from "./annual-position-embarkation";

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
  novosColaboradores: number;
}

export interface AnnualPositionSyncHooks {
  onWorkersLoaded?: (totalWorkers: number) => void | Promise<void>;
  onWorkerProgress?: (progress: AnnualPositionSyncProgress) => void | Promise<void>;
  onPositionsLoaded?: () => void | Promise<void>;
  onBeforeDatabaseSync?: () => void | Promise<void>;
  onTimesheetSyncProgress?: (progress: AnnualPositionSyncProgress) => void | Promise<void>;
}

const TIMESHEET_WORKER_CONCURRENCY = 8;

export async function synchronizeCurrentDrakeAnnualPositions(
  db: SupabaseClient,
  http: DrakeHttpClient,
  year: number,
  cutoffDate: string,
  embarkationRows: EmbarkationSourceRow[],
  hooks: AnnualPositionSyncHooks = {},
  asOfDate?: string,
  endDate = `${year}-12-31`,
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

  // A carga não cria pessoas: espelha somente quem já pertence ao Histograma.
  // A lista é congelada antes de qualquer gravação e cruzada com os ATIVOS do Drake.
  const histogramWorkerKeys = await loadActiveHistogramWorkerKeys(db);

  // Cadastra em hist_novo_colaboradores quem ainda não existe — só o cadastro (aparece na busca
  // de colaborador em Hospedagem/Passagens Aéreas/Histograma), nunca elegibilidade de Ficha
  // Anual: histogramWorkerKeys já foi congelado ACIMA, então quem é criado aqui só entra na
  // sincronização de fato a partir da próxima atualização, preservando a regra de segurança
  // "a carga não cria pessoas" tal como está.
  const novosColaboradores = await backfillMissingColaboradores(db, activeWorkers);

  const workers = filterWorkersAlreadyInHistogram(activeWorkers, histogramWorkerKeys);

  await hooks.onWorkersLoaded?.(workers.length);
  const endYear = Number(endDate.slice(0, 4));
  const years = Array.from({ length: endYear - year + 1 }, (_, index) => year + index);
  const annualByWorkerId = new Map<
    string,
    Awaited<ReturnType<typeof fetchAnnualPositionsForWorkers>>[number]
  >();
  for (const [yearIndex, targetYear] of years.entries()) {
    const annualForYear = await fetchAnnualPositionsForWorkers(
      http,
      workers,
      targetYear,
      (completedWorkers, totalWorkers) =>
        hooks.onWorkerProgress?.({
          completedWorkers: yearIndex * totalWorkers + completedWorkers,
          totalWorkers: totalWorkers * years.length,
        }),
    );
    for (const annual of annualForYear) {
      const existing = annualByWorkerId.get(annual.worker.id);
      if (existing) existing.positions.push(...annual.positions);
      else annualByWorkerId.set(annual.worker.id, { ...annual, positions: [...annual.positions] });
    }
  }
  const annualPositions = [...annualByWorkerId.values()];
  await hooks.onPositionsLoaded?.();
  const embarkationIndex = buildEmbarkationReportIndex(embarkationRows);

  const sourceRows: AnnualPositionWorkerRow[] = annualPositions.map(({ worker, positions }) => ({
    drakeWorkerId: worker.id,
    matricula: worker.registration,
    nome: worker.name,
    empresa: worker.companyName,
    funcao: worker.jobDescription,
    funcaoOperacao: worker.payrollJobName,
    // Um dia de lookahead impede que o último E visível do recorte mensal vire
    // desembarque quando a sequência continua no dia seguinte.
    positions: filterAnnualPositionsByWindow(positions, cutoffDate, addIsoDay(endDate, 1))
      .map((position) => {
      const detailsUnit = optionalString(position.Details?.Uop);
      const isEmbarkationDay = ["E", "D"].includes(position.OccurrenceAcronym.trim().toUpperCase());
      const reportRow = isEmbarkationDay
        ? resolveEmbarkationReportRow(
            embarkationIndex,
            buildWorkerKey(worker.companyName, worker.registration),
            position.Date,
            detailsUnit,
          )
        : null;
      return {
        date: position.Date,
        occurrenceAcronym: position.OccurrenceAcronym,
        occurrenceDescription: position.OccurrenceDescription,
        occurrenceType: position.OccurrenceType,
        unidadeOperacional: normalizeUnidadeOperacional(
          reportRow?.unidade_operacional ?? detailsUnit,
        ),
        centroDeCusto: sanitizeDrakeBsp(
          reportRow?.centro_de_custo ?? null,
          reportRow?.unidade_operacional ?? detailsUnit,
        ),
      };
      }),
  }));
  // Varre TODAS as ocorrências antes de qualquer gravação.
  // Assim, uma única execução revela o catálogo completo do Drake.
  const occurrenceCatalog = catalogAnnualPositionOccurrences(sourceRows);

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
  const snapshot = buildAnnualPositionSnapshot(sourceRows, { asOfDate });

  // Nenhuma gravação no banco acontece antes deste hook.
  await hooks.onBeforeDatabaseSync?.();

  // Só depois de toda a fonte Drake ser considerada válida atualizamos ativo/inativo.
  await synchronizeDrakeWorkerActiveFlags(db, activeWorkers, histogramWorkerKeys);

  const result = await importAnnualPositionSnapshot(db, snapshot, {
    startDate: cutoffDate,
    endDate,
  });

  const workerByKey = new Map(snapshot.workers.map((worker) => [worker.workerKey, worker]));
  const timesheetPlans = buildDrakeTimesheetPlans(snapshot, {
    startDate: cutoffDate,
    endDate,
  });

  if (asOfDate) {
    await removeExpiredProgrammingPeriods(
      db,
      [...new Set(result.collaboratorIdByWorkerKey.values())],
      asOfDate,
      timesheetPlans.flatMap((plan) => {
        const collaboratorId = result.collaboratorIdByWorkerKey.get(plan.workerKey);
        return collaboratorId
          ? [{ collaboratorId, dataInicio: plan.dataInicio, dataFim: plan.dataFim }]
          : [];
      }),
    );
  }
  await runPlansGroupedByWorker(
    timesheetPlans,
    async (plan) => {
      const worker = workerByKey.get(plan.workerKey);
      if (!worker) {
        throw new Error("O Drake devolveu um timesheet sem colaborador correspondente.");
      }
      const collaboratorId = result.collaboratorIdByWorkerKey.get(plan.workerKey);
      if (!collaboratorId) return;
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
        syncWindow: { startDate: cutoffDate, endDate },
      });
    },
    hooks.onTimesheetSyncProgress,
  );

  return {
    createdWorkers: result.createdWorkers,
    updatedWorkers: result.updatedWorkers,
    synchronizedEvents: result.synchronizedEvents,
    removedStaleEvents: result.removedStaleEvents,
    preservedExistingEvents: result.preservedExistingEvents,
    skippedExistingDays: result.skippedExistingDays,
    processedWorkers: workers.length,
    novosColaboradores,
  };
}

// Só cadastra quem ainda não existe (por empresa+matrícula) — nunca atualiza nome/função de quem
// já está lá, isso continua sendo papel do fluxo de embarque/cadastro manual. Roda com a MESMA
// lista de ativos do Drake que a Ficha Anual já buscou acima, sem chamada nova ao Drake.
async function backfillMissingColaboradores(
  db: SupabaseClient,
  activeWorkers: Awaited<ReturnType<typeof fetchDrakeWorkers>>,
): Promise<number> {
  const porChave = new Map<string, (typeof activeWorkers)[number]>();
  for (const worker of activeWorkers) {
    if (!worker.companyName?.trim() || !worker.registration?.trim() || !worker.name?.trim()) continue;
    const chave = buildWorkerKey(worker.companyName, worker.registration);
    if (!porChave.has(chave)) porChave.set(chave, worker);
  }

  const matriculas = [...new Set([...porChave.values()].map((w) => w.registration))];
  const existentes = new Set<string>();
  for (const batch of chunkEligibilityIds(matriculas, 200)) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("empresa, matricula")
      .in("matricula", batch);
    if (error) throw error;
    for (const row of (data ?? []) as { empresa: string | null; matricula: string }[]) {
      if (row.empresa?.trim() && row.matricula?.trim()) {
        existentes.add(buildWorkerKey(row.empresa, row.matricula));
      }
    }
  }

  const paraCriar = [...porChave.entries()]
    .filter(([chave]) => !existentes.has(chave))
    .map(([, worker]) => ({
      matricula: worker.registration.trim(),
      nome: worker.name.trim(),
      empresa: worker.companyName.trim(),
      funcao: worker.jobDescription?.trim() || null,
      funcao_operacao: worker.payrollJobName?.trim() || null,
      ativo: true,
    }));

  for (const batch of chunkEligibilityIds(paraCriar, 200)) {
    const { error } = await db.from("hist_novo_colaboradores").insert(batch);
    if (error) throw error;
  }

  return paraCriar.length;
}

/**
 * Mantém os embarques da mesma pessoa em ordem para evitar corrida entre períodos,
 * mas permite que colaboradores independentes sejam sincronizados em paralelo.
 */
export async function runPlansGroupedByWorker<T extends { workerKey: string }>(
  plans: T[],
  processPlan: (plan: T) => Promise<void>,
  onWorkerProgress?: (progress: AnnualPositionSyncProgress) => void | Promise<void>,
  concurrency = TIMESHEET_WORKER_CONCURRENCY,
): Promise<void> {
  const groups = new Map<string, T[]>();
  for (const plan of plans) {
    const workerPlans = groups.get(plan.workerKey) ?? [];
    workerPlans.push(plan);
    groups.set(plan.workerKey, workerPlans);
  }
  const workerGroups = [...groups.values()];
  if (workerGroups.length === 0) return;

  let cursor = 0;
  let completedWorkers = 0;
  async function runWorkerGroup(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= workerGroups.length) return;
      for (const plan of workerGroups[index]) {
        await processPlan(plan);
      }
      completedWorkers += 1;
      await onWorkerProgress?.({
        completedWorkers,
        totalWorkers: workerGroups.length,
      });
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), workerGroups.length) },
      () => runWorkerGroup(),
    ),
  );
}

/**
 * Programação só existe antes da data planejada. Quando a data chega sem E
 * confirmado, ela expira; quando o Drake traz E, o período Drake já foi
 * persistido antes desta limpeza e passa a representar o que aconteceu.
 */
async function removeExpiredProgrammingPeriods(
  db: SupabaseClient,
  collaboratorIds: string[],
  asOfDate: string,
  confirmedEmbarkations: Array<{
    collaboratorId: string;
    dataInicio: string;
    dataFim: string;
  }>,
): Promise<void> {
  const confirmationsByCollaborator = new Map<
    string,
    Array<{ dataInicio: string; dataFim: string }>
  >();
  for (const confirmation of confirmedEmbarkations) {
    const ranges = confirmationsByCollaborator.get(confirmation.collaboratorId) ?? [];
    ranges.push({ dataInicio: confirmation.dataInicio, dataFim: confirmation.dataFim });
    confirmationsByCollaborator.set(confirmation.collaboratorId, ranges);
  }

  for (const ids of chunkEligibilityIds(collaboratorIds, 200)) {
    const firstDays = await selectAllPages<StoredProgrammingPeriod>((from, to) =>
      db
        .from("hist_novo_periodos")
        .select("id, colaborador_id, tipo, origem, data_inicio, data_fim")
        .in("colaborador_id", ids)
        .eq("tipo", "P")
        .order("id", { ascending: true })
        .range(from, to),
    );
    const continuations = await selectAllPages<StoredProgrammingPeriod>((from, to) =>
      db
        .from("hist_novo_periodos")
        .select("id, colaborador_id, tipo, origem, data_inicio, data_fim")
        .in("colaborador_id", ids)
        .eq("tipo", "E")
        .eq("origem", "programado")
        .order("id", { ascending: true })
        .range(from, to),
    );

    const deleteIds = [...firstDays, ...continuations]
      .filter((period) => {
        if (period.data_inicio <= asOfDate) return true;
        return (confirmationsByCollaborator.get(period.colaborador_id) ?? []).some(
          (confirmation) =>
            (period.data_inicio <= confirmation.dataFim &&
              period.data_fim >= confirmation.dataInicio) ||
            confirmation.dataInicio === addIsoDay(period.data_inicio, 1),
        );
      })
      .map((period) => period.id);

    for (const deleteBatch of chunkEligibilityIds(deleteIds, 200)) {
      const { error } = await db.from("hist_novo_periodos").delete().in("id", deleteBatch);
      if (error) throw error;
    }
  }
}

interface StoredProgrammingPeriod {
  id: string;
  colaborador_id: string;
  tipo: string;
  origem: string | null;
  data_inicio: string;
  data_fim: string;
}

function addIsoDay(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

async function synchronizeDrakeWorkerActiveFlags(
  db: SupabaseClient,
  activeWorkers: Awaited<ReturnType<typeof fetchDrakeWorkers>>,
  histogramWorkerKeys: ReadonlySet<string>,
): Promise<void> {
  const activeKeys = new Set(
    activeWorkers.map((worker) => buildWorkerKey(worker.companyName, worker.registration)),
  );

  const workers: Array<{
    id: string;
    empresa: string | null;
    matricula: string;
  }> = [];

  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("id, empresa, matricula")
      .eq("ativo", true)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      empresa: string | null;
      matricula: string;
    }>;

    workers.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  const deactivateIds: string[] = [];

  for (const worker of workers) {
    if (!worker.empresa?.trim() || !worker.matricula?.trim()) {
      continue;
    }

    const workerKey = buildWorkerKey(worker.empresa, worker.matricula);

    // Não altera cadastros externos ao Histograma que iniciou esta carga.
    if (!histogramWorkerKeys.has(workerKey)) {
      continue;
    }

    // A sincronização pode desativar quem deixou de estar ativo no Drake,
    // mas nunca reativa um cadastro desativado localmente pelo usuário.
    if (!activeKeys.has(workerKey)) {
      deactivateIds.push(worker.id);
    }
  }

  for (const batch of chunkEligibilityIds(deactivateIds, 200)) {
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

async function loadActiveHistogramWorkerKeys(db: SupabaseClient): Promise<Set<string>> {
  const histogramWorkerKeys = new Set<string>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await db
      .from("hist_novo_colaboradores")
      .select("empresa, matricula")
      .eq("ativo", true)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      empresa: string | null;
      matricula: string | null;
    }>;

    for (const row of rows) {
      if (row.empresa?.trim() && row.matricula?.trim()) {
        histogramWorkerKeys.add(buildWorkerKey(row.empresa, row.matricula));
      }
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return histogramWorkerKeys;
}

function chunkEligibilityIds<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}
