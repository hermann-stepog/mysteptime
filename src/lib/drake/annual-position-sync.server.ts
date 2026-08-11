import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import {
  fetchDrakeWorkers,
  fetchAnnualPositionsForWorkers,
} from "./worker-annual-position-api.server";
import {
  buildAnnualPositionSnapshot,
  buildWorkerKey,
  type AnnualPositionWorkerRow,
} from "@/lib/histograma/drake-snapshot";
import { importAnnualPositionSnapshot } from "@/lib/histograma/import-annual-position.server";
import { normalizeUnidadeOperacional, ORIGEM_PROGRAMADO } from "@/lib/histogramaNovo";
import { createTimesheetForNewPeriodIfAbsent } from "@/lib/timesheetAutoGen";
import { filterWorkersWithEmbarkationHistory } from "./annual-position-eligibility";
import { selectAllPages } from "@/lib/supabasePaginate";

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

  await synchronizeDrakeWorkerActiveFlags(
    db,
    activeWorkers,
  );

  // Congelado antes de qualquer gravacao desta execucao.
  // Um E criado agora nunca torna outro colaborador elegivel.
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
  const snapshot = buildAnnualPositionSnapshot(sourceRows);
  await hooks.onBeforeDatabaseSync?.();
  const result = await importAnnualPositionSnapshot(db, snapshot, {
    startDate: cutoffDate,
    endDate: `${year}-12-31`,
  });

  const workerByKey = new Map(snapshot.workers.map((worker) => [worker.workerKey, worker]));
  for (const period of result.insertedPeriods) {
    if (period.tipo !== "E") continue;
    const worker = workerByKey.get(period.workerKey);
    if (!worker) {
      throw new Error("O Drake devolveu um novo embarque sem colaborador correspondente.");
    }
    await createTimesheetForNewPeriodIfAbsent(db, {
      colaboradorId: period.colaboradorId,
      periodoId: period.id,
      unidadeOperacional: period.unidadeOperacional,
      bsp: period.centroDeCusto,
      funcaoEmbarque: worker.funcao || worker.funcaoOperacao || "—",
      dataInicio: period.dataInicio,
      dataFim: period.dataFim,
    });
  }

  // Rede de segurança: o loop acima só cria timesheet pros períodos INSERIDOS nesta mesma
  // rodada (result.insertedPeriods) — um período "E" que já existia de uma sincronização
  // anterior e nunca ganhou um timesheet_embarque (ex.: a sincronização caiu no meio, ou uma
  // corrida entre duas rodadas sobrepostas) nunca é revisitado, porque
  // importAnnualPositionSnapshot é append-only e não reinsere o que já está lá. Sem isso, o
  // colaborador fica sem onde lançar horas pra aquele período pra sempre, mesmo clicando em
  // "Atualizar dados do Drake" repetidas vezes.
  await garantirEmbarquesParaPeriodosSemCobertura(db);

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

// Garante que TODO período "E" confirmado (qualquer origem, exceto "programado" — esse ainda
// não foi promovido a embarque real) tenha um timesheet_embarque cobrindo sua janela — não só
// os inseridos na rodada atual. createTimesheetForNewPeriodIfAbsent nunca corrige/encolhe um
// embarque existente (é append-only de propósito), então isso só preenche janelas
// genuinamente descobertas, nunca sobrepõe dado já lançado.
async function garantirEmbarquesParaPeriodosSemCobertura(db: SupabaseClient): Promise<void> {
  const periodosE = await selectAllPages<{
    id: string; colaborador_id: string; unidade_operacional: string | null; centro_de_custo: string | null;
    data_inicio: string; data_fim: string; origem: string | null;
  }>((from, to) =>
    db.from("hist_novo_periodos")
      .select("id, colaborador_id, unidade_operacional, centro_de_custo, data_inicio, data_fim, origem")
      .eq("tipo", "E")
      .order("id").range(from, to),
  );
  const confirmados = periodosE.filter((p) => p.origem !== ORIGEM_PROGRAMADO);
  if (!confirmados.length) return;

  const colaboradorIds = Array.from(new Set(confirmados.map((p) => p.colaborador_id)));
  const embarques = await selectAllPages<{ colaborador_id: string; data_inicio_embarque: string; data_fim_embarque: string }>((from, to) =>
    db.from("timesheet_embarques")
      .select("colaborador_id, data_inicio_embarque, data_fim_embarque")
      .in("colaborador_id", colaboradorIds)
      .order("colaborador_id").range(from, to),
  );
  const embarquesPorColaborador = new Map<string, typeof embarques>();
  embarques.forEach((e) => {
    if (!embarquesPorColaborador.has(e.colaborador_id)) embarquesPorColaborador.set(e.colaborador_id, []);
    embarquesPorColaborador.get(e.colaborador_id)!.push(e);
  });

  const { data: colabsData, error: colabsErr } = await db
    .from("hist_novo_colaboradores").select("id, funcao, funcao_operacao").in("id", colaboradorIds);
  if (colabsErr) throw colabsErr;
  const colabById = new Map((colabsData ?? []).map((c: any) => [c.id, c]));

  for (const p of confirmados) {
    const cobertos = embarquesPorColaborador.get(p.colaborador_id) ?? [];
    const jaCoberto = cobertos.some((e) => e.data_inicio_embarque <= p.data_fim && e.data_fim_embarque >= p.data_inicio);
    if (jaCoberto) continue;

    const colaborador = colabById.get(p.colaborador_id);
    const funcaoEmbarque = colaborador?.funcao || colaborador?.funcao_operacao || "—";
    await createTimesheetForNewPeriodIfAbsent(db, {
      colaboradorId: p.colaborador_id,
      periodoId: p.id,
      unidadeOperacional: p.unidade_operacional,
      bsp: p.centro_de_custo,
      funcaoEmbarque,
      dataInicio: p.data_inicio,
      dataFim: p.data_fim,
    });
    // Atualiza a lista local pra que outro período do mesmo colaborador, mais adiante neste
    // mesmo lote, já enxergue o embarque recém-criado (evita criar dois pro mesmo colaborador).
    cobertos.push({ colaborador_id: p.colaborador_id, data_inicio_embarque: p.data_inicio, data_fim_embarque: p.data_fim });
    embarquesPorColaborador.set(p.colaborador_id, cobertos);
  }
}

async function synchronizeDrakeWorkerActiveFlags(
  db: SupabaseClient,
  activeWorkers: Awaited<
    ReturnType<typeof fetchDrakeWorkers>
  >,
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

    const shouldBeActive =
      activeKeys.has(
        buildWorkerKey(
          worker.empresa,
          worker.matricula,
        ),
      );

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
