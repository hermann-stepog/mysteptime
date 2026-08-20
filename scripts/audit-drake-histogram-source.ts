/**
 * Captura somente leitura da Ficha Anual usada pelo Histograma.
 * Não chama o importador e não escreve no Supabase.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../src/lib/drake/http/create-drake-http-client.server";
import {
  fetchAnnualPositionsForWorkers,
  fetchDrakeWorkers,
} from "../src/lib/drake/worker-annual-position-api.server";

loadEnv(path.resolve(".env"));

const timeZone = process.env.DRAKE_TIMEZONE?.trim() || "America/Sao_Paulo";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const year = Number(today.slice(0, 4));

const auth = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
const http = createDrakeHttpClientFromAuthenticatedSession(auth.authenticatedSession);

try {
  const workers = await fetchDrakeWorkers(http);
  console.log(`[audit] Drake: ${workers.length} colaboradores ativos`);
  const annualPositions = await fetchAnnualPositionsForWorkers(
    http,
    workers,
    year,
    (completed, total) => {
      if (completed === total || completed % 25 === 0) {
        console.log(`[audit] Fichas anuais: ${completed}/${total}`);
      }
    },
  );

  const occurrenceCounts = new Map<string, number>();
  let dayCount = 0;
  for (const item of annualPositions) {
    dayCount += item.positions.length;
    for (const position of item.positions) {
      const key = JSON.stringify([
        position.OccurrenceAcronym,
        position.OccurrenceDescription,
        position.OccurrenceType,
      ]);
      occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1);
    }
  }

  const payload = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    asOfDate: today,
    year,
    source: "Drake GetPositionsByYear + LogisticScheduling",
    mode: "read-only",
    workers: annualPositions.map(({ worker, positions, schedules }) => ({
      workerIdentityHash: createHash("sha256")
        .update(
          `${worker.companyName.trim().toUpperCase()}|${worker.registration.trim().toUpperCase()}`,
        )
        .digest("hex"),
      drakeWorkerId: worker.id,
      registration: worker.registration,
      companyName: worker.companyName,
      name: worker.name,
      status: worker.status,
      jobDescription: worker.jobDescription,
      payrollJobName: worker.payrollJobName,
      positions,
      schedules,
    })),
    summary: {
      activeWorkers: workers.length,
      annualPositionDays: dayCount,
      occurrences: [...occurrenceCounts.entries()]
        .map(([key, count]) => {
          const [acronym, description, occurrenceType] = JSON.parse(key) as [
            string,
            string,
            string | null,
          ];
          return { acronym, description, occurrenceType, count };
        })
        .sort(
          (left, right) =>
            left.acronym.localeCompare(right.acronym) ||
            left.description.localeCompare(right.description),
        ),
    },
  };

  const outputDir = path.resolve("private", "drake-audit");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `source-${today}.json`);
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[audit] Captura concluída: ${outputPath}`);
  console.log(`[audit] Dias lidos: ${dayCount}`);
  console.log(`[audit] Ocorrências distintas: ${occurrenceCounts.size}`);
} finally {
  await http.dispose();
}

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]!] !== undefined) continue;
    process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}
