import "@tanstack/react-start/server-only";
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  HttpClient,
  HttpResponse,
  HttpTransportType,
  LogLevel,
  type HttpRequest,
} from "@microsoft/signalr";
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "./config.server";
import type { DrakeHttpClient } from "./http/drake-http-client.types.server";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger } from "./logger";
import {
  DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB,
  DRAKE_SIGNALR_CONNECTION_FAILED,
  DRAKE_SIGNALR_PROTOCOL_UNKNOWN,
} from "./update-types";

/**
 * Canais comprovados no JS do Drake (NotificationType) necessários para Execute/Export.
 * A UI conecta com `hub?channels=a|b|c` e escuta os mesmos nomes como métodos do hub.
 */
export const DRAKE_SIGNALR_CHANNELS = [
  "BackgroundExecutionRequestCreated",
  "BackgroundExecutionRequestStatusUpdated",
  "AsyncQueryExecuted",
  "AsyncQueryFailed",
  "ReportGenerated",
  "ReportGenerationFailed",
] as const;

export interface DrakeSignalRDownloadReady {
  zipFile: string;
  zipFileName: string;
  status: string;
  backgroundCode: number | null;
  zipFileIsTemporary: boolean | null;
}

export interface DrakeSignalRSession {
  connectionId: string;
  protocol: "aspnet-core-signalr";
  transport: "long-polling";
  hubPath: string;
  /** Limpa eventos anteriores e passa a aceitar o próximo ReadyForDownload. */
  armDownloadWatch: () => void;
  waitForDownloadReady: (options: {
    timeoutMs: number;
  }) => Promise<DrakeSignalRDownloadReady>;
  close: () => Promise<void>;
}

/**
 * HttpClient SignalR com Agent undici dedicado por request.
 * Long poll + POST de handshake precisam de conexões TCP paralelas;
 * um Agent compartilhado (keep-alive) serializa e quebra o handshake.
 */
class PlaywrightSignalRHttpClient extends HttpClient {
  override async send(request: HttpRequest): Promise<HttpResponse> {
    if (!request.url) {
      throw new Error("SignalR request sem URL.");
    }
    const headers: Record<string, string> = {
      // Mesmo contrato do FetchHttpClient oficial do @microsoft/signalr.
      "X-Requested-With": "XMLHttpRequest",
    };
    if (request.headers) {
      for (const [key, value] of Object.entries(request.headers)) {
        if (value != null) headers[key] = String(value);
      }
    }
    const content = request.content === "" ? undefined : request.content;
    if (
      content != null &&
      !headers["Content-Type"] &&
      !headers["content-type"]
    ) {
      headers["Content-Type"] = "text/plain;charset=UTF-8";
    }

    const timeoutMs = Math.max(request.timeout ?? 60_000, 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const dispatcher = new Agent({
      connect: env.DRAKE_IGNORE_HTTPS_ERRORS
        ? { rejectUnauthorized: false }
        : undefined,
      connections: 1,
      pipelining: 0,
    });

    try {
      const response = await undiciFetch(request.url, {
        method: request.method ?? "GET",
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : content,
        redirect: "follow",
        signal: controller.signal,
        dispatcher,
      });
      const text = await response.text();
      return new HttpResponse(response.status, response.statusText, text);
    } finally {
      clearTimeout(timer);
      await dispatcher.close().catch(() => undefined);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHubPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload === "string") {
    try {
      const parsed: unknown = JSON.parse(payload);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(payload) ? payload : null;
}

function sanitizeHubEndpoint(hubUrl: string): string {
  try {
    const parsed = new URL(hubUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "/api";
  }
}

async function resolveSignalRHubUrl(request: DrakeHttpClient): Promise<string> {
  const response = await request.get("/api/v2/Parameters/GetGlobalParameters", {
    failOnStatusCode: false,
    timeout: 60_000,
  });
  if (response.status() < 200 || response.status() >= 300) {
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_PROTOCOL_UNKNOWN,
      message: "Nao foi possivel obter o endpoint do canal de processamento.",
      stage: "signalr-connect",
      details: { status: response.status(), step: "GetGlobalParameters" },
    });
  }
  const json: unknown = await response.json();
  const list = Array.isArray(json) ? json : [];
  const hit = list.find(
    (item) => isRecord(item) && String(item.nome ?? "") === "SIGNALR_HUB_API",
  );
  const valor = isRecord(hit) ? String(hit.valor ?? "").trim() : "";
  if (!valor) {
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_PROTOCOL_UNKNOWN,
      message: "Parametro SIGNALR_HUB_API ausente na sessao Drake.",
      stage: "signalr-connect",
    });
  }
  return valor.replace(/\/$/, "");
}

async function resolveAccessToken(request: DrakeHttpClient): Promise<string> {
  const response = await request.get("/api/v2/User/GetSecurityUser", {
    failOnStatusCode: false,
    timeout: 60_000,
  });
  if (response.status() < 200 || response.status() >= 300) {
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_CONNECTION_FAILED,
      message: "Nao foi possivel obter o token do canal de processamento.",
      stage: "signalr-connect",
      details: { status: response.status(), step: "GetSecurityUser" },
    });
  }
  const json: unknown = await response.json();
  const token = isRecord(json) ? String(json.accessToken ?? "").trim() : "";
  if (!token) {
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_CONNECTION_FAILED,
      message: "Token do canal de processamento ausente.",
      stage: "signalr-connect",
      details: { step: "GetSecurityUser", hasAccessToken: false },
    });
  }
  return token;
}

export async function openDrakeSignalRSession(
  request: DrakeHttpClient,
): Promise<DrakeSignalRSession> {
  const started = Date.now();
  let connection: HubConnection | null = null;

  logger.info("drake-signalr", "Iniciando conexao", {
    protocol: "aspnet-core-signalr",
  });

  try {
    const hubBase = await resolveSignalRHubUrl(request);
    const hubEndpoint = sanitizeHubEndpoint(hubBase);
    const accessToken = await resolveAccessToken(request);
    const hubUrl = `${hubBase}?channels=${encodeURIComponent(DRAKE_SIGNALR_CHANNELS.join("|"))}`;

    logger.info("drake-signalr", "Negociacao concluida", {
      protocol: "aspnet-core-signalr",
      endpoint: hubEndpoint,
      durationMs: Date.now() - started,
    });

    let latestBackgroundCode: number | null = null;
    let latestReady: DrakeSignalRDownloadReady | null = null;
    let downloadWatchArmed = false;
    const readyWaiters = new Set<(value: DrakeSignalRDownloadReady) => void>();

    const publishReady = (value: DrakeSignalRDownloadReady) => {
      if (!downloadWatchArmed) return;
      latestReady = value;
      downloadWatchArmed = false;
      for (const waiter of readyWaiters) waiter(value);
      readyWaiters.clear();
    };

    connection = new HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: async () => accessToken,
        httpClient: new PlaywrightSignalRHttpClient(),
        // WebSocket costuma falhar atrás de proxy corporativo; LongPolling usa HttpClient dedicado.
        transport: HttpTransportType.LongPolling,
      })
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on("BackgroundExecutionRequestCreated", (payload: unknown) => {
      const data = parseHubPayload(payload);
      if (!data) return;
      const code = typeof data.code === "number" ? data.code : Number(data.code);
      if (Number.isFinite(code)) latestBackgroundCode = code;
      logger.info("drake-signalr", "Job de processamento anunciado", {
        backgroundCodePresent: Number.isFinite(code),
        statusPresent: typeof data.status === "string",
      });
    });

    connection.on("BackgroundExecutionRequestStatusUpdated", (payload: unknown) => {
      const data = parseHubPayload(payload);
      if (!data) return;
      const status = typeof data.status === "string" ? data.status : "";
      const zipFile = typeof data.zipFile === "string" ? data.zipFile.trim() : "";
      const zipFileName = typeof data.zipFileName === "string" ? data.zipFileName.trim() : "";
      const zipFileIsTemporary =
        typeof data.zipFileIsTemporary === "boolean" ? data.zipFileIsTemporary : null;

      logger.info("drake-signalr", "Status do processamento atualizado", {
        status,
        hasZipFile: Boolean(zipFile),
        hasZipFileName: Boolean(zipFileName),
        zipFileIsTemporary,
      });

      if (
        zipFile &&
        zipFileName &&
        (status === "ReadyForDownload" || Boolean(zipFile))
      ) {
        publishReady({
          zipFile,
          zipFileName,
          status: status || "ReadyForDownload",
          backgroundCode: latestBackgroundCode,
          zipFileIsTemporary,
        });
      }
    });

    connection.on("AsyncQueryExecuted", () => {
      logger.info("drake-signalr", "Consulta assincrona concluida", {
        connected: true,
      });
    });

    connection.on("AsyncQueryFailed", () => {
      logger.warn("drake-signalr", "Consulta assincrona falhou", {
        connected: true,
      });
    });

    await connection.start();
    const connectionId = connection.connectionId?.trim() ?? "";
    if (!connectionId || connection.state !== HubConnectionState.Connected) {
      await connection.stop().catch(() => undefined);
      throw new DrakeIntegrationError({
        code: DRAKE_SIGNALR_CONNECTION_FAILED,
        message: "Nao foi possivel obter o identificador do canal de processamento do Drake.",
        stage: "signalr-connect",
        details: {
          protocol: "aspnet-core-signalr",
          connected: connection.state === HubConnectionState.Connected,
          connectionIdPresent: Boolean(connectionId),
        },
      });
    }

    logger.info("drake-signalr", "Conexao estabelecida", {
      protocol: "aspnet-core-signalr",
      endpoint: hubEndpoint,
      transport: "long-polling",
      durationMs: Date.now() - started,
      connected: true,
    });
    logger.info("drake-signalr", "Identificador de conexao obtido", {
      protocol: "aspnet-core-signalr",
      connectionIdPresent: true,
    });

    const alive = connection;
    connection = null;

    return {
      connectionId,
      protocol: "aspnet-core-signalr",
      transport: "long-polling",
      hubPath: hubEndpoint,
      armDownloadWatch: () => {
        downloadWatchArmed = true;
        latestReady = null;
      },
      waitForDownloadReady: async ({ timeoutMs }) => {
        if (latestReady) {
          const value = latestReady;
          latestReady = null;
          return value;
        }

        return await new Promise<DrakeSignalRDownloadReady>((resolve, reject) => {
          const timer = setTimeout(() => {
            readyWaiters.delete(onReady);
            downloadWatchArmed = false;
            reject(
              new DrakeIntegrationError({
                code: DRAKE_EXPORT_ACCEPTED_WITHOUT_JOB,
                message:
                  "O Drake aceitou a solicitação, mas não gerou o arquivo solicitado.",
                stage: "waiting-signalr-download",
                details: {
                  timeoutMs,
                  backgroundCodePresent: latestBackgroundCode != null,
                },
              }),
            );
          }, timeoutMs);

          const onReady = (value: DrakeSignalRDownloadReady) => {
            clearTimeout(timer);
            resolve(value);
          };

          if (latestReady) {
            clearTimeout(timer);
            const value = latestReady;
            latestReady = null;
            resolve(value);
            return;
          }

          readyWaiters.add(onReady);
        });
      },
      close: async () => {
        logger.info("drake-signalr", "Conexao encerrada", {
          protocol: "aspnet-core-signalr",
          connected: false,
        });
        readyWaiters.clear();
        downloadWatchArmed = false;
        if (alive.state !== HubConnectionState.Disconnected) {
          await alive.stop().catch(() => undefined);
        }
      },
    };
  } catch (error) {
    if (connection) await connection.stop().catch(() => undefined);
    if (error instanceof DrakeIntegrationError) throw error;
    throw new DrakeIntegrationError({
      code: DRAKE_SIGNALR_CONNECTION_FAILED,
      message: "Falha ao conectar o canal de processamento do Drake.",
      stage: "signalr-connect",
      cause: error,
      details: {
        protocol: "aspnet-core-signalr",
        durationMs: Date.now() - started,
      },
    });
  }
}
