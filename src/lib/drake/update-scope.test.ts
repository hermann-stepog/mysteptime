import { describe, expect, it } from "vitest";
import { API_REPORT_1 } from "./report-contracts";
import {
  buildReportParameters,
  isEndDateParameter,
  isStartDateParameter,
} from "./report-parameter-builder";
import { getDrakeUpdateWindow } from "./update-scope";

describe("escopo da atualização Drake", () => {
  it("mantém o ano inteiro na atualização completa", () => {
    const window = getDrakeUpdateWindow(
      "full",
      "America/Sao_Paulo",
      new Date("2026-08-21T12:00:00Z"),
    );
    expect(window).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      asOfDate: "2026-08-21",
    });
  });

  it("limita o modo rápido ao mês vigente e ao mês seguinte", () => {
    const window = getDrakeUpdateWindow(
      "current-and-next-month",
      "America/Sao_Paulo",
      new Date("2026-08-21T12:00:00Z"),
    );
    expect(window).toMatchObject({ startDate: "2026-08-01", endDate: "2026-09-30" });

    const prepared = buildReportParameters(
      API_REPORT_1,
      "America/Sao_Paulo",
      new Date("2026-08-21T12:00:00Z"),
      window,
    );
    expect(prepared.parameters.find(isStartDateParameter)?.value).toBe("2026-08-01");
    expect(prepared.parameters.find(isEndDateParameter)?.value).toBe("2026-09-30");
  });

  it("inclui janeiro do ano seguinte quando executado em dezembro", () => {
    expect(
      getDrakeUpdateWindow(
        "current-and-next-month",
        "America/Sao_Paulo",
        new Date("2026-12-15T12:00:00Z"),
      ),
    ).toMatchObject({ startDate: "2026-12-01", endDate: "2027-01-31" });
  });
});
