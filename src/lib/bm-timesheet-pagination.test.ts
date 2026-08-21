import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectAllPages } from "./supabasePaginate";

const root = join(__dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("paginação das horas usadas pelo BM", () => {
  it("reúne linhas posteriores ao limite padrão de 1.000 do Supabase", async () => {
    const sourceRows = Array.from({ length: 1_501 }, (_, index) => ({ id: index + 1 }));
    const rows = await selectAllPages<{ id: number }>((from, to) =>
      Promise.resolve({ data: sourceRows.slice(from, to + 1), error: null }),
    );

    expect(rows).toHaveLength(1_501);
    expect(rows.at(-1)?.id).toBe(1_501);
  });

  it.each([
    "src/routes/admin/bm.tsx",
    "src/components/bm/TimesheetsTab.tsx",
  ])("não limita os dias do timesheet às primeiras 1.000 linhas em %s", (file) => {
    const code = source(file);
    expect(code).toContain('from("timesheet_dias")');
    expect(code).toContain("selectAllPages");
    expect(code).toMatch(/from\("timesheet_dias"\)[\s\S]*?\.order\("data"\)[\s\S]*?\.order\("id"\)[\s\S]*?\.range\(from, to\)/);
  });

  it.each([
    "src/routes/admin/bm.tsx",
    "src/components/bm/TimesheetsTab.tsx",
  ])("não limita a cópia do BM às primeiras 1.000 linhas em %s", (file) => {
    const code = source(file);
    expect(code).toMatch(/from\("bm_timesheet_dias"\)[\s\S]*?\.order\([\s\S]*?\.order\("id"\)[\s\S]*?\.range\(from, to\)/);
  });
});
