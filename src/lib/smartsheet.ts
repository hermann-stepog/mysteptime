export interface OffshorePerson {
  id: string;
  name: string;
  unit: string;
  bsp: string;
  function: string;
  especialidade: string;
  status: string;
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

export type DayStatus = "E" | "P" | "D" | "B" | "FO" | "F";

export function getDayStatus(p: OffshorePerson, d: string): DayStatus {
  if (p.vacationStart && p.vacationFinish && d >= p.vacationStart && d <= p.vacationFinish) return "F";
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

export function parseSmartsheetRow(raw: Record<string, any>): OffshorePerson {
  return {
    id: String(raw["ID"] ?? "").trim(),
    name: String(raw["Name"] ?? "").trim(),
    unit: String(raw["Unit"] ?? "").trim(),
    bsp: String(raw["BSP"] ?? "").trim(),
    function: String(raw["Function"] ?? "").trim(),
    especialidade: String(raw["Especialidade"] ?? "").trim(),
    status: String(raw["Status"] ?? "").trim(),
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
  B: "#3b82f6",   // disponível — azul fechado
  FO: "#93c5fd",  // folga — azul claro
  F: "#f472b6",   // férias — rosa
};

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  E: "E",
  P: "P",
  D: "D",
  B: "B",
  FO: "FO",
  F: "F",
};

export const WEEKDAY_ABBR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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
