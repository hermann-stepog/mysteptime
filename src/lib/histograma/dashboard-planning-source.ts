/** Cartões e indicadores de status usam sempre o planejamento vivo; média só no mensal. */
export function dashboardStatusDates(_dates: string[], _referenceDate: string, today: string): string[] {
  return [today];
}

export function dashboardPlanningRows<Live, Snapshot extends { snapshot_date: string }>(
  _day: string,
  _today: string,
  live: Live[],
  _snapshots: Snapshot[],
): { source: "live"; rows: Live[] } | { source: "snapshot"; rows: Snapshot[] } {
  return { source: "live", rows: live };
}