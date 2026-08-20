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
});
