import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { DrakeHttpClient } from "@/lib/drake/http/drake-http-client.types.server";
import {
  fetchDrakeMatrixItems,
  type DrakeMatrixItem,
} from "@/lib/drake/qualification-matrix-api.server";
import {
  evaluateQualificationEligibility,
  isMandatoryMarker,
  normalizeQualificationText,
  type EligibilityEvaluation,
  type OperationType,
  type QualificationEligibilitySelection,
  type QualificationRequirement,
} from "./domain";
import { fetchWorkerQualificationSource } from "./repository";

type AppDb = SupabaseClient<Database>;
type StoredOption = Database["public"]["Tables"]["drake_qualification_options"]["Row"];

const MATRIX_DOMAIN = "QUALIFICATION_MATRICES";
const WORKER_TYPE_DOMAIN = "WORKER_TYPES";
const NEED_TYPE_DOMAIN = "QUALIFICATION_NEED_TYPES";
const UNIT_DOMAIN = "OPERATIONAL_UNITS";
const JOB_DOMAIN = "OPERATION_JOBS";
const QUALIFICATION_DOMAIN = "QUALIFICATIONS";

export async function evaluateLiveQualificationEligibility(
  request: DrakeHttpClient,
  db: AppDb,
  selection: QualificationEligibilitySelection,
): Promise<EligibilityEvaluation> {
  validateSelection(selection);
  const [coreOptions, unit, job] = await Promise.all([
    fetchCoreOptions(db),
    fetchSelectedOption(db, UNIT_DOMAIN, selection.operationalUnitId),
    fetchSelectedOption(db, JOB_DOMAIN, selection.jobId),
  ]);

  const matrices = selectApplicableMatrices(
    coreOptions.filter((option) => option.domain_identifier === MATRIX_DOMAIN),
    selection.operationType,
  );
  const workerType = requiredOption(
    coreOptions.filter((option) => option.domain_identifier === WORKER_TYPE_DOMAIN),
    (option) => normalizeQualificationText(option.option_id) === "FUNCIONARIO",
    "tipo de trabalhador Funcionário",
  );
  const needTypeIds = coreOptions
    .filter((option) => option.domain_identifier === NEED_TYPE_DOMAIN)
    .map((option) => option.option_id);
  if (needTypeIds.length === 0) {
    throw new Error("Os tipos de necessidade de qualificação ainda não foram sincronizados.");
  }

  const matrixRows = await Promise.all(
    matrices.map(async (matrix) => ({
      matrix,
      rows: await fetchDrakeMatrixItems(request, {
        matrixId: matrix.option_id,
        workerTypeId: workerType.option_id,
        operationalUnitId: unit.option_id,
        jobId: job.option_id,
        needTypeIds,
      }),
    })),
  );
  const qualificationIds = indexQualificationIds(coreOptions);
  const requirements = buildRequirements(matrixRows, job.option_name, qualificationIds);
  if (requirements.length === 0) {
    throw new Error(
      "Nenhum requisito foi encontrado no Drake para o cliente, vaga e tipo de atuação selecionados.",
    );
  }

  const source = await fetchWorkerQualificationSource(db, job.option_name);
  return evaluateQualificationEligibility({
    context: {
      operationType: selection.operationType,
      operationalUnitId: unit.option_id,
      operationalUnitName: unit.option_name,
      jobId: job.option_id,
      jobName: job.option_name,
      matrixIds: matrices.map((matrix) => matrix.option_id),
      matrixNames: matrices.map((matrix) => matrix.option_name),
    },
    referenceDate: selection.referenceDate,
    requirements,
    ...source,
  });
}

export function selectApplicableMatrices(
  matrices: StoredOption[],
  operationType: OperationType,
): StoredOption[] {
  const requiredKinds: Record<OperationType, string[]> = {
    onshore: ["ONSHORE"],
    offshore: ["OFFSHORE MANDATORIA", "OFFSHORE RECOMENDAVEL"],
    "offshore-irata": ["OFFSHORE MANDATORIA", "OFFSHORE RECOMENDAVEL", "OFFSHORE IRATA"],
  };

  return requiredKinds[operationType].map((kind) =>
    requiredOption(
      matrices,
      (matrix) => normalizeQualificationText(matrix.option_name).includes(kind),
      `matriz ${kind}`,
    ),
  );
}

export function buildRequirements(
  sources: Array<{ matrix: StoredOption; rows: DrakeMatrixItem[] }>,
  jobName: string,
  qualificationIds: Map<string, string>,
): QualificationRequirement[] {
  const normalizedJob = normalizeQualificationText(jobName);
  return sources.flatMap(({ matrix, rows }) =>
    rows
      .filter((row) => normalizeQualificationText(row.jobName) === normalizedJob)
      .map((row) => ({
        qualificationId:
          qualificationIds.get(normalizeQualificationText(row.qualificationName)) ??
          `name:${normalizeQualificationText(row.qualificationName)}`,
        qualificationName: row.qualificationName,
        needTypeName: markerLabel(row.marker),
        mandatory: isMandatoryMarker(row.marker),
        sourceMatrixName: matrix.option_name,
      })),
  );
}

function markerLabel(marker: string): string {
  const normalized = normalizeQualificationText(marker);
  if (normalized === "M") return "Mandatório";
  if (normalized === "MO") return "Mandatório offshore";
  if (normalized === "R") return "Recomendável";
  return marker;
}

function indexQualificationIds(options: StoredOption[]): Map<string, string> {
  return new Map(
    options
      .filter((option) => option.domain_identifier === QUALIFICATION_DOMAIN)
      .map((option) => [normalizeQualificationText(option.option_name), option.option_id]),
  );
}

async function fetchCoreOptions(db: AppDb): Promise<StoredOption[]> {
  const { data, error } = await db
    .from("drake_qualification_options")
    .select("*")
    .in("domain_identifier", [
      MATRIX_DOMAIN,
      WORKER_TYPE_DOMAIN,
      NEED_TYPE_DOMAIN,
      QUALIFICATION_DOMAIN,
    ])
    .order("domain_identifier")
    .order("sort_order");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Os dropdowns da matriz ainda não foram sincronizados.");
  }
  return data;
}

async function fetchSelectedOption(
  db: AppDb,
  domain: string,
  optionId: string,
): Promise<StoredOption> {
  const { data, error } = await db
    .from("drake_qualification_options")
    .select("*")
    .eq("domain_identifier", domain)
    .eq("option_id", optionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Um dos filtros selecionados não existe mais no Drake.");
  return data;
}

function requiredOption(
  options: StoredOption[],
  predicate: (option: StoredOption) => boolean,
  description: string,
): StoredOption {
  const option = options.find(predicate);
  if (!option) throw new Error(`Não foi possível localizar ${description} no Drake.`);
  return option;
}

function validateSelection(selection: QualificationEligibilitySelection): void {
  if (!selection.operationalUnitId || !selection.jobId) {
    throw new Error("Cliente/unidade e vaga são obrigatórios.");
  }
  if (!(["onshore", "offshore", "offshore-irata"] as string[]).includes(selection.operationType)) {
    throw new Error("Tipo de atuação inválido.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selection.referenceDate)) {
    throw new Error("Data da solicitação inválida.");
  }
}
