export interface DrakeDateRange {
  startDate: string;
  endDate: string;
  year: number;
}

export interface ParsedDateParts {
  day: number;
  month: number;
  year: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function extractParts(parts: Intl.DateTimeFormatPart[]): ParsedDateParts {
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;

  if (!day || !month || !year) {
    throw new Error("Nao foi possivel extrair dia/mes/ano do formatador de datas.");
  }

  return {
    day: Number.parseInt(day, 10),
    month: Number.parseInt(month, 10),
    year: Number.parseInt(year, 10),
  };
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Fuso horario invalido em DRAKE_TIMEZONE: ${timeZone}`);
  }
}

export function getZonedDateParts(timeZone: string, now: Date = new Date()): ParsedDateParts {
  assertValidTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return extractParts(formatter.formatToParts(now));
}

export function formatDdMmYyyy(day: number, month: number, year: number): string {
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

export function getCurrentYearDateRange(timeZone: string, now: Date = new Date()): DrakeDateRange {
  const parts = getZonedDateParts(timeZone, now);
  const startDate = formatDdMmYyyy(1, 1, parts.year);
  const endDate = formatDdMmYyyy(parts.day, parts.month, parts.year);

  const range: DrakeDateRange = {
    startDate,
    endDate,
    year: parts.year,
  };

  assertValidDateRange(range, parts);
  return range;
}

export function parseFlexibleDate(value: string): ParsedDateParts | null {
  const trimmed = value.trim();
  const match = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const day = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[3] ?? "", 10);
  const year = Number.parseInt(match[4] ?? "", 10);
  if (
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { day, month, year };
}

export function datesAreEquivalent(a: string, b: string): boolean {
  const left = parseFlexibleDate(a);
  const right = parseFlexibleDate(b);
  if (!left || !right) {
    return false;
  }
  return left.day === right.day && left.month === right.month && left.year === right.year;
}

export function assertValidDateRange(range: DrakeDateRange, today: ParsedDateParts): void {
  const start = parseFlexibleDate(range.startDate);
  const end = parseFlexibleDate(range.endDate);
  if (!start || !end) {
    throw new Error("Periodo calculado em formato invalido.");
  }

  if (start.day !== 1 || start.month !== 1 || start.year !== today.year) {
    throw new Error(
      `Data inicial invalida: esperado 01/01/${today.year}, obtido ${range.startDate}.`,
    );
  }

  if (end.year !== today.year) {
    throw new Error(`Data final deve pertencer ao ano atual (${today.year}): ${range.endDate}.`);
  }

  const startValue = start.year * 10_000 + start.month * 100 + start.day;
  const endValue = end.year * 10_000 + end.month * 100 + end.day;
  const todayValue = today.year * 10_000 + today.month * 100 + today.day;

  if (startValue > endValue) {
    throw new Error(`Data inicial ${range.startDate} e posterior a data final ${range.endDate}.`);
  }

  if (endValue > todayValue) {
    throw new Error(`Data final ${range.endDate} e posterior a data atual.`);
  }
}
