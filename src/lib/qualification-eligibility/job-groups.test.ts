import { describe, expect, it } from "vitest";
import { groupQualificationJobs, jobGroupBaseName } from "./job-groups";

describe("grupos de função da aptidão", () => {
  it.each([
    ["SOLDADOR", "SOLDADOR"],
    ["SOLDADOR I", "SOLDADOR"],
    ["SOLDADOR N III A", "SOLDADOR"],
    ["SOLDADOR IRATA N 2", "SOLDADOR"],
    ["SOLDADOR Ibcd", "SOLDADOR"],
    ["AJUDANTE DE ANDAIME N 3", "AJUDANTE DE ANDAIME"],
    ["AJUDANTE DE CALDERARIA", "AJUDANTE DE CALDEIRARIA"],
    ["CALDEIREIRO N II C", "CALDEIREIRO"],
    ["IRATA N3", "IRATA"],
    ["MONTADOR DE ANDAIMES / HABITAT", "MONTADOR DE ANDAIMES"],
    ["INSPETOR DE SOLDA N1/LP/PM/IRATA", "INSPETOR DE SOLDA"],
    ["PROJETISTA 3D N III B", "PROJETISTA 3D"],
  ])("agrupa %s em %s", (job, expected) => {
    expect(jobGroupBaseName(job)).toBe(expected);
  });

  it("mantém todas as funções reais e seus IDs exatamente uma vez", () => {
    const jobs = [
      { id: "soldador-1", name: "SOLDADOR I" },
      { id: "soldador-2", name: "SOLDADOR II" },
      { id: "caldeireiro-1", name: "CALDEIREIRO I" },
      { id: "caldeireiro-2", name: "CALDEIREIRO IRATA N 2" },
    ];

    const groups = groupQualificationJobs(jobs);

    expect(groups.map((group) => group.name)).toEqual(["CALDEIREIRO", "SOLDADOR"]);
    expect(groups.flatMap((group) => group.jobs.map((job) => job.id)).sort()).toEqual(
      jobs.map((job) => job.id).sort(),
    );
  });

  it("mantém opções homônimas quando o Drake fornece IDs diferentes", () => {
    const groups = groupQualificationJobs([
      { id: "first", name: "ALMOXARIFE" },
      { id: "second", name: "ALMOXARIFE" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.jobs.map((job) => job.id)).toEqual(["first", "second"]);
  });
});
