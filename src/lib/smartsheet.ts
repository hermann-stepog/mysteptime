export interface OffshorePerson {
  id: string;
  name: string;
  unit: string;
  bsp: string;
  function: string;
  especialidade: string;
  status: string;
  statusRaw: string;
  embark: string | null;
  disembark: string | null;
  timeOffStart: string | null;
  timeOffEnd: string | null;
  embark2: string | null;
  disembark2: string | null;
  timeOffStart2: string | null;
  timeOffEnd2: string | null;
  vacationStart: string | null;
  vacationFinish: string | null;
}

export type DayStatus = "E" | "P" | "D" | "B" | "FO" | "FE" | "TE" | "IND";

export function getDayStatus(p: OffshorePerson, d: string): DayStatus {
  if (p.vacationStart && p.vacationFinish && d >= p.vacationStart && d <= p.vacationFinish) return "FE";
  if (p.embark && p.disembark) {
    if (d === p.disembark) return "D";
    if (d >= p.embark && d < p.disembark) return "E";
  }
  if (p.embark2 && p.disembark2) {
    if (d === p.disembark2) return "D";
    if (d >= p.embark2 && d < p.disembark2) return "E";
  }
  if (p.timeOffStart && p.timeOffEnd && d >= p.timeOffStart && d <= p.timeOffEnd) return "FO";
  if (p.timeOffStart2 && p.timeOffEnd2 && d >= p.timeOffStart2 && d <= p.timeOffEnd2) return "FO";
  return "B";
}

// Mapeamento da coluna "Status" (aba STATUS do Smartsheet) para o status visual do dia.
// BASE/CASA/INDISPONÍVEL → indisponível (vazio, vermelho); DISPONÍVEL → disponível (vazio, sem cor); FOLGA → azul claro.
const RAW_STATUS_MAP: Record<string, DayStatus> = {
  BASE: "IND",
  CASA: "IND",
  DISPONIVEL: "B",
  "DISPONÍVEL": "B",
  EMBARCADO: "E",
  FOLGA: "FO",
  FERIAS: "FE",
  "FÉRIAS": "FE",
  INDISPONIVEL: "IND",
  "INDISPONÍVEL": "IND",
  PROGRAMADO: "P",
  "TRABALHO EXTERNO": "TE",
};

function normalizeStatusKey(s: string): string {
  return s.trim().toUpperCase();
}

// Retorna o status visual a partir do campo "Status" bruto da pessoa, ou null se não reconhecido.
export function getStatusFromField(raw: string | null | undefined): DayStatus | null {
  if (!raw) return null;
  return RAW_STATUS_MAP[normalizeStatusKey(raw)] ?? null;
}

export function parseSmartsheetRow(raw: Record<string, any>): OffshorePerson {
  return {
    id: String(raw["ID"] ?? "").trim(),
    name: String(raw["Name"] ?? "").trim(),
    unit: String(raw["Unit"] ?? "").trim(),
    bsp: String(raw["BSP"] ?? "").trim(),
    function: String(raw["Function"] ?? "").trim(),
    especialidade: String(raw["Especialidade"] ?? "").trim(),
    status: "", // preenchido depois de deduplicar/mesclar as linhas, com o status efetivo do dia
    statusRaw: String(raw["Status"] ?? "").trim(),
    embark: raw["Embark"] ?? null,
    disembark: raw["Disembark"] ?? null,
    timeOffStart: raw["TimeOff Start"] ?? null,
    timeOffEnd: raw["TimeOff End"] ?? null,
    embark2: raw["Embark 2"] ?? null,
    disembark2: raw["Disembark 2"] ?? null,
    timeOffStart2: raw["TimeOff Start 2"] ?? null,
    timeOffEnd2: raw["TimeOff End 2"] ?? null,
    vacationStart: raw["Vacation Start"] ?? null,
    vacationFinish: raw["Vacation Finish"] ?? null,
  };
}

// A planilha pode ter mais de uma linha por pessoa (ex.: uma linha por embarque/BSP).
// Agrupa por ID (ou Nome+Unidade quando não há ID) e funde os períodos de todas as
// linhas do grupo em um único registro, em vez de deixar a pessoa duplicada na lista.
export function mergeDuplicatePeople(people: OffshorePerson[]): OffshorePerson[] {
  const groups = new Map<string, OffshorePerson[]>();
  for (const p of people) {
    const key = p.id ? `id:${p.id}` : `name:${p.name.toUpperCase()}|${p.unit.toUpperCase()}`;
    const group = groups.get(key);
    if (group) group.push(p);
    else groups.set(key, [p]);
  }
  return Array.from(groups.values()).map(mergeGroup);
}

function firstNonEmpty(values: (string | null | undefined)[]): string | null {
  for (const v of values) if (v) return v;
  return null;
}

// Coleta todos os pares [início, fim] (das colunas 1 e 2, de todas as linhas do grupo),
// remove duplicados e ordena pela data de início — assim uma pessoa com 2 embarques
// espalhados em 2 linhas da planilha vira 1 registro com embark/embark2 preenchidos.
function collectPairs(group: OffshorePerson[], startKey: "embark" | "timeOffStart", endKey: "disembark" | "timeOffEnd"): [string, string][] {
  const start2Key = startKey === "embark" ? "embark2" : "timeOffStart2";
  const end2Key = endKey === "disembark" ? "disembark2" : "timeOffEnd2";
  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  for (const p of group) {
    for (const [start, end] of [[p[startKey], p[endKey]], [p[start2Key], p[end2Key]]] as const) {
      if (start && end) {
        const key = `${start}_${end}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push([start, end]);
        }
      }
    }
  }
  return pairs.sort((a, b) => a[0].localeCompare(b[0]));
}

function mergeGroup(group: OffshorePerson[]): OffshorePerson {
  const embarkPairs = collectPairs(group, "embark", "disembark");
  const timeOffPairs = collectPairs(group, "timeOffStart", "timeOffEnd");
  const vacation = group.find((p) => p.vacationStart && p.vacationFinish);

  return {
    ...group[0],
    unit: firstNonEmpty(group.map((p) => p.unit)) ?? "",
    bsp: firstNonEmpty(group.map((p) => p.bsp)) ?? "",
    function: firstNonEmpty(group.map((p) => p.function)) ?? "",
    especialidade: firstNonEmpty(group.map((p) => p.especialidade)) ?? "",
    statusRaw: firstNonEmpty(group.map((p) => p.statusRaw)) ?? "",
    embark: embarkPairs[0]?.[0] ?? null,
    disembark: embarkPairs[0]?.[1] ?? null,
    embark2: embarkPairs[1]?.[0] ?? null,
    disembark2: embarkPairs[1]?.[1] ?? null,
    timeOffStart: timeOffPairs[0]?.[0] ?? null,
    timeOffEnd: timeOffPairs[0]?.[1] ?? null,
    timeOffStart2: timeOffPairs[1]?.[0] ?? null,
    timeOffEnd2: timeOffPairs[1]?.[1] ?? null,
    vacationStart: vacation?.vacationStart ?? null,
    vacationFinish: vacation?.vacationFinish ?? null,
  };
}

// Data de "hoje" no fuso local (não UTC) — usar toISOString() aqui faria a data virar
// o dia seguinte durante a noite em fusos negativos (ex.: Brasil, UTC-3), fazendo o
// status "hoje" divergir da coluna "hoje" exibida na grade.
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function generateDateRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export const DAY_STATUS_COLOR: Record<DayStatus, string> = {
  E: "#22c55e",   // embarcado — verde
  P: "#d1d5db",   // programado — cinza claro
  D: "#f59e0b",   // desembarque (transitório) — âmbar
  B: "transparent", // disponível — vazio sem cor
  FO: "#bae6fd",  // folga — azul claro
  FE: "#f472b6",  // férias — rosa
  TE: "#eab308",  // trabalho externo — amarelo
  IND: "#f87171", // indisponível (base/casa) — vermelho claro
};

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  E: "E",
  P: "P",
  D: "D",
  B: "",
  FO: "",
  FE: "FE",
  TE: "TE",
  IND: "",
};

export const DAY_STATUS_FULL_LABEL: Record<DayStatus, string> = {
  E: "Embarcado", P: "Programado", D: "Desembarque", B: "Disponível",
  FO: "Folga", FE: "Férias", TE: "Trabalho Externo", IND: "Indisponível",
};

export const WEEKDAY_ABBR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Status calculado a partir das datas (embark/disembark/timeOff/vacation) — usado para dias != hoje.
// "P" marca só o dia exato do embarque (quando ainda não ocorreu), simétrico ao "D" que já marca
// só o dia exato do desembarque. Os demais dias da janela [embark, disembark) aparecem como "E".
export function getDateBasedStatus(p: OffshorePerson, d: string, today: string): DayStatus {
  const raw = getDayStatus(p, d);
  if (raw === "E") {
    const inPeriod1 = !!(p.embark && p.disembark && d >= p.embark && d < p.disembark);
    const relevantEmbark = inPeriod1 ? p.embark : p.embark2;
    if (relevantEmbark && relevantEmbark >= today && d === relevantEmbark) return "P";
  }
  return raw;
}

// Para hoje, usa a coluna Status (aba STATUS) da pessoa; para as demais datas, cruza com as colunas de data.
export function getDisplayStatus(p: OffshorePerson, d: string, today: string): DayStatus {
  if (d === today) return getTodayDisplayStatus(p, today);
  return getDateBasedStatus(p, d, today);
}

// As datas (embark/disembark/timeOff/vacation) mandam sempre que indicam algo em curso.
// getDateBasedStatus já retorna "P" quando o embarque começa exatamente hoje. O campo Status
// só é consultado quando as datas não dizem nada (raw === "B"), e só para diferenciar
// Base/Casa/Indisponível/Trabalho Externo — categorias sem coluna de data própria.
export function getTodayDisplayStatus(p: OffshorePerson, today: string): DayStatus {
  const display = getDateBasedStatus(p, today, today);
  if (display !== "B") return display;
  const fromStatusField = getStatusFromField(p.statusRaw);
  if (fromStatusField === "IND" || fromStatusField === "TE") return fromStatusField;
  return "B";
}
