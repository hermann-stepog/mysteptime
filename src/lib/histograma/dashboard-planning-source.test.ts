import { describe, expect, it } from "vitest";
import { dashboardPlanningRows, dashboardStatusDates } from "./dashboard-planning-source";

describe("cartões do dashboard e Planejamento de Embarque", () => {
  const today = "2026-10-21";
  it("conta o planejamento atual, não a média dos dias do mês", () => {
    expect(dashboardStatusDates(["2026-10-20", today, "2026-10-22"], today, today)).toEqual([today]);
  });

  it("ignora a foto desatualizada de hoje e mantém cada registro do planejamento", () => {
    const live = [
      { nome: "A", status: "EMBARCADO" },
      { nome: "B", status: "EMBARCADO" },
      { nome: "C", status: "FOLGA" },
    ];
    const result = dashboardPlanningRows(today, today, live, [
      { snapshot_date: today, nome: "A", status: "FOLGA" },
    ]);
    expect(result.source).toBe("live");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.filter((row) => row.status === "EMBARCADO")).toHaveLength(2);
    expect(result.rows.filter((row) => row.status === "FOLGA")).toHaveLength(1);
  });

  it("preserva as datas e fotos nas consultas históricas", () => {
    const dates = ["2026-10-19", "2026-10-20"];
    expect(dashboardStatusDates(dates, "2026-10-20", today)).toEqual(dates);
    const historical = [{ snapshot_date: "2026-10-20", status: "FOLGA" }];
    expect(dashboardPlanningRows("2026-10-20", today, [{ status: "EMBARCADO" }], historical))
      .toEqual({ source: "snapshot", rows: historical });
  });
});