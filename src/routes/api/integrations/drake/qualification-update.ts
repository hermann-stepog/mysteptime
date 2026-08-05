import { createFileRoute } from "@tanstack/react-router";
import {
  DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS,
  QUALIFICATION_STAGE_MESSAGE,
  type QualificationProgressEvent,
} from "@/lib/qualification-eligibility/update-types";

export const Route = createFileRoute("/api/integrations/drake/qualification-update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { releaseDrakeUpdateLock, tryAcquireDrakeUpdateLock } =
          await import("@/lib/drake/update-lock.server");

        if (!tryAcquireDrakeUpdateLock()) {
          return Response.json(
            {
              type: "error",
              stage: "failed",
              progress: 0,
              message: "Já existe uma atualização do Drake em andamento.",
              code: DRAKE_QUALIFICATION_UPDATE_IN_PROGRESS,
              qualificationStatus: "waiting",
            } satisfies QualificationProgressEvent,
            { status: 409 },
          );
        }

        let accessToken = "";
        try {
          const authHeader = request.headers.get("authorization") ?? "";
          const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
          const body = (await request.json().catch(() => ({}))) as { accessToken?: string };
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
            const send = async (event: QualificationProgressEvent): Promise<void> => {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            };

            try {
              const { createExecutionId, logger, runWithDrakeLogContext } =
                await import("@/lib/drake/logger");
              const executionId = createExecutionId();
              const startedAtMs = Date.now();

              await runWithDrakeLogContext(
                { executionId, startedAtMs, stage: "queued", progress: 0 },
                async () => {
                  logger.info("drake-qualification", "Atualizacao de aptidao solicitada", {
                    stage: "queued",
                  });
                  const { authenticateAppRequest } = await import("@/lib/supabase/app-auth.server");
                  const { client } = await authenticateAppRequest(accessToken);
                  await send({
                    type: "progress",
                    stage: "queued",
                    progress: 0,
                    message: QUALIFICATION_STAGE_MESSAGE.queued,
                    qualificationStatus: "waiting",
                  });

                  const { runQualificationUpdate } =
                    await import("@/lib/qualification-eligibility/run-update.server");
                  const result = await runQualificationUpdate({
                    db: client,
                    onProgress: send,
                    acquireLock: false,
                  });
                  await send({
                    type: "completed",
                    stage: "completed",
                    progress: 100,
                    message: QUALIFICATION_STAGE_MESSAGE.completed,
                    qualificationStatus: "completed",
                    result,
                  });
                },
              );
            } catch (error: unknown) {
              if (error instanceof Error && /^[A-Z][A-Z0-9_]+:\s/.test(error.message)) {
                const code = error.message.split(":")[0]!;
                await send({
                  type: "error",
                  stage: "failed",
                  progress: 0,
                  message: error.message.slice(code.length + 1).trim(),
                  code,
                  qualificationStatus: "failed",
                });
              } else {
                const { toQualificationErrorEvent } =
                  await import("@/lib/qualification-eligibility/update-error.server");
                await send(toQualificationErrorEvent(error));
              }
            } finally {
              try {
                controller.close();
              } catch {
                // O cliente pode ter encerrado o stream.
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
