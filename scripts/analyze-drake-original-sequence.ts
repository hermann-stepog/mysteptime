/**
 * Analisa a captura original e compara com a sequência atual.
 * npm run drake:analyze:original-sequence
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  DrakeOperation,
  buildReportTimeline,
  compareToCurrentSequence,
  loadRawCaptureInMemory,
  writeSequenceComparisonReport,
} from "../src/lib/drake/discovery/original-sequence.server";

const defaultRawPath =
  "C:\\dev\\Bruna\\Drake\\drake-report-automation\\artifacts\\api-discovery\\raw\\drake-api-raw-2026-07-16T16-52-24-512Z.json";

loadEnvFile(path.resolve(".env"));
const rawPath = process.env.DRAKE_DISCOVERY_RAW_PATH?.trim() || defaultRawPath;

if (!existsSync(rawPath)) {
  throw new Error(
    "Captura original da API Drake não encontrada. Configure DRAKE_DISCOVERY_RAW_PATH para executar a comparação de contratos.",
  );
}

console.log("Captura original localizada");

const raw = await loadRawCaptureInMemory(rawPath);

// Sequência atual após a correção (Execute → Export com SignalR)
const currentSequence = {
  operations: [
    DrakeOperation.LOAD_QUERY,
    DrakeOperation.EXECUTE_QUERY,
    DrakeOperation.EXPORT_TO_EXCEL,
    DrakeOperation.POLL_EXPORT_JOB,
    DrakeOperation.DOWNLOAD_TEMPORARY_FILE,
  ],
  executeContract: {
    keys: [
      "executionParameters",
      "executionRequestId",
      "queryId",
      "queryType",
      "signalRConnectionId",
      "skip",
      "take",
    ].sort(),
    types: {
      executionParameters: "array" as const,
      queryId: "string" as const,
      skip: "number" as const,
      take: "number" as const,
      executionRequestId: "string" as const,
      signalRConnectionId: "string" as const,
      queryType: "string" as const,
    },
    parameterNames: [],
    hasSignalRConnectionId: true,
  },
  exportContract: {
    keys: ["params", "queryCode", "queryId", "queryName", "signalRConnectionId"].sort(),
    types: {
      params: "array" as const,
      queryId: "string" as const,
      queryCode: "number" as const,
      queryName: "string" as const,
      signalRConnectionId: "string" as const,
    },
    parameterNames: [],
    hasSignalRConnectionId: true,
  },
  signalRConnectionIdProvided: true,
};

const reports = ["REPORT_1", "REPORT_14"] as const;
const comparisons = reports.map((report) => {
  const original = buildReportTimeline(raw, report);
  console.log(
    report === "REPORT_1"
      ? "Sequencia do relatorio 1 analisada"
      : "Sequencia do relatorio 14 analisada",
  );
  return compareToCurrentSequence(original, currentSequence);
});

const first = comparisons[0]!;
const protocol = first.original.signalRProtocol;
const executeBeforeExport = first.original.timeline.findIndex(
  (e) => e.operation === DrakeOperation.EXECUTE_QUERY,
) < first.original.timeline.findIndex((e) => e.operation === DrakeOperation.EXPORT_TO_EXCEL);
const signalROnExecute = Boolean(first.original.executeContract?.hasSignalRConnectionId);
const signalROnExport = Boolean(first.original.exportContract?.hasSignalRConnectionId);
const differences = comparisons.flatMap((c) => c.differences);
const conclusion = comparisons.some((c) => c.conclusion !== "MATCHES_ORIGINAL")
  ? comparisons.find((c) => c.conclusion !== "MATCHES_ORIGINAL")!.conclusion
  : "MATCHES_ORIGINAL";

const outputPath = await writeSequenceComparisonReport({
  generatedAt: new Date().toISOString(),
  capturePathConfigured: Boolean(process.env.DRAKE_DISCOVERY_RAW_PATH?.trim()),
  signalRProtocol: protocol,
  executeCalledBeforeExportInOriginal: executeBeforeExport,
  signalRConnectionIdOnExecute: signalROnExecute,
  signalRConnectionIdOnExport: signalROnExport,
  comparisons,
  conclusion,
  differences,
});

console.log(`Protocolo SignalR identificado: ${protocol}`);
console.log(`Query/Execute antes do ExportToExcel: ${executeBeforeExport ? "sim" : "nao"}`);
console.log(`signalRConnectionId no Execute: ${signalROnExecute ? "sim" : "nao"}`);
console.log(`signalRConnectionId no ExportToExcel: ${signalROnExport ? "sim" : "nao"}`);
console.log(`Diferencas encontradas: ${differences.length}`);
console.log(`Conclusao: ${conclusion}`);
console.log(`Relatorio sanitizado sobrescrito em: ${outputPath}`);

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]!] !== undefined) continue;
    process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}
