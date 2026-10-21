/** O retrato atual usa a lista viva; médias/fotos ficam para consultas históricas. */
export function dashboardStatusDates(dates: string[], referenceDate: string, today: string): string[] {
  return dates.includes(today) || referenceDate === today
    ? [today]
    : dates.length > 0 ? dates : [referenceDate];
}

export function dashboardPlanningRows<Live, Snapshot extends { snapshot_date: string }>(
  day: string,
  today: string,
  live: Live[],
  snapshots: Snapshot[],
): { source: "live"; rows: Live[] } | { source: "snapshot"; rows: Snapshot[] } {
  if (day === today) return { source: "live", rows: live };
  const rows = snapshots.filter((row) => row.snapshot_date === day);
  return rows.length > 0 ? { source: "snapshot", rows } : { source: "live", rows: live };
}