import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const operationalSources = [
  "src/routes/admin/histograma-novo.tsx",
  "src/routes/admin/timesheet-offshore.tsx",
  "src/routes/admin/hospedagem.tsx",
  "src/routes/admin/passagens-aereas.tsx",
  "src/routes/admin/nominations.tsx",
  "src/routes/pm/index.tsx",
  "src/components/histograma/DrakeUpdateCard.tsx",
  "src/routes/admin/bm.tsx",
  "src/components/bm/TimesheetsTab.tsx",
  "src/lib/bmExcel.ts",
];

describe("visibilidade de colaboradores inativos", () => {
  it.each(operationalSources)("filtra ativo=true em %s", (file) => {
    const source = readFileSync(resolve(file), "utf8");
    expect(source).toContain('.eq("ativo", true)');
  });

  it("não exibe embarques e pendências de inativos na tela operacional", () => {
    const source = readFileSync(resolve("src/routes/admin/timesheet-offshore.tsx"), "utf8");
    expect(source.match(/!!r\.colaborador/g)).toHaveLength(2);
  });

  it("separa no cache o cadastro completo da lista reduzida de nomes", () => {
    const histogram = readFileSync(resolve("src/routes/admin/histograma-novo.tsx"), "utf8");
    const timesheet = readFileSync(resolve("src/routes/admin/timesheet-offshore.tsx"), "utf8");
    const hotels = readFileSync(resolve("src/routes/admin/hospedagem.tsx"), "utf8");
    const flights = readFileSync(resolve("src/routes/admin/passagens-aereas.tsx"), "utf8");

    expect(histogram).toContain('["hist-novo-colaboradores", "ativos", "completo"]');
    expect(timesheet).toContain('["hist-novo-colaboradores", "ativos", "completo"]');
    expect(hotels).toContain('["hist-novo-colaboradores", "ativos", "nomes"]');
    expect(flights).toContain('["hist-novo-colaboradores", "ativos", "nomes"]');
  });

  it("não permite que a sincronização Drake reative um cadastro local", () => {
    const sync = readFileSync(resolve("src/lib/drake/annual-position-sync.server.ts"), "utf8");
    const importer = readFileSync(resolve("src/lib/histograma/import-annual-position.server.ts"), "utf8");

    expect(sync).toContain("loadActiveHistogramWorkerKeys");
    expect(sync).not.toContain(".update({ ativo: true })");
    expect(importer).toContain('.eq("ativo", true)');
  });

  it("remove o grafo histórico dos inativos antes de exibir e calcular", () => {
    const histogram = readFileSync(resolve("src/routes/admin/histograma-novo.tsx"), "utf8");
    const timesheet = readFileSync(resolve("src/routes/admin/timesheet-offshore.tsx"), "utf8");

    expect(histogram).toContain("todosPeriodos.filter((periodo) => activeIds.has(periodo.colaborador_id))");
    expect(timesheet).toContain("todosEmbarques.filter((e) => activeIds.has(e.colaborador_id))");
    expect(timesheet).toContain("todosDias.filter((d) => activeWeekIds.has(d.semana_id))");
  });
});
