import { createFileRoute } from "@tanstack/react-router";
import {
  DRAKE_STAGE_MESSAGE,
  DRAKE_UPDATE_IN_PROGRESS,
  type DrakeProgressEvent,
} from "@/lib/drake/update-types";

export const Route = createFileRoute("/api/integrations/drake/update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tryAcquireDrakeUpdateLock, releaseDrakeUpdateLock } =
          await import("@/lib/drake/update-lock.server");

        if (!tryAcquireDrakeUpdateLock()) {
          return Response.json(
            {
              type: "error",
              stage: "failed",
              progress: 0,
              message: "Já existe uma atualização em andamento.",
              code: DRAKE_UPDATE_IN_PROGRESS,
              embarkationStatus: "waiting",
              availabilityStatus: "waiting",
            } satisfies DrakeProgressEvent,
            { status: 409 },
          );
        }

        let accessToken = "";
        try {
          const authHeader = request.headers.get("authorization") ?? "";
          const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
          const body = (await request.json().catch(() => ({}))) as {
            accessToken?: string;
          };
          accessToken = (body.accessToken ?? bearer).trim();
        } catch {
          releaseDrakeUpdateLock();
          return Response.json({ message: "Requisição inválida." }, { status: 400 });
        }

        if (!accessToken) {
          releaseDrakeUpdateLock();
          return Response.json(
            { message: "Sua sessão no aplicativo expirou. Entre novamente." },
            { status: 401 },
          );
        }

        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = async (event: DrakeProgressEvent) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            };

            try {
              const { createExecutionId, logger, runWithDrakeLogContext } =
                await import("@/lib/drake/logger");
              const executionId = createExecutionId();
              const startedAtMs = Date.now();

              await runWithDrakeLogContext(
                { executionId, startedAtMs, stage: "queued" },
                async () => {
                  logger.info("drake-update", "Atualizacao Drake solicitada", {
                    stage: "queued",
                  });

                  const { authenticateAppRequest } = await import("@/lib/supabase/app-auth.server");
                  const { client } = await authenticateAppRequest(accessToken);

                  await send({
                    type: "progress",
                    stage: "queued",
                    progress: 0,
                    message: DRAKE_STAGE_MESSAGE.queued,
                    embarkationStatus: "waiting",
                    availabilityStatus: "waiting",
                  });

                  const { runDrakeUpdate } = await import("@/lib/drake/run-drake-update.server");
                  const result = await runDrakeUpdate({
                    trigger: "manual",
                    db: client,
                    onProgress: send,
                    acquireLock: false,
                  });

                  await send({
                    type: "completed",
                    stage: "completed",
                    progress: 100,
                    message: "Dados atualizados com sucesso.",
                    embarkationStatus: "completed",
                    availabilityStatus: "completed",
                    result,
                  });
                },
              );
            } catch (error: unknown) {
              const { mapDrakeError, toErrorProgressEvent } =
                await import("@/lib/drake/map-drake-error.server");
              const { DrakeIntegrationError: DrakeErr } =
                await import("@/lib/drake/integration-error.server");
              // App auth errors chegam como "CODE: message"
              if (error instanceof Error && /^[A-Z][A-Z0-9_]+:\s/.test(error.message)) {
                const code = error.message.split(":")[0]!;
                const message = error.message.slice(code.length + 1).trim();
                await send({
                  type: "error",
                  stage: "failed",
                  progress: 0,
                  message,
                  code,
                  embarkationStatus: "failed",
                  availabilityStatus: "not-started",
                });
              } else {
                const withStatus = error as InstanceType<typeof DrakeErr> & {
                  embarkationStatus?: DrakeProgressEvent["embarkationStatus"];
                  availabilityStatus?: DrakeProgressEvent["availabilityStatus"];
                };
                const embarkationStatus = withStatus.embarkationStatus ?? "waiting";
                const availabilityStatus = withStatus.availabilityStatus ?? "not-started";
                const progress =
                  error instanceof DrakeErr && typeof withStatus.progress === "number"
                    ? withStatus.progress
                    : 0;
                await send(
                  toErrorProgressEvent(
                    mapDrakeError(error, embarkationStatus, availabilityStatus, progress),
                  ),
                );
              }
            } finally {
              try {
                controller.close();
              } catch {
                /* already closed */
              }
              releaseDrakeUpdateLock();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
