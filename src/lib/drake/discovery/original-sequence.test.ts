import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DrakeOperation,
  buildReportTimeline,
  classifySignalRProtocol,
  compareToCurrentSequence,
  writeSequenceComparisonReport,
  type RawCapture,
} from "./original-sequence.server";

function capture(withExecute = true): RawCapture {
  const execute = {
    id: "execute-request",
    timestamp: "2026-07-16T10:00:02.000Z",
    method: "POST",
    url: "https://drake.bz/api/v2/Queries/Query/Execute?access_token=never-save-me",
    postData: {
      executionParameters: [{ name: "@INI", value: "2026-01-01" }],
      queryId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      skip: 0,
      take: 100,
      executionRequestId: "dynamic-request-id",
      signalRConnectionId: "dynamic-signalr-id",
      queryType: "Deployed",
    },
  };
  return {
    markers: [
      { name: "REPORT_1_START", timestamp: "2026-07-16T10:00:00.000Z" },
      { name: "REPORT_1_END", timestamp: "2026-07-16T10:00:05.000Z" },
      { name: "REPORT_14_START", timestamp: "2026-07-16T10:00:00.000Z" },
      { name: "REPORT_14_END", timestamp: "2026-07-16T10:00:05.000Z" },
    ],
    requests: [
      {
        id: "export-request",
        timestamp: "2026-07-16T10:00:03.000Z",
        method: "POST",
        url: "https://drake.bz/api/v2/Queries/Query/ExportToExcel",
        postData: {
          params: [{ name: "@INI", value: "16/07/2026" }],
          queryId: "dynamic-query-id",
          queryCode: 1,
          queryName: "Relatório",
          signalRConnectionId: "another-dynamic-id",
        },
      },
      ...(withExecute ? [execute] : []),
    ],
    responses: [
      {
        requestId: "execute-request",
        status: 200,
        contentType: "application/json",
        jsonBody: { scheduled: true, scheduledBackgroundJobId: "dynamic-job-id" },
        bodyCaptured: true,
      },
    ],
  };
}

describe("analisador da sequência original Drake", () => {
  it("ordena a sequência por timestamp", () => {
    const sequence = buildReportTimeline(capture(), "REPORT_1");
    expect(sequence.timeline.map((entry) => entry.operation)).toEqual([
      DrakeOperation.EXECUTE_QUERY,
      DrakeOperation.EXPORT_TO_EXCEL,
    ]);
  });

  it("detecta Execute antes de ExportToExcel", () => {
    const sequence = buildReportTimeline(capture(), "REPORT_1");
    expect(sequence.executeContract).not.toBeNull();
    expect(sequence.timeline.findIndex((entry) => entry.operation === DrakeOperation.EXECUTE_QUERY)).toBeLessThan(
      sequence.timeline.findIndex((entry) => entry.operation === DrakeOperation.EXPORT_TO_EXCEL),
    );
  });

  it("identifica Execute ausente na sequência atual", () => {
    const original = buildReportTimeline(capture(), "REPORT_1");
    const result = compareToCurrentSequence(original, {
      operations: [DrakeOperation.EXPORT_TO_EXCEL],
      signalRConnectionIdProvided: false,
    });
    expect(result.conclusion).toBe("MISSING_QUERY_EXECUTE");
  });

  it("identifica SignalR clássico", () => {
    expect(
      classifySignalRProtocol([{ method: "GET", url: "https://drake.bz/signalr/negotiate" }]),
    ).toBe("aspnet-signalr-classic");
  });

  it("identifica SignalR ASP.NET Core pela negociação e connectionId", () => {
    expect(
      classifySignalRProtocol([
        { method: "POST", url: "https://drake.bz/hub/negotiate", response: { connectionId: "dynamic" } },
      ]),
    ).toBe("aspnet-core-signalr");
  });

  it("compara payloads pelas chaves e tipos", () => {
    const original = buildReportTimeline(capture(), "REPORT_1");
    const result = compareToCurrentSequence(original, {
      operations: [DrakeOperation.EXECUTE_QUERY, DrakeOperation.EXPORT_TO_EXCEL],
      executeContract: { ...original.executeContract!, types: { ...original.executeContract!.types, take: "string" } },
      exportContract: original.exportContract,
      signalRConnectionIdProvided: true,
    });
    expect(result.conclusion).toBe("PAYLOAD_CONTRACT_MISMATCH");
  });

  it("ignora valores dinâmicos ao comparar contratos", () => {
    const original = buildReportTimeline(capture(), "REPORT_1");
    const result = compareToCurrentSequence(original, {
      operations: [DrakeOperation.EXECUTE_QUERY, DrakeOperation.EXPORT_TO_EXCEL],
      executeContract: structuredClone(original.executeContract),
      exportContract: structuredClone(original.exportContract),
      signalRConnectionIdProvided: true,
    });
    expect(result.conclusion).toBe("MATCHES_ORIGINAL");
  });

  it("sobrescreve o arquivo de comparação", async () => {
    const original = buildReportTimeline(capture(), "REPORT_1");
    const first = compareToCurrentSequence(original, { operations: [] });
    const second = { ...first, conclusion: "INCONCLUSIVE" as const };
    const target = await writeSequenceComparisonReport(first);
    expect(await writeSequenceComparisonReport(second)).toBe(target);
    expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({ conclusion: "INCONCLUSIVE" });
  });

  it("não serializa segredos ou IDs dinâmicos", () => {
    const original = buildReportTimeline(capture(), "REPORT_1");
    const serialized = JSON.stringify(compareToCurrentSequence(original, { operations: [] }));
    expect(serialized).not.toContain("never-save-me");
    expect(serialized).not.toContain("dynamic-signalr-id");
    expect(serialized).not.toContain("dynamic-job-id");
    expect(serialized).not.toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});
