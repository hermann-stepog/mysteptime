import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260805130000_drake_histogram_atomic_sync.sql";

describe("integridade da sincronização do histograma Drake", () => {
  const migration = readFileSync(migrationPath, "utf8");
  const embarkationImporter = readFileSync("src/lib/histograma/import-drake.ts", "utf8");
  const availabilityImporter = readFileSync("src/lib/histograma/import-disponibilidade.ts", "utf8");

  it("serializa a reconciliação e grava o snapshot por RPC atômica", () => {
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(/sync_drake_histogram_snapshot/);
    expect(embarkationImporter).toMatch(/synchronizeDrakeHistogramSnapshot/);
    expect(availabilityImporter).toMatch(/synchronizeDrakeHistogramSnapshot/);
  });

  it("protege chaves de trabalhador, evento e timesheet contra duplicação", () => {
    expect(migration).toMatch(/hist_novo_colaboradores_drake_worker_key_uidx/);
    expect(migration).toMatch(/hist_novo_periodos_drake_event_key_uidx/);
    expect(migration).toMatch(/timesheet_embarques_source_event_key_uidx/);
  });

  it("remove obsoletos somente da mesma origem e da janela sincronizada", () => {
    expect(migration).toMatch(
      /DELETE FROM public\.hist_novo_periodos[\s\S]*period\.origem = p_source[\s\S]*period\.data_fim >= p_window_start[\s\S]*period\.data_inicio <= p_window_end/,
    );
    expect(migration).not.toMatch(/DELETE FROM public\.hist_novo_colaboradores/i);
  });

  it("aborta a transação se algum evento não tiver sido confirmado", () => {
    expect(migration).toMatch(/v_synchronized_periods <> v_period_count/);
    expect(migration).toMatch(/sincronização inteira foi cancelada/);
  });

  it("não contém mais limpeza por sobreposição nem delete-all-then-insert no aplicativo", () => {
    expect(embarkationImporter).not.toMatch(/limparPeriodosDrakeEmbarqueSuperados/);
    expect(embarkationImporter).not.toMatch(/\.delete\(\)/);
    expect(availabilityImporter).not.toMatch(/\.delete\(\)/);
  });

  it("não remove tabelas nem apaga lançamentos manuais", () => {
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/TRUNCATE/i);
    expect(migration).not.toMatch(/origem\s*=\s*['"]manual['"]/i);
  });
});
