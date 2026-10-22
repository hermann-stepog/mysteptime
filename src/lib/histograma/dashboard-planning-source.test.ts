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

  it("não aplica médias nem fotos históricas aos cartões quando o filtro é passado", () => {
    const dates = ["2026-10-19", "2026-10-20"];
    expect(dashboardStatusDates(dates, "2026-10-20", today)).toEqual([today]);
    const historical = [{ snapshot_date: "2026-10-20", status: "FOLGA" }];
    expect(dashboardPlanningRows("2026-10-20", today, [{ status: "EMBARCADO" }], historical))
      .toEqual({ source: "live", rows: [{ status: "EMBARCADO" }] });
  });

  it("mantém os totais do planejamento mesmo em filtros futuros ou anteriores a setembro", () => {
    expect(dashboardStatusDates(["2026-11-01", "2026-11-02"], "2026-11-02", today)).toEqual([today]);
    expect(dashboardStatusDates(["2026-08-01", "2026-08-02"], "2026-08-02", today)).toEqual([today]);
  });
});