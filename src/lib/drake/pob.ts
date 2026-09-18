export const POB_QUERY_ID = "2168fb08-12b2-46dd-ab2b-97117a94eaae";
export const POB_LIMIT = 10000;

export function pobToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export interface PobSnapshot {
  date: string;
  total: number;
  updatedAt: string;
}

function reportDate(value: unknown): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? ""));
  if (!match) throw new Error("Data de embarque inválida no relatório Drake.");
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** Count people, never report rows or the sum of unit subtotals. */
export function countPob(result: unknown, date: string): number {
  const report = result as { columns?: { name: string }[]; rows?: unknown[][]; scheduled?: boolean; totalRows?: number; totalPages?: number } | null;
  if (!report || report.scheduled || !Array.isArray(report.columns) || !Array.isArray(report.rows)) {
    throw new Error("O Drake não retornou o relatório completo.");
  }
  if (report.rows.length >= POB_LIMIT || (report.totalRows ?? 0) > report.rows.length || (report.totalPages ?? 1) > 1) {
    throw new Error("O relatório Drake está incompleto; total não calculado.");
  }
  const indexes = ["Matricula", "Inicio Embarque", "Fim Embarque"].map(name => report.columns!.findIndex(c => c.name === name));
  if (indexes.some(i => i < 0)) throw new Error("Colunas de embarque ausentes no relatório Drake.");
  const [registration, start, end] = indexes;
  const people = new Set<string>();
  for (const row of report.rows) {
    const first = reportDate(row[start]);
    const last = reportDate(row[end]);
    if (first > date || last < date) continue;
    const id = String(row[registration] ?? "").trim().toUpperCase();
    if (!id) throw new Error("Matrícula ausente no relatório Drake.");
    people.add(id);
  }
  return people.size;
}
