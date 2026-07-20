import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { consumeDrakeNdjsonStream } from "@/lib/drake/ndjson-stream";
import type { DrakeProgressEvent } from "@/lib/drake/update-types";

const root = join(__dirname, "..", "..", "..");

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("DrakeUpdateCard — UI e streaming", () => {
  const source = read("src/components/histograma/DrakeUpdateCard.tsx");

  it("mantem barra de progresso, texto da etapa e status dos relatorios", () => {
    expect(source).toMatch(/<Progress\b/);
    expect(source).toMatch(/\{progress\}%/);
    expect(source).toMatch(/Relatório de embarque/);
    expect(source).toMatch(/Relatório de disponibilidade/);
    expect(source).toMatch(/DRAKE_REPORT_STATUS_LABEL/);
    expect(source).toMatch(/setMessage/);
  });

  it("nao chama startUpdate nem polling na montagem", () => {
    expect(source).not.toMatch(
      /getDrakeDataUpdateStatus|getLatestDrakeDataUpdate|startDrakeDataUpdate/,
    );
    expect(source).not.toMatch(/refetchInterval/);
    expect(source).not.toMatch(/updateId/);
    expect(source).not.toMatch(/drake_data_updates/);
  });

  it("clique inicia fetch de streaming NDJSON", () => {
    expect(source).toMatch(/fetch\("\/api\/integrations\/drake\/update"/);
    expect(source).toMatch(/application\/x-ndjson/);
    expect(source).toMatch(/consumeDrakeNdjsonStream/);
  });

  it("erro tecnico de path e mapeado para mensagem controlada no card", () => {
    expect(source).toMatch(/isInternalPathLeak/);
    expect(source).toMatch(/Não foi possível preparar os arquivos temporários da atualização/);
    expect(source).toMatch(/DRAKE_TEMP_STORAGE_ERROR/);
  });

  it("sucesso invalida caches do Histograma", () => {
    expect(source).toMatch(/hist-novo-colaboradores/);
    expect(source).toMatch(/hist-novo-periodos/);
    expect(source).toMatch(/Dados atualizados com sucesso/);
  });

  it("nao importa undici, playwright nem server-only", () => {
    expect(source).not.toMatch(
      /undici|playwright|app-auth\.server|update-service\.server|supabase-server-fetch/,
    );
  });
});

describe("consumeDrakeNdjsonStream", () => {
  it("atualiza percentual, mensagem e status a cada evento", async () => {
    const events: DrakeProgressEvent[] = [];
    const payload = [
      JSON.stringify({
        type: "progress",
        stage: "requesting-embarkation-report",
        progress: 25,
        message: "Solicitando relatório de embarque...",
        embarkationStatus: "processing",
        availabilityStatus: "waiting",
      }),
      JSON.stringify({
        type: "completed",
        stage: "completed",
        progress: 100,
        message: "Dados atualizados com sucesso.",
        embarkationStatus: "completed",
        availabilityStatus: "completed",
        result: { created: 1 },
      }),
      "",
    ].join("\n");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 40)));
        controller.enqueue(new TextEncoder().encode(payload.slice(40)));
        controller.close();
      },
    });

    await consumeDrakeNdjsonStream(stream, (e) => events.push(e));
    expect(events).toHaveLength(2);
    expect(events[0]?.progress).toBe(25);
    expect(events[0]?.message).toContain("embarqu");
    expect(events[0]?.embarkationStatus).toBe("processing");
    expect(events[0]?.availabilityStatus).toBe("waiting");
    expect(events[1]?.type).toBe("completed");
    expect(events[1]?.progress).toBe(100);
  });

  it("evento error e processado sem updateId", async () => {
    const events: DrakeProgressEvent[] = [];
    const line = `${JSON.stringify({
      type: "error",
      stage: "failed",
      progress: 0,
      message: "Não foi possível autenticar no Drake.",
      code: "DRAKE_AUTH_FAILED",
      embarkationStatus: "failed",
      availabilityStatus: "waiting",
    })}\n`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(line));
        controller.close();
      },
    });
    await consumeDrakeNdjsonStream(stream, (e) => events.push(e));
    expect(events[0]?.type).toBe("error");
    expect(JSON.stringify(events)).not.toMatch(/updateId/);
  });
});

describe("zero dependencia da tabela", () => {
  it("projeto sem referencias runtime a drake_data_updates", () => {
    for (const file of [
      "src/components/histograma/DrakeUpdateCard.tsx",
      "src/lib/drake/update-service.server.ts",
      "src/routes/api/integrations/drake/update.ts",
    ]) {
      expect(read(file)).not.toContain("drake_data_updates");
    }
  });

  it("API route usa NDJSON e lock em memoria", () => {
    const source = read("src/routes/api/integrations/drake/update.ts");
    expect(source).toMatch(/application\/x-ndjson/);
    expect(source).toMatch(/tryAcquireDrakeUpdateLock/);
    expect(source).toMatch(/ReadableStream/);
    expect(source).not.toMatch(/updateId/);
    expect(source).not.toMatch(/drake_data_updates/);
  });
});
