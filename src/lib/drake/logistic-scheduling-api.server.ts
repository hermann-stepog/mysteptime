import "@tanstack/react-start/server-only";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";

// Endpoint descoberto em 2026-10-02 (capturado via DevTools na tela "Dashboard / <worker>" do
// Drake) pra corrigir um buraco real: a Ficha Anual de Posição (GetPositionsByYear, já
// sincronizada em worker-annual-position-api.server.ts) pode ficar desatualizada (mostrando "F"
// pra um dia em que a pessoa já embarcou de verdade) enquanto esse feed — o mesmo que alimenta a
// tabela "Embarques e Desembarques" na tela do Drake — já tem o embarque confirmado (Closed=true).
// Mesmo padrão de "onde está a pessoa agora" usado em todo o resto do Histograma, só que
// consultado ao vivo (sem sincronizar/gravar nada) pra uso pontual pela Auditoria Status x Drake.
const LOGISTIC_SCHEDULING_URL = "/api/v1/BI/LogisticScheduling";
const DEFAULT_LIMIT = 6;
const DEFAULT_DAYS_BEFORE = 60;
const DEFAULT_DAYS_AFTER = 120;

export interface DrakeLogisticSchedulingRow {
  workerId: string;
  date: string; // ISO, pode vir com horário (sempre T00:00:00 nos exemplos vistos)
  originDescription: string;
  destinationDescription: string;
  closed: boolean;
  closedDate: string | null;
}

export async function fetchLogisticScheduling(
  http: DrakeHttpClient,
  workerId: string,
): Promise<DrakeLogisticSchedulingRow[]> {
  const response = await http.get(LOGISTIC_SCHEDULING_URL, {
    failOnStatusCode: false,
    params: {
      daysBefore: DEFAULT_DAYS_BEFORE,
      daysAfter: DEFAULT_DAYS_AFTER,
      limit: DEFAULT_LIMIT,
      order: "desc",
      page: 1,
      workerId,
    },
  });
  if (response.status() < 200 || response.status() >= 300) {
    throw new Error(`O Drake não devolveu a programação logística do colaborador ${workerId} (HTTP ${response.status()}).`);
  }
  const raw = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`A programação logística do colaborador ${workerId} não veio em JSON válido: ${raw.slice(0, 300)}`);
  }
  // Formato real ainda sendo confirmado (2026-10-05) — aceita tanto um array na raiz quanto os
  // envelopes comuns de outros endpoints do Drake neste projeto ({items:[]}/{Items:[]}/
  // {data:[]}/{Data:[]}/{results:[]}/{Results:[]}), antes de desistir. Se nenhum bater, o erro
  // mostra um pedaço da resposta de verdade em vez de só dizer "formato inesperado".
  const items = Array.isArray(value)
    ? value
    : isRecord(value)
      ? (value.items ?? value.Items ?? value.data ?? value.Data ?? value.results ?? value.Results)
      : undefined;
  if (!Array.isArray(items)) {
    throw new Error(`A programação logística do colaborador ${workerId} veio num formato inesperado: ${raw.slice(0, 300)}`);
  }
  return items.map((item) => parseRow(item, workerId));
}

function parseRow(value: unknown, workerId: string): DrakeLogisticSchedulingRow {
  if (!isRecord(value)) throw new Error(`Linha de programação logística inválida pro colaborador ${workerId}.`);
  return {
    workerId: optionalString(value.WorkerId) ?? workerId,
    date: requiredString(value.Date, "data"),
    originDescription: optionalString(value.OriginDescription) ?? "",
    destinationDescription: optionalString(value.DestinationDescription) ?? "",
    closed: value.Closed === true,
    closedDate: optionalString(value.ClosedDate),
  };
}

export type StatusLogisticScheduling = "embarcado" | "na_base" | null;

// A linha mais recente que JÁ ACONTECEU DE VERDADE diz onde a pessoa está: se o destino não é a
// base, ela embarcou e ainda não tem o desembarque correspondente; senão, está na base.
// "Já aconteceu de verdade" tem duas regras diferentes:
//  - Data ANTERIOR a hoje: conta mesmo sem "Closed" — um embarque recente pode já ter
//    acontecido de verdade mas ainda não ter sido fechado/reconciliado administrativamente no
//    Drake (caso real do Airton Araujo de Morais, 2026-10-02: embarque ainda não "Closed" fazia
//    cair pro desembarque fechado anterior, concluindo "na base" errado).
//  - Data de HOJE: só conta se "Closed" for true — um evento agendado pra hoje mesmo pode ainda
//    não ter ocorrido (caso real do Marcelo Pfeiffer, 2026-10-05: desembarque agendado pra hoje
//    mas ainda pendente/sem confirmação — contar como "já aconteceu" dava "na base" errado
//    enquanto ele ainda estava embarcado).
// Datas futuras nunca contam, com ou sem Closed.
// null = nenhuma linha qualificada no período consultado (não dá pra afirmar nada).
export function statusAtualViaLogisticScheduling(rows: DrakeLogisticSchedulingRow[], hoje: string): StatusLogisticScheduling {
  const jaAconteceram = rows
    .filter((r) => {
      const data = r.date.slice(0, 10);
      if (data < hoje) return true;
      if (data === hoje) return r.closed;
      return false;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const maisRecente = jaAconteceram[0];
  if (!maisRecente) return null;
  return maisRecente.destinationDescription.trim().toUpperCase() === "BASE" ? "na_base" : "embarcado";
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value);
  if (!parsed) throw new Error(`O Drake não informou ${field} na programação logística.`);
  return parsed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
