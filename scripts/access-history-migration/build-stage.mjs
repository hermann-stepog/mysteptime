import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalMatricula,
  classifyExisting,
  daysInclusive,
  hashRecord,
  normalizeText,
  parseAccessDate,
  pick,
  readCsv,
  splitLegacyCode,
  writeCsv,
} from "./lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const name = argv[i].slice(2);
    args[name] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return args;
}

async function readJson(filePath, optional = false) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
}

function safeTableFileName(table) {
  return `${table.replace(/[<>:"/\\|?*]/g, "_")}.csv`;
}

function countBy(rows, key) {
  return Object.fromEntries(
    Array.from(
      rows.reduce((map, row) => {
        const value = typeof key === "function" ? key(row) : row[key];
        const label = value == null || value === "" ? "(vazio)" : String(value);
        map.set(label, (map.get(label) ?? 0) + 1);
        return map;
      }, new Map()),
    ).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function canonicalCompany(value, config) {
  const normalized = normalizeText(value);
  const aliases = new Map(
    Object.entries(config.companyAliases ?? {}).map(([key, val]) => [normalizeText(key), val]),
  );
  return aliases.get(normalized) ?? String(value ?? "").trim();
}

function collaboratorKey(matricula, company, config) {
  return `${canonicalMatricula(matricula)}::${normalizeText(canonicalCompany(company, config))}`;
}

function canonicalUnit(value, config) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const aliases = new Map(
    Object.entries(config.unitAliases ?? {}).map(([key, val]) => [normalizeText(key), val]),
  );
  const direct = aliases.get(normalizeText(raw));
  if (direct) return direct;
  const shortName = raw.split(/\s+-\s+/)[0]?.trim();
  return aliases.get(normalizeText(shortName)) ?? raw;
}

function unique(values) {
  return Array.from(new Set(values.filter((value) => value != null && value !== "")));
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args["access-dir"] && !args["joblist-csv"]) || !args.output) {
  console.log(
    [
      "Uso completo:",
      "  node build-stage.mjs --access-dir <extração> --supabase-dir <snapshot> --output <saída>",
      "Auditoria parcial da JobList:",
      "  node build-stage.mjs --joblist-csv <access_joblist.csv> --output <saída>",
    ].join("\n"),
  );
  process.exit(args.help ? 0 : 2);
}

const accessDirectory = args["access-dir"] ? path.resolve(args["access-dir"]) : null;
const snapshotDirectory = args["supabase-dir"] ? path.resolve(args["supabase-dir"]) : null;
const outputDirectory = path.resolve(args.output);
const config = await readJson(
  path.resolve(args.config || path.join(scriptDirectory, "access-history.config.json")),
);
await mkdir(outputDirectory, { recursive: true });

async function accessTable(name, optional = true) {
  if (!accessDirectory) return [];
  return readCsv(path.join(accessDirectory, "tables", safeTableFileName(name)), { optional });
}

const jobListPath = args["joblist-csv"]
  ? path.resolve(args["joblist-csv"])
  : path.join(accessDirectory, "tables", safeTableFileName("Tbl_JobList"));
const jobList = await readCsv(jobListPath);
const [hours, events, jornadas, vessels, projects, dboEmployees, oldEmployees, tableCounts] =
  await Promise.all([
    accessTable("Tbl_Horas_Semanal"),
    accessTable("Tbl_Evento"),
    accessTable("dbo_Tbl_Jornada"),
    accessTable("Tbl_Embarcacao"),
    accessTable("Tbl_Projeto"),
    accessTable("dbo_Funcionario"),
    accessTable("Tbl_Funcionarios"),
    accessDirectory
      ? readCsv(path.join(accessDirectory, "access_table_counts.csv"), { optional: true })
      : [],
  ]);
const manifest = accessDirectory
  ? await readJson(path.join(accessDirectory, "manifest.json"), true)
  : null;

let currentCollaborators = [];
let currentPeriods = [];
let currentFunctions = [];
let snapshotSummary = null;
if (snapshotDirectory) {
  snapshotSummary = await readJson(path.join(snapshotDirectory, "snapshot-summary.json"));
  if (!snapshotSummary.readOnly)
    throw new Error("A fotografia do Supabase não está marcada como somente-leitura.");
  [currentCollaborators, currentPeriods, currentFunctions] = await Promise.all([
    readCsv(path.join(snapshotDirectory, "hist_novo_colaboradores.csv")),
    readCsv(path.join(snapshotDirectory, "hist_novo_periodos.csv")),
    readCsv(path.join(snapshotDirectory, "colaborador_funcoes_historico.csv"), { optional: true }),
  ]);
}
const snapshotAvailable = Boolean(snapshotDirectory);

const currentByIdentity = new Map();
for (const row of currentCollaborators) {
  const key = collaboratorKey(pick(row, ["matricula"]), pick(row, ["empresa"]), config);
  if (!currentByIdentity.has(key)) currentByIdentity.set(key, []);
  currentByIdentity.get(key).push(row);
}

const dboByLegacyCode = new Map();
for (const row of dboEmployees) {
  const code = pick(row, ["Codigo_Interno", "Codigo Interno"]);
  if (!code) continue;
  if (!dboByLegacyCode.has(code)) dboByLegacyCode.set(code, []);
  dboByLegacyCode.get(code).push(row);
}

const oldByCompanyMatricula = new Map();
for (const row of oldEmployees) {
  const key = collaboratorKey(
    pick(row, ["Cod_Funcionario_Step", "Cod Funcionario Step"]),
    pick(row, ["Nome_Empresa", "Nome Empresa"]),
    config,
  );
  if (!oldByCompanyMatricula.has(key)) oldByCompanyMatricula.set(key, []);
  oldByCompanyMatricula.get(key).push(row);
}

const legacyCodes = unique(jobList.map((row) => pick(row, ["Cod_Funcionario1"]))).sort();
const runId = randomUUID();
const collaboratorMappings = [];
const mappingByLegacyCode = new Map();
for (const legacyCode of legacyCodes) {
  const { matriculaBase, suffix } = splitLegacyCode(legacyCode);
  const expectedCompany = suffix ? (config.companyBySuffix?.[suffix] ?? null) : null;
  const assertion = config.identityAssertions?.[legacyCode] ?? null;
  const dboRows = dboByLegacyCode.get(legacyCode) ?? [];
  const sourceName =
    assertion?.expectedName || pick(dboRows[0], ["NmFuncionario", "Nome_Funcionario"]);
  const oldRows =
    matriculaBase && expectedCompany
      ? (oldByCompanyMatricula.get(collaboratorKey(matriculaBase, expectedCompany, config)) ?? [])
      : [];
  const currentMatches =
    matriculaBase && expectedCompany
      ? (currentByIdentity.get(collaboratorKey(matriculaBase, expectedCompany, config)) ?? [])
      : [];

  let resolutionStatus;
  let resolvedCollaboratorId = null;
  let currentName = null;
  let reviewNote = assertion?.evidence ?? null;
  if (assertion?.forceUnidentified) {
    resolutionStatus =
      assertion?.reviewDecision === "placeholder_approved"
        ? "placeholder_approved"
        : "unidentified";
  } else if (!matriculaBase || !suffix) {
    resolutionStatus = "invalid_legacy_code";
    reviewNote = "Código não segue o formato matrícula_sufixo.";
  } else if (!expectedCompany) {
    resolutionStatus = "unknown_suffix";
    reviewNote = `Sufixo ${suffix} sem empresa configurada.`;
  } else if (!snapshotAvailable) {
    resolutionStatus = "snapshot_required";
  } else if (currentMatches.length === 0) {
    resolutionStatus =
      assertion?.reviewDecision === "create_approved" ? "create_approved" : "not_found_current";
  } else if (currentMatches.length > 1) {
    resolutionStatus = "ambiguous_current";
  } else {
    currentName = pick(currentMatches[0], ["nome"]);
    if (
      assertion?.expectedName &&
      normalizeText(currentName) !== normalizeText(assertion.expectedName)
    ) {
      resolutionStatus = "identity_name_mismatch";
      reviewNote = `Esperado “${assertion.expectedName}”, encontrado “${currentName}”.`;
    } else {
      resolutionStatus = "resolved_exact";
      resolvedCollaboratorId = pick(currentMatches[0], ["id"]);
    }
  }

  const mapping = {
    run_id: runId,
    legacy_code: legacyCode,
    matricula_base: matriculaBase,
    sufixo: suffix,
    empresa_esperada: expectedCompany,
    resolution_status: resolutionStatus,
    resolved_collaborator_id: resolvedCollaboratorId,
    source_name: sourceName || pick(oldRows[0], ["Nome_Funcionario"]),
    current_name: currentName,
    proposed_matricula:
      assertion?.proposedSyntheticMatricula ??
      (["not_found_current", "create_approved"].includes(resolutionStatus) &&
      assertion?.expectedName
        ? matriculaBase
        : null),
    proposed_nome:
      assertion?.proposedName ??
      (["not_found_current", "create_approved"].includes(resolutionStatus) &&
      assertion?.expectedName
        ? assertion.expectedName
        : null),
    review_note: reviewNote,
    source_payload: JSON.stringify({ assertion, dboRows, oldRows }),
  };
  collaboratorMappings.push(mapping);
  mappingByLegacyCode.set(legacyCode, mapping);
}

const vesselByCode = new Map();
for (const row of vessels) {
  const code = pick(row, ["Cod_Embarcacao", "Id_Embarcacao", "Codigo"]);
  if (code) vesselByCode.set(code, row);
}
const projectByCode = new Map();
for (const row of projects) {
  const code = pick(row, ["Id_Projeto", "Cod_Projeto", "Num_Projeto"]);
  if (code) projectByCode.set(code, row);
}
const eventByCode = new Map();
for (const row of events) {
  const code = pick(row, ["Cod_Evento", "Id_Evento", "Codigo"]);
  if (code) eventByCode.set(code, row);
}
const allocationByCode = new Map(jobList.map((row) => [pick(row, ["Cod_Alocacao"]), row]));

function allocationContext(row) {
  const vesselCode = pick(row, ["Cod_Embarcacao"]);
  const vesselRow = vesselByCode.get(vesselCode);
  const vesselName = pick(vesselRow, ["Nome_Embarcacao", "Embarcacao", "Nome"]);
  const projectCode = pick(row, ["Num_Projeto"]);
  const projectRow = projectByCode.get(projectCode);
  const projectBsp = pick(projectRow, ["Projeto", "BSP", "Centro_de_Custo", "Centro de Custo"]);
  return {
    vesselCode,
    vesselName: canonicalUnit(vesselName, config),
    projectCode,
    projectBsp: projectBsp || null,
    projectRow,
  };
}

function baseIssues(legacyCode, context) {
  const issues = [];
  const mapping = mappingByLegacyCode.get(legacyCode);
  const approvedMappingStatuses = new Set([
    "resolved_exact",
    "create_approved",
    "placeholder_approved",
  ]);
  if (!mapping || !approvedMappingStatuses.has(mapping.resolution_status)) {
    issues.push(`collaborator:${mapping?.resolution_status ?? "missing"}`);
  }
  if (context.vesselCode && !context.vesselName) issues.push("unit:catalog_mapping_required");
  if (context.projectCode && !context.projectRow) issues.push("project:catalog_mapping_required");
  return issues;
}

const periodCandidates = [];
for (const row of jobList) {
  const allocationCode = pick(row, ["Cod_Alocacao"]);
  const legacyCode = pick(row, ["Cod_Funcionario1"]);
  const mapping = mappingByLegacyCode.get(legacyCode);
  const context = allocationContext(row);
  const start =
    parseAccessDate(pick(row, ["Dt_Embarque"])) || parseAccessDate(pick(row, ["Dt_Inicio_Aloc"]));
  const end = parseAccessDate(pick(row, ["Dt_Desembarque"]));
  const issues = baseIssues(legacyCode, context);
  const preserveAsOpenFunctionOnly = !end && config.openAllocationPolicy === "function_only";
  if (!start) issues.push("date:missing_start");
  if (!end && !preserveAsOpenFunctionOnly) issues.push("date:open_or_missing_end");
  if (start && end && end < start) issues.push("date:end_before_start");
  periodCandidates.push({
    run_id: runId,
    source_key: `access:joblist:${allocationCode}`,
    source_kind: "allocation",
    legacy_code: legacyCode,
    colaborador_id: mapping?.resolved_collaborator_id ?? null,
    unidade_operacional: context.vesselName,
    bsp: context.projectBsp,
    tipo: "E",
    data_inicio: start,
    data_fim: end,
    dias: daysInclusive(start, end),
    origem: config.origin,
    source_hash: hashRecord(row),
    source_payload: JSON.stringify(row),
    target_period_id: randomUUID(),
    review_status: preserveAsOpenFunctionOnly ? "excluded_reviewed" : "pending",
    overlap_status: preserveAsOpenFunctionOnly ? "excluded_open_allocation" : null,
    existing_period_id: null,
    blocking_reasons: issues,
    review_note:
      [
        context.projectCode ? `Num_Projeto=${context.projectCode}` : null,
        preserveAsOpenFunctionOnly
          ? "Alocação aberta preservada em função; período sem término excluído por decisão revisada."
          : null,
      ]
        .filter(Boolean)
        .join(" | ") || null,
  });
}

const eventCatalogMap = new Map();
const eventStageRows = [];
const rawOnlyEventLabels = new Set((config.eventRawOnlyLabels ?? []).map(normalizeText));
for (const row of hours) {
  const eventCode = pick(row, ["Evento"]);
  const eventRow = eventByCode.get(eventCode);
  const eventLabel =
    pick(eventRow, ["Evento", "Nome_Evento", "Descricao", "Nome"]) ||
    (/\D/.test(eventCode) ? eventCode : "");
  const key = `${eventCode}::${eventLabel}`;
  const current = eventCatalogMap.get(key) ?? {
    event_code: eventCode,
    event_label: eventLabel,
    rows: 0,
    min_date: null,
    max_date: null,
  };
  current.rows += 1;
  const start = parseAccessDate(pick(row, ["Dt_Inicio"]));
  const end = parseAccessDate(pick(row, ["Dt_Fim"]));
  if (start && (!current.min_date || start < current.min_date)) current.min_date = start;
  if (end && (!current.max_date || end > current.max_date)) current.max_date = end;
  eventCatalogMap.set(key, current);

  const allocationCode = pick(row, ["Cod_Alocacao"]);
  const allocation = allocationByCode.get(allocationCode);
  const legacyCode = pick(allocation, ["Cod_Funcionario1"]);
  const mapping = mappingByLegacyCode.get(legacyCode);
  const context = allocationContext(allocation ?? {});
  const weeklyProject = pick(row, ["Projeto"]);
  const normalizedEventLabel = normalizeText(eventLabel);
  const type = config.eventTypeByLabel?.[normalizedEventLabel] ?? null;
  const rawOnly = rawOnlyEventLabels.has(normalizedEventLabel);
  const handlingStatus = type ? "period_mapped" : rawOnly ? "raw_only" : "review_required";
  const eventSourceKey = `access:hours:${pick(row, ["Cod_Horas_Semanal"])}`;
  eventStageRows.push({
    run_id: runId,
    source_key: eventSourceKey,
    cod_horas_semanal: pick(row, ["Cod_Horas_Semanal"]),
    cod_alocacao: allocationCode,
    legacy_code: legacyCode,
    event_code: eventCode,
    event_label: eventLabel,
    handling_status: handlingStatus,
    mapped_tipo: type,
    data_inicio: start,
    data_fim: end,
    inicio_hora_extra: pick(row, ["InicioHoraExtra"]),
    fim_hora_extra: pick(row, ["FimHoraExtra"]),
    qtd_horas: pick(row, ["Qtd_Horas"]),
    jornada: pick(row, ["Jornada"]),
    projeto: weeklyProject,
    nam: pick(row, ["NAM"]),
    comentarios: pick(row, ["Comentarios"]),
    source_hash: hashRecord(row),
    source_payload: JSON.stringify(row),
    review_status: handlingStatus === "review_required" ? "blocked" : "preserved",
    review_note:
      handlingStatus === "raw_only"
        ? "Preservado como evento bruto; não representa um tipo de hist_novo_periodos."
        : null,
  });
  if (!type) continue;
  const issues = baseIssues(legacyCode, context);
  if (!allocation) issues.push("allocation:not_found");
  if (!start) issues.push("date:missing_start");
  if (!end) issues.push("date:missing_end");
  if (start && end && end < start) issues.push("date:end_before_start");
  periodCandidates.push({
    run_id: runId,
    source_key: eventSourceKey,
    source_kind: "event",
    legacy_code: legacyCode,
    colaborador_id: mapping?.resolved_collaborator_id ?? null,
    unidade_operacional: context.vesselName,
    bsp: weeklyProject || context.projectBsp,
    tipo: type,
    data_inicio: start,
    data_fim: end,
    dias: daysInclusive(start, end),
    origem: config.origin,
    source_hash: hashRecord(row),
    source_payload: JSON.stringify(row),
    target_period_id: randomUUID(),
    review_status: "pending",
    overlap_status: null,
    existing_period_id: null,
    blocking_reasons: issues,
    review_note: eventLabel ? `Evento=${eventLabel}` : `Evento=${eventCode}`,
  });
}

const naturalCandidates = new Map();
for (const candidate of periodCandidates) {
  const reasons = candidate.blocking_reasons;
  if (candidate.review_status === "excluded_reviewed") {
    candidate.blocking_reasons = JSON.stringify(unique(reasons));
    continue;
  }
  if (!reasons.length && snapshotAvailable) {
    const classification = classifyExisting(candidate, currentPeriods);
    candidate.overlap_status = classification.status;
    candidate.existing_period_id = classification.existingId;
    candidate.review_note =
      [candidate.review_note, classification.reason].filter(Boolean).join(" | ") || null;
    if (classification.status === "skip_exact") candidate.review_status = "skip_exact";
    else if (classification.status !== "insert") reasons.push(`overlap:${classification.status}`);
  } else if (!snapshotAvailable) {
    reasons.push("snapshot:required");
  }

  const naturalKey = [
    candidate.legacy_code,
    candidate.tipo,
    candidate.data_inicio,
    candidate.data_fim,
    normalizeText(candidate.unidade_operacional),
    normalizeText(candidate.bsp),
  ].join("::");
  if (naturalCandidates.has(naturalKey) && candidate.review_status !== "skip_exact") {
    reasons.push(`internal_duplicate:${naturalCandidates.get(naturalKey)}`);
    candidate.overlap_status = "review_internal_duplicate";
  } else naturalCandidates.set(naturalKey, candidate.source_key);

  if (reasons.length) candidate.review_status = "blocked";
  candidate.blocking_reasons = JSON.stringify(unique(reasons));
}

const functionCandidates = [];
for (const row of jobList) {
  const allocationCode = pick(row, ["Cod_Alocacao"]);
  const legacyCode = pick(row, ["Cod_Funcionario1"]);
  const mapping = mappingByLegacyCode.get(legacyCode);
  const context = allocationContext(row);
  const start =
    parseAccessDate(pick(row, ["Dt_Embarque"])) || parseAccessDate(pick(row, ["Dt_Inicio_Aloc"]));
  const end = parseAccessDate(pick(row, ["Dt_Desembarque"]));
  const role = pick(row, ["Funcao"]);
  const issues = baseIssues(legacyCode, context);
  if (!role) issues.push("function:missing");
  if (!start) issues.push("date:missing_start");
  if (start && end && end < start) issues.push("date:end_before_start");
  let existingFunctionId = null;
  if (!snapshotAvailable) issues.push("snapshot:required");
  else if (!issues.length) {
    const exact = currentFunctions.find(
      (current) =>
        current.colaborador_id === mapping.resolved_collaborator_id &&
        normalizeText(current.funcao) === normalizeText(role) &&
        normalizeText(current.embarcacao) === normalizeText(context.vesselName) &&
        current.data_inicio === start &&
        (current.data_fim || "") === (end || "") &&
        (current.cod_alocacao || "") === allocationCode,
    );
    existingFunctionId = exact?.id ?? null;
  }
  functionCandidates.push({
    run_id: runId,
    source_key: `access:function:${allocationCode}`,
    legacy_code: legacyCode,
    colaborador_id: mapping?.resolved_collaborator_id ?? null,
    funcao: role,
    embarcacao: context.vesselName,
    data_inicio: start,
    data_fim: end,
    cod_alocacao: allocationCode,
    source_hash: hashRecord({
      allocationCode,
      legacyCode,
      role,
      vessel: context.vesselName,
      start,
      end,
    }),
    source_payload: JSON.stringify(row),
    target_function_id: randomUUID(),
    review_status: existingFunctionId ? "skip_exact" : issues.length ? "blocked" : "pending",
    existing_function_id: existingFunctionId,
    blocking_reasons: JSON.stringify(unique(issues)),
    review_note: null,
  });
}

const eventCatalog = Array.from(eventCatalogMap.values())
  .map((row) => ({
    ...row,
    normalized_label: normalizeText(row.event_label),
    mapped_type: config.eventTypeByLabel?.[normalizeText(row.event_label)] ?? null,
    mapping_status: config.eventTypeByLabel?.[normalizeText(row.event_label)]
      ? "configured"
      : rawOnlyEventLabels.has(normalizeText(row.event_label))
        ? "raw_only"
        : "review_required",
  }))
  .sort((a, b) => b.rows - a.rows || a.event_code.localeCompare(b.event_code));

const unitCatalog = Array.from(
  jobList
    .reduce((map, row) => {
      const context = allocationContext(row);
      const key = context.vesselCode || "(vazio)";
      const current = map.get(key) ?? {
        unit_code: context.vesselCode,
        unit_name: context.vesselName,
        allocations: 0,
      };
      current.allocations += 1;
      map.set(key, current);
      return map;
    }, new Map())
    .values(),
).sort((a, b) => b.allocations - a.allocations);

const projectCatalog = Array.from(
  jobList
    .reduce((map, row) => {
      const context = allocationContext(row);
      const key = context.projectCode || "(vazio)";
      const current = map.get(key) ?? {
        project_code: context.projectCode,
        project_bsp: context.projectBsp,
        project_description: pick(context.projectRow, ["Descricao"]),
        num_po_catalog: pick(context.projectRow, ["NumPO", "Num_PO"]),
        allocations: 0,
        mapping_status:
          context.projectCode && !context.projectRow ? "review_required" : "catalog_match",
      };
      current.allocations += 1;
      map.set(key, current);
      return map;
    }, new Map())
    .values(),
).sort((a, b) => b.allocations - a.allocations);

const sourceSha256 = manifest?.sourceSha256 || hashRecord(jobList);
const runRows = [
  {
    run_id: runId,
    source_file: manifest?.sourcePath || jobListPath,
    source_sha256: sourceSha256,
    source_modified_at: manifest?.sourceModifiedAtUtc ?? null,
    status: "staged",
    notes: snapshotAvailable
      ? `Snapshot Supabase de ${snapshotSummary.capturedAtUtc}`
      : "Auditoria parcial: snapshot confiável do Supabase ainda não fornecido.",
  },
];

const periodHeaders = [
  "run_id",
  "source_key",
  "source_kind",
  "legacy_code",
  "colaborador_id",
  "unidade_operacional",
  "bsp",
  "tipo",
  "data_inicio",
  "data_fim",
  "dias",
  "origem",
  "source_hash",
  "source_payload",
  "target_period_id",
  "review_status",
  "overlap_status",
  "existing_period_id",
  "blocking_reasons",
  "review_note",
];
const functionHeaders = [
  "run_id",
  "source_key",
  "legacy_code",
  "colaborador_id",
  "funcao",
  "embarcacao",
  "data_inicio",
  "data_fim",
  "cod_alocacao",
  "source_hash",
  "source_payload",
  "target_function_id",
  "review_status",
  "existing_function_id",
  "blocking_reasons",
  "review_note",
];
const collaboratorHeaders = [
  "run_id",
  "legacy_code",
  "matricula_base",
  "sufixo",
  "empresa_esperada",
  "resolution_status",
  "resolved_collaborator_id",
  "source_name",
  "current_name",
  "proposed_matricula",
  "proposed_nome",
  "review_note",
  "source_payload",
];

const blockingIssues = [];
for (const candidate of [...periodCandidates, ...functionCandidates]) {
  const reasons = JSON.parse(candidate.blocking_reasons || "[]");
  for (const reason of reasons)
    blockingIssues.push({
      source_key: candidate.source_key,
      legacy_code: candidate.legacy_code,
      reason,
    });
}
for (const event of eventStageRows) {
  if (event.review_status === "blocked") {
    blockingIssues.push({
      source_key: event.source_key,
      legacy_code: event.legacy_code,
      reason: "event:handling_review_required",
    });
  }
}

await Promise.all([
  writeCsv(path.join(outputDirectory, "run.csv"), runRows),
  writeCsv(
    path.join(outputDirectory, "collaborator-mapping.csv"),
    collaboratorMappings,
    collaboratorHeaders,
  ),
  writeCsv(path.join(outputDirectory, "period-candidates.csv"), periodCandidates, periodHeaders),
  writeCsv(
    path.join(outputDirectory, "function-candidates.csv"),
    functionCandidates,
    functionHeaders,
  ),
  writeCsv(path.join(outputDirectory, "event-staging.csv"), eventStageRows),
  writeCsv(
    path.join(outputDirectory, "jornada-staging.csv"),
    jornadas.map((row) => ({
      run_id: runId,
      jornada_code: pick(row, ["IdJornada"]),
      turno: pick(row, ["Turno"]),
      tipo_jornada: pick(row, ["TipoJornada"]),
      tempo_jornada: pick(row, ["TempoJornada"]),
      intervalo_jornada: pick(row, ["IntervaloJornada"]),
      descricao_jornada: pick(row, ["DescricaoJornada"]),
      inicio_jornada: pick(row, ["IncioJornada"]),
      termino_jornada: pick(row, ["TerminoJornada"]),
      tempo_paradas: pick(row, ["TempoParadas"]),
      duracao_jornada: pick(row, ["DuracaoJornada"]),
      inicio_normal_hora_extra: pick(row, ["InicioNormalHoraExtra"]),
      inicio_adicional_noturno: pick(row, ["InicioAdicionalNoturno"]),
      termino_adicional_noturno: pick(row, ["TerminoAdicionalNoturno"]),
      duracao_adicional_noturno: pick(row, ["DuracaoAdicionalNoturno"]),
      source_hash: hashRecord(row),
      source_payload: JSON.stringify(row),
    })),
  ),
  writeCsv(path.join(outputDirectory, "event-catalog.csv"), eventCatalog),
  writeCsv(path.join(outputDirectory, "unit-catalog.csv"), unitCatalog),
  writeCsv(path.join(outputDirectory, "project-catalog.csv"), projectCatalog),
  writeCsv(path.join(outputDirectory, "blocking-issues.csv"), blockingIssues),
  writeCsv(path.join(outputDirectory, "access-table-counts.csv"), tableCounts),
]);

const starts = periodCandidates
  .map((row) => row.data_inicio)
  .filter(Boolean)
  .sort();
const ends = periodCandidates
  .map((row) => row.data_fim)
  .filter(Boolean)
  .sort();
const allocationStarts = jobList
  .map(
    (row) =>
      parseAccessDate(pick(row, ["Dt_Embarque"])) || parseAccessDate(pick(row, ["Dt_Inicio_Aloc"])),
  )
  .filter(Boolean)
  .sort();
const allocationEnds = jobList
  .map((row) => parseAccessDate(pick(row, ["Dt_Desembarque"])))
  .filter(Boolean)
  .sort();
const rawEventStarts = eventStageRows
  .map((row) => row.data_inicio)
  .filter(Boolean)
  .sort();
const rawEventEnds = eventStageRows
  .map((row) => row.data_fim)
  .filter(Boolean)
  .sort();
const summary = {
  formatVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  runId,
  source: {
    file: manifest?.sourcePath || jobListPath,
    sha256: sourceSha256,
    readOnlyExtract: manifest?.readOnly ?? true,
  },
  snapshot: {
    available: snapshotAvailable,
    capturedAtUtc: snapshotSummary?.capturedAtUtc ?? null,
    counts: snapshotSummary?.counts ?? null,
  },
  access: {
    allocations: jobList.length,
    weeklyEvents: hours.length,
    jornadas: jornadas.length,
    distinctLegacyCodes: legacyCodes.length,
    distinctProjects: unique(jobList.map((row) => pick(row, ["Num_Projeto"]))).length,
    distinctUnits: unique(jobList.map((row) => pick(row, ["Cod_Embarcacao"]))).length,
    allocationRange: {
      min: allocationStarts[0] ?? null,
      max: [allocationStarts.at(-1), allocationEnds.at(-1)].filter(Boolean).sort().at(-1) ?? null,
    },
    rawEventRange: {
      min: rawEventStarts[0] ?? null,
      max: rawEventEnds.at(-1) ?? rawEventStarts.at(-1) ?? null,
    },
    candidatePeriodRange: {
      min: starts[0] ?? null,
      max: [starts.at(-1), ends.at(-1)].filter(Boolean).sort().at(-1) ?? null,
    },
    openAllocations: jobList.filter((row) => !parseAccessDate(pick(row, ["Dt_Desembarque"])))
      .length,
    suffixCounts: countBy(
      jobList,
      (row) => splitLegacyCode(pick(row, ["Cod_Funcionario1"])).suffix,
    ),
  },
  mappings: countBy(collaboratorMappings, "resolution_status"),
  periodCandidates: countBy(periodCandidates, "review_status"),
  periodOverlap: countBy(periodCandidates, "overlap_status"),
  functionCandidates: countBy(functionCandidates, "review_status"),
  catalogs: {
    events: eventCatalog.length,
    eventsRequiringReview: eventCatalog.filter((row) => row.mapping_status === "review_required")
      .length,
    units: unitCatalog.length,
    projects: projectCatalog.length,
  },
  eventHandling: countBy(eventStageRows, "handling_status"),
  blockingIssueCount: blockingIssues.length,
  blockingReasons: countBy(blockingIssues, "reason"),
};
await writeFile(
  path.join(outputDirectory, "audit-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

const unidentified = collaboratorMappings.filter((row) => row.resolution_status === "unidentified");
const markdown = `# Auditoria da migração Access → Histograma Novo

Gerado em ${summary.generatedAtUtc}. Esta execução só leu as fontes e gerou staging local.

## Fonte Access

- Arquivo: \`${summary.source.file}\`
- SHA-256: \`${summary.source.sha256}\`
- Alocações (Tbl_JobList): **${summary.access.allocations}**
- Eventos semanais (Tbl_Horas_Semanal): **${summary.access.weeklyEvents}**
- Códigos legados distintos: **${summary.access.distinctLegacyCodes}**
- Projetos/BSP distintos na JobList: **${summary.access.distinctProjects}**
- Unidades distintas na JobList: **${summary.access.distinctUnits}**
- Alocações observadas: **${summary.access.allocationRange.min ?? "n/d"}** a **${summary.access.allocationRange.max ?? "n/d"}** (${summary.access.openAllocations} sem desembarque)
- Eventos brutos observados: **${summary.access.rawEventRange.min ?? "n/d"}** a **${summary.access.rawEventRange.max ?? "n/d"}**
- Períodos candidatos mapeados: **${summary.access.candidatePeriodRange.min ?? "n/d"}** a **${summary.access.candidatePeriodRange.max ?? "n/d"}**

## Fotografia do Supabase

${
  snapshotAvailable
    ? `Fotografia somente-leitura de ${snapshotSummary.capturedAtUtc}: ${currentCollaborators.length} colaboradores, ${currentPeriods.length} períodos e ${currentFunctions.length} funções históricas.`
    : "**Pendente.** A chave publishable é afetada por RLS e retorna zero; use o exportador com uma service role local ou exporte as três consultas descritas no README."
}

## Resolução de colaboradores

${Object.entries(summary.mappings)
  .map(([status, count]) => `- ${status}: **${count}**`)
  .join("\n")}

${unidentified.length ? `Legados explicitamente não identificados: ${unidentified.map((row) => `\`${row.legacy_code}\``).join(", ")}. Eles não serão associados por aproximação; qualquer placeholder exige aprovação manual.` : "Nenhum legado marcado como não identificado nesta execução."}

## Candidatos e bloqueios

- Candidatos a período: **${periodCandidates.length}**
- Candidatos a histórico de função: **${functionCandidates.length}**
- Eventos brutos preservados no staging: **${eventStageRows.length}**
- Ocorrências de bloqueio: **${blockingIssues.length}**
- Tipos de evento ainda a revisar: **${summary.catalogs.eventsRequiringReview}**

Nenhum candidato sai como aprovado automaticamente. Correspondências exatas podem ser marcadas como \`skip_exact\`; sobreposições com datas diferentes ou contexto divergente ficam bloqueadas para revisão.
`;
await writeFile(path.join(outputDirectory, "audit-summary.md"), markdown, "utf8");

console.log(
  JSON.stringify({
    ok: true,
    output: outputDirectory,
    runId,
    allocations: jobList.length,
    events: hours.length,
    blockingIssues: blockingIssues.length,
  }),
);
