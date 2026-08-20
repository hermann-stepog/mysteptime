/** Analisa a captura somente leitura sem consultar nem alterar o banco. */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildAnnualPositionSnapshot,
  buildWorkerKey,
  catalogAnnualPositionOccurrences,
  type AnnualPositionWorkerRow,
  type EmbarkationSourceRow,
} from "../src/lib/histograma/drake-snapshot";
import { displayAbbr, normalizeUnidadeOperacional } from "../src/lib/histogramaNovo";
import type { DrakeAnnualPositionRow } from "../src/lib/drake/worker-annual-position-api.server";
import {
  buildEmbarkationReportIndex,
  resolveEmbarkationReportRow,
} from "../src/lib/drake/annual-position-embarkation";

type Capture = {
  asOfDate: string;
  year: number;
  workers: Array<{
    drakeWorkerId: string;
    registration: string;
    companyName: string;
    name: string;
    jobDescription: string | null;
    payrollJobName: string | null;
    positions: DrakeAnnualPositionRow[];
  }>;
};

const input = process.argv[2] ?? path.resolve("private", "drake-audit", "source-2026-08-20.json");
const capture = JSON.parse(readFileSync(input, "utf8")) as Capture;
const reportInput = process.argv[3] ?? path.resolve("private", "drake-audit", "report1-rows.json");
const reportRows = JSON.parse(readFileSync(reportInput, "utf8")) as EmbarkationSourceRow[];
const embarkationIndex = buildEmbarkationReportIndex(reportRows);

let normalizedUnitChanges = 0;
let embarkationDays = 0;
let embarkationDaysWithoutUnit = 0;
let embarkationDaysWithoutCostCenter = 0;
let embarkationDaysWithDetailsUnit = 0;
let unitSourceConflicts = 0;
const sourceRows: AnnualPositionWorkerRow[] = [];

for (const worker of capture.workers) {
  const { positions } = worker;
  const mappedPositions = positions.map((position) => {
    const detailsUnit = optionalString(position.Details?.Uop);
    const isEmbarkationDay = ["E", "D"].includes(position.OccurrenceAcronym);
    const reportRow = isEmbarkationDay
      ? resolveEmbarkationReportRow(
          embarkationIndex,
          buildWorkerKey(worker.companyName, worker.registration),
          position.Date,
          detailsUnit,
        )
      : null;
    const rawUnit = reportRow?.unidade_operacional ?? detailsUnit;
    const normalizedUnit = normalizeUnidadeOperacional(rawUnit);
    if (normalize(rawUnit) !== normalize(normalizedUnit)) normalizedUnitChanges += 1;

    if (position.OccurrenceAcronym === "E" || position.OccurrenceAcronym === "D") {
      embarkationDays += 1;
      if (!normalizedUnit) embarkationDaysWithoutUnit += 1;
      if (!reportRow?.centro_de_custo) embarkationDaysWithoutCostCenter += 1;
      if (detailsUnit) embarkationDaysWithDetailsUnit += 1;
      if (
        detailsUnit &&
        reportRow?.unidade_operacional &&
        normalize(detailsUnit) !== normalize(reportRow.unidade_operacional)
      ) {
        unitSourceConflicts += 1;
      }
    }

    return {
      date: position.Date,
      occurrenceAcronym: position.OccurrenceAcronym,
      occurrenceDescription: position.OccurrenceDescription,
      occurrenceType: position.OccurrenceType,
      unidadeOperacional: normalizedUnit,
      centroDeCusto: reportRow?.centro_de_custo ?? null,
    };
  });

  sourceRows.push({
    drakeWorkerId: worker.drakeWorkerId,
    matricula: worker.registration,
    nome: worker.name,
    empresa: worker.companyName,
    funcao: worker.jobDescription,
    funcaoOperacao: worker.payrollJobName,
    positions: mappedPositions,
  });
}

const catalog = catalogAnnualPositionOccurrences(sourceRows);
const snapshot = buildAnnualPositionSnapshot(sourceRows, { asOfDate: capture.asOfDate });
const roundTrip = compareSnapshotToSource(sourceRows, snapshot.periods);
const displayMismatches = catalog.all.filter(
  (item) => item.mappedType && displayAbbr(item.mappedType) !== item.acronym,
);
const workersWithEmbarkation = new Set(
  sourceRows
    .filter((worker) => worker.positions.some((day) => day.occurrenceAcronym === "E"))
    .map((worker) => worker.drakeWorkerId),
);

console.log(
  JSON.stringify(
    {
      asOfDate: capture.asOfDate,
      activeWorkers: sourceRows.length,
      workersWithEmbarkationInYear: workersWithEmbarkation.size,
      sourceDays: sourceRows.reduce((total, worker) => total + worker.positions.length, 0),
      mappedPeriods: snapshot.periods.length,
      catalogEntries: catalog.all.length,
      unknownCatalogEntries: catalog.unknown,
      displayMismatches,
      roundTrip,
      unitNormalizationChanges: normalizedUnitChanges,
      embarkationFields: {
        embarkationDays,
        embarkationDaysWithoutUnit,
        embarkationDaysWithoutCostCenter,
        embarkationDaysWithDetailsUnit,
        unitSourceConflicts,
      },
    },
    null,
    2,
  ),
);

function compareSnapshotToSource(
  rows: AnnualPositionWorkerRow[],
  periods: ReturnType<typeof buildAnnualPositionSnapshot>["periods"],
) {
  type DayValue = {
    status: string;
    unit: string | null;
    costCenter: string | null;
  };
  const actual = new Map<string, DayValue>();
  const expected = new Map<string, DayValue>();
  let rawSourceDays = 0;
  let identicalDuplicateSourceDays = 0;
  let conflictingDuplicateSourceDays = 0;

  for (const row of rows) {
    const workerKey = buildWorkerKey(row.empresa, row.matricula);
    for (const day of row.positions) {
      rawSourceDays += 1;
      const key = `${workerKey}|${day.date}`;
      const value: DayValue = {
        status: day.occurrenceAcronym.trim().toUpperCase(),
        unit: normalizedNullable(day.unidadeOperacional),
        costCenter: normalizedNullable(day.centroDeCusto),
      };
      const previous = expected.get(key);
      if (previous) {
        if (
          previous.status === value.status &&
          normalize(previous.unit) === normalize(value.unit) &&
          normalize(previous.costCenter) === normalize(value.costCenter)
        ) {
          identicalDuplicateSourceDays += 1;
        } else {
          conflictingDuplicateSourceDays += 1;
        }
        continue;
      }
      expected.set(key, value);
    }
  }

  for (const period of periods) {
    for (const date of datesInRange(period.dataInicio, period.dataFim)) {
      actual.set(`${period.workerKey}|${date}`, {
        status: displayAbbr(period.tipo),
        unit: normalizedNullable(period.unidadeOperacional),
        costCenter: normalizedNullable(period.centroDeCusto),
      });
    }
  }

  let missingDays = 0;
  let statusMismatches = 0;
  let unitMismatches = 0;
  let costCenterMismatches = 0;
  for (const [key, source] of expected) {
    const stored = actual.get(key);
    if (!stored) {
      missingDays += 1;
      continue;
    }
    actual.delete(key);
    if (stored.status !== source.status) {
      statusMismatches += 1;
    }
    if (normalize(stored.unit) !== normalize(source.unit)) {
      unitMismatches += 1;
    }
    if (normalize(stored.costCenter) !== normalize(source.costCenter)) {
      costCenterMismatches += 1;
    }
  }

  return {
    rawSourceDays,
    uniqueSourceDays: expected.size,
    identicalDuplicateSourceDays,
    conflictingDuplicateSourceDays,
    missingDays,
    extraDays: actual.size,
    statusMismatches,
    unitMismatches,
    costCenterMismatches,
  };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalize(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizedNullable(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function datesInRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  for (let date = startDate; date <= endDate; date = addIsoDay(date, 1)) {
    result.push(date);
  }
  return result;
}

function addIsoDay(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}
