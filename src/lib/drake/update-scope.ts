import { getZonedDateParts } from "./date-range";

export type DrakeUpdateScope = "full" | "current-and-next-month";

export interface DrakeUpdateWindow {
  startDate: string;
  endDate: string;
  asOfDate: string;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getDrakeUpdateWindow(
  scope: DrakeUpdateScope,
  timeZone: string,
  now = new Date(),
): DrakeUpdateWindow {
  const current = getZonedDateParts(timeZone, now);
  const asOfDate = isoDate(current.year, current.month, current.day);

  if (scope === "full") {
    return {
      startDate: isoDate(current.year, 1, 1),
      endDate: isoDate(current.year, 12, 31),
      asOfDate,
    };
  }

  const nextMonth = current.month === 12 ? 1 : current.month + 1;
  const nextMonthYear = current.month === 12 ? current.year + 1 : current.year;
  const lastDayNextMonth = new Date(Date.UTC(nextMonthYear, nextMonth, 0)).getUTCDate();
  return {
    startDate: isoDate(current.year, current.month, 1),
    endDate: isoDate(nextMonthYear, nextMonth, lastDayNextMonth),
    asOfDate,
  };
}
