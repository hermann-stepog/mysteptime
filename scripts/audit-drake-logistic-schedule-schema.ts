/**
 * Auditoria somente leitura do contrato bruto de LogisticScheduling.
 * A resposta completa fica em private/drake-audit e nunca deve ser commitada.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EnvironmentCredentialsDrakeAuthProvider } from "../src/lib/drake/auth/environment-credentials-auth.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "../src/lib/drake/http/create-drake-http-client.server";

loadEnv(path.resolve(".env"));

const capturePath = path.resolve("private", "drake-audit", "source-2026-08-20.json");
const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
  workers: Array<{
    drakeWorkerId: string;
    positions: Array<{ OccurrenceAcronym: string }>;
  }>;
};
const workerIds = capture.workers
  .filter((worker) =>
    worker.positions.some((position) => ["E", "D"].includes(position.OccurrenceAcronym)),
  )
  .slice(0, 30)
  .map((worker) => worker.drakeWorkerId);

const auth = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
const http = createDrakeHttpClientFromAuthenticatedSession(auth.authenticatedSession);

try {
  const payloads: unknown[] = [];
  const keyCounts = new Map<string, number>();
  const interestingSamples = new Map<string, Set<string>>();
  const costCenterDomain: Array<{ id: string; text: string }> = [];

  for (const workerId of workerIds) {
    const response = await http.get("/api/v1/BI/LogisticScheduling", {
      failOnStatusCode: false,
      params: {
        workerId,
        daysBefore: 500,
        daysAfter: 500,
        page: 1,
        limit: 5_000,
      },
    });
    if (response.status() < 200 || response.status() >= 300) {
      throw new Error(`LogisticScheduling devolveu HTTP ${response.status()}.`);
    }
    const payload = await response.json();
    payloads.push(payload);
    if (!isRecord(payload) || !Array.isArray(payload.Items)) continue;

    for (const item of payload.Items) {
      if (!isRecord(item)) continue;
      for (const [key, value] of Object.entries(item)) {
        keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
        if (
          !/(bsp|cost|center|project|job|destination|origin|unit|uop|contract|order|client)/i.test(
            key,
          )
        ) {
          continue;
        }
        const text = scalarText(value);
        if (!text) continue;
        const samples = interestingSamples.get(key) ?? new Set<string>();
        if (samples.size < 8) samples.add(text);
        interestingSamples.set(key, samples);
      }
    }
  }

  for (let page = 1; page <= 100; page += 1) {
    const response = await http.get("/api/v2/dqlfilter/GetDomainSets", {
      failOnStatusCode: false,
      params: {
        domainIdentifier: "ACTIVED_COST_CENTERS",
        filter: "",
        page,
        limit: 100,
      },
    });
    if (response.status() !== 200) {
      throw new Error(`ACTIVED_COST_CENTERS devolveu HTTP ${response.status()}.`);
    }
    const values = await response.json();
    if (!Array.isArray(values)) {
      throw new Error("ACTIVED_COST_CENTERS devolveu conteúdo inválido.");
    }
    for (const value of values) {
      if (!isRecord(value)) continue;
      const id = scalarText(value.id);
      const text = scalarText(value.text);
      if (id && text) costCenterDomain.push({ id, text });
    }
    if (values.length < 100) break;
  }

  const outputPath = path.resolve("private", "drake-audit", "logistic-schedule-schema.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payloads, null, 2)}\n`, "utf8");

  const codeById = new Map(
    costCenterDomain.map((item) => [item.id.trim().toLowerCase(), item.text]),
  );
  const scheduleCostCenters = payloads.flatMap((payload) =>
    isRecord(payload) && Array.isArray(payload.Items)
      ? payload.Items.flatMap((item) => {
          if (!isRecord(item)) return [];
          const id = scalarText(item.CostCenterId);
          const description = scalarText(item.CostCenterDescription);
          return id ? [{ id, description }] : [];
        })
      : [],
  );
  const unresolvedCostCenters = scheduleCostCenters.filter(
    (item) => !codeById.has(item.id.toLowerCase()),
  );

  console.log(
    JSON.stringify(
      {
        auditedWorkers: workerIds.length,
        keys: [...keyCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
        interestingSamples: Object.fromEntries(
          [...interestingSamples.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, values]) => [key, [...values]]),
        ),
        costCenterDomain: {
          count: costCenterDomain.length,
          samples: costCenterDomain.slice(0, 30),
        },
        scheduleCostCenterResolution: {
          rows: scheduleCostCenters.length,
          resolved: scheduleCostCenters.length - unresolvedCostCenters.length,
          unresolved: unresolvedCostCenters.length,
          unresolvedDescriptions: [
            ...new Set(
              unresolvedCostCenters
                .map((item) => item.description)
                .filter((value): value is string => Boolean(value)),
            ),
          ].sort(),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await http.dispose();
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]!] !== undefined) continue;
    process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}
