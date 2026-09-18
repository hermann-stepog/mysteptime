import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { EnvironmentCredentialsDrakeAuthProvider } from "./auth/environment-credentials-auth.server";
import { createDrakeHttpClientFromAuthenticatedSession } from "./http/create-drake-http-client.server";
import { openDrakeSignalRSession } from "./signalr-session.server";
import { countPob, pobToday, POB_LIMIT, POB_QUERY_ID, type PobSnapshot } from "./pob";

let cached: PobSnapshot | undefined;
let pending: Promise<PobSnapshot> | undefined;

export async function fetchTodayPob(): Promise<PobSnapshot> {
  const date = pobToday();
  if (cached?.date === date && Date.now() - Date.parse(cached.updatedAt) < 60000) return cached;
  if (pending) return pending;
  pending = readPob(date).then(result => (cached = result)).finally(() => { pending = undefined; });
  return pending;
}

async function readPob(date: string): Promise<PobSnapshot> {
  const auth = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
  const client = createDrakeHttpClientFromAuthenticatedSession(auth.authenticatedSession);
  const requestId = randomUUID();
  let hub: Awaited<ReturnType<typeof openDrakeSignalRSession>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (value: unknown) => void;
  let rejectResult!: (error: Error) => void;
  const completion = new Promise<unknown>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // The event can arrive before Execute returns. Attach a rejection handler immediately.
  void completion.catch(() => undefined);
  try {
    hub = await openDrakeSignalRSession(client, {
      executed: event => { if (event.executionRequestId === requestId) resolveResult(event.result); },
      failed: event => { if (event.executionRequestId === requestId) rejectResult(new Error("A consulta de embarcados falhou no Drake.")); },
    });
    timer = setTimeout(() => rejectResult(new Error("O Drake demorou para responder. Tente atualizar novamente.")), 60000);
    const response = await client.post("/api/v2/Queries/Query/Execute", {
      timeout: 60000, failOnStatusCode: false,
      data: {
        queryId: POB_QUERY_ID, queryType: "Custom", skip: 0, take: POB_LIMIT,
        executionRequestId: requestId, signalRConnectionId: hub.connectionId,
        executionParameters: ["@INI", "@FIM", "@matricula", "@trabalhador", "@uop", "@funcao"].map(name => ({
          name, displayText: name, dbType: name === "@INI" || name === "@FIM" ? "Date" : "String",
          value: name === "@INI" || name === "@FIM" ? date : "",
          operator: "Equal", isPreFilter: false, multiSelect: false, wellKnowDomain: null,
        })),
      },
    });
    if (response.status() !== 200) throw new Error("Não foi possível consultar os embarcados no Drake.");
    const initial = await response.json() as { scheduled?: boolean };
    const result = initial.scheduled ? await completion : initial;
    return { date, total: countPob(result, date), updatedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timer);
    await hub?.close().catch(() => undefined);
    await client.dispose();
  }
}
