export const BM_TIMESHEET_SYNC_FIELDS = [
  "colaborador_id",
  "colaborador_nome",
  "funcao",
  "unidade_operacional",
  "bsp",
  "data",
  "dia_semana",
  "evento",
  "descricao_tarefa",
  "numero_tarefa",
  "hora_entrada",
  "hora_saida",
  "hora_entrada_extra",
  "hora_saida_extra",
  "horas_normais",
  "horas_extras",
  "total_horas",
  "adicional_noturno",
  "feriado",
] as const;

type CopyRow = Record<string, unknown> & {
  source_dia_id: string;
  original?: Record<string, unknown> | null;
};

function value(value: unknown): unknown {
  return value === undefined ? null : value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(value(left)) === JSON.stringify(value(right));
}

/**
 * Atualiza a cópia com mudanças posteriores do Timesheet sem apagar ajustes manuais do BM.
 * Um campo é manual quando o valor atual diverge do snapshot `original`; nesse caso ele é
 * preservado. Registros antigos sem snapshot são tratados como cópia não editada.
 */
export function mergeBmTimesheetSource(source: CopyRow, existing?: CopyRow): { row: CopyRow; changed: boolean } {
  const snapshot: Record<string, unknown> = { source_dia_id: source.source_dia_id };
  const row: CopyRow = { source_dia_id: source.source_dia_id };
  const previousSnapshot = existing?.original && typeof existing.original === "object" ? existing.original : null;

  for (const field of BM_TIMESHEET_SYNC_FIELDS) {
    const sourceValue = value(source[field]);
    snapshot[field] = sourceValue;
    const manuallyEdited = !!existing && !!previousSnapshot && !equal(existing[field], previousSnapshot[field]);
    row[field] = manuallyEdited ? value(existing[field]) : sourceValue;
  }
  row.original = snapshot;

  const changed = !existing || BM_TIMESHEET_SYNC_FIELDS.some((field) => !equal(row[field], existing[field]))
    || !equal(snapshot, previousSnapshot);
  return { row, changed };
}
