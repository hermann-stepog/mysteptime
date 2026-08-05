import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = [
  "20260803150000_course_eligibility.sql",
  "20260803183000_qualification_matrix_options.sql",
  "20260804190000_qualification_course_issue_date.sql",
] as const;

async function readMigration(name: (typeof MIGRATIONS)[number]): Promise<string> {
  return readFile(path.resolve("supabase/migrations", name), "utf8");
}

describe("qualification storage migrations", () => {
  it("são somente aditivas", async () => {
    const sql = (await Promise.all(MIGRATIONS.map(readMigration))).join("\n");

    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|SCHEMA|POLICY|INDEX)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("podem ser repetidas sem recriar objetos existentes", async () => {
    const base = await readMigration(MIGRATIONS[0]);
    const options = await readMigration(MIGRATIONS[1]);
    const issueDate = await readMigration(MIGRATIONS[2]);

    expect(base.match(/CREATE TABLE IF NOT EXISTS/gi)).toHaveLength(5);
    expect(base.match(/CREATE INDEX IF NOT EXISTS/gi)).toHaveLength(6);
    expect(base.match(/SELECT 1 FROM pg_policies/gi)).toHaveLength(5);
    expect(options).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    expect(options).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    expect(options).toMatch(/ADD COLUMN IF NOT EXISTS option_count/i);
    expect(options).toMatch(/SELECT 1 FROM pg_policies/i);
    expect(issueDate).toMatch(/ADD COLUMN IF NOT EXISTS issue_date/i);
  });
});
