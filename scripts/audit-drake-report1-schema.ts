/** Auditoria somente leitura do relatório oficial de embarque/BSP. */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeApiContextFromStorageState } from "../src/lib/drake/api-session.server";
import {
  cleanupDrakeRunFiles,
  createDrakeRunFiles,
  runWithDrakeFiles,
} from "../src/lib/drake/drake-files.server";
import { API_REPORT_1 } from "../src/lib/drake/report-contracts";
import { runSingleApiReport } from "../src/lib/drake/report-api-runner.server";
import { openDrakeSignalRSession } from "../src/lib/drake/signalr-session.server";
import { normalizeHeader, parseDrakeWorkbook } from "../src/lib/histograma/import-drake";

loadEnv(path.resolve(".env"));
const runFiles = await createDrakeRunFiles();
let api: Awaited<ReturnType<typeof createDrakeApiContextFromStorageState>> | null = null;
let signalR: Awaited<ReturnType<typeof openDrakeSignalRSession>> | null = null;

try {
  await runWithDrakeFiles(runFiles, async () => {
    const auth = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
    api = await createDrakeApiContextFromStorageState(auth.storageState);
    signalR = await openDrakeSignalRSession(api);
    const report = await runSingleApiReport(api, API_REPORT_1, {
      signalRSession: signalR,
      periodNow: new Date(Date.UTC(new Date().getUTCFullYear(), 11, 31, 12)),
    });
    const workbook = XLSX.read(report.buffer, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    const rows = parseDrakeWorkbook(report.buffer);
    const bspValues = rows
      .map((row) => row.centro_de_custo)
      .filter((value): value is string => Boolean(value));
    const outputPath = path.resolve("private", "drake-audit", "report1-rows.json");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          headers: (matrix[0] ?? []).map(normalizeHeader),
          rows: rows.length,
          rowsWithoutBsp: rows.length - bspValues.length,
          distinctBspCount: new Set(bspValues).size,
          bspSamples: [...new Set(bspValues)].sort().slice(0, 30),
          outputPath,
        },
        null,
        2,
      ),
    );
  });
} finally {
  if (signalR) await signalR.close().catch(() => undefined);
  if (api) await api.dispose().catch(() => undefined);
  await cleanupDrakeRunFiles(runFiles);
}

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]!] !== undefined) continue;
    process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}
