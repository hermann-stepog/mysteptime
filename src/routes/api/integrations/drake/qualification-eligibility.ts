import { createFileRoute } from "@tanstack/react-router";
import type { DrakeHttpClient } from "@/lib/drake/http/drake-http-client.types.server";
import type { QualificationEligibilitySelection } from "@/lib/qualification-eligibility/domain";

interface EligibilityRequestBody extends QualificationEligibilitySelection {
  accessToken?: string;
}

export const Route = createFileRoute("/api/integrations/drake/qualification-eligibility")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let drakeClient: DrakeHttpClient | null = null;

        try {
          const body = (await request.json()) as EligibilityRequestBody;
          const bearer =
            request.headers
              .get("authorization")
              ?.match(/^Bearer\s+(.+)$/i)?.[1]
              ?.trim() ?? "";
          const accessToken = (body.accessToken ?? bearer).trim();
          if (!accessToken) {
            return Response.json(
              { message: "Sua sessão no aplicativo expirou. Entre novamente." },
              { status: 401 },
            );
          }

          const { client: db } = await import("@/lib/supabase/app-auth.server").then((module) =>
            module.authenticateAppRequest(accessToken),
          );
          const { EnvironmentCredentialsDrakeAuthProvider } =
            await import("@/lib/drake/auth/environment-credentials-auth.server");
          const { createDrakeApiContextFromAuthenticatedSession } =
            await import("@/lib/drake/api-session.server");
          const { evaluateLiveQualificationEligibility } =
            await import("@/lib/qualification-eligibility/evaluate-live.server");

          const authentication = await new EnvironmentCredentialsDrakeAuthProvider().authenticate();
          drakeClient = await createDrakeApiContextFromAuthenticatedSession(
            authentication.authenticatedSession,
          );
          const evaluation = await evaluateLiveQualificationEligibility(drakeClient, db, {
            operationalUnitId: body.operationalUnitId,
            jobId: body.jobId,
            operationType: body.operationType,
            startDate: body.startDate,
            endDate: body.endDate,
          });

          return Response.json(evaluation, {
            headers: { "Cache-Control": "private, no-store" },
          });
        } catch (error: unknown) {
          const message = safeErrorMessage(error);
          const status = /sessão|autentica|credenciais/i.test(message) ? 401 : 500;
          return Response.json({ message }, { status });
        } finally {
          await drakeClient?.dispose().catch(() => undefined);
        }
      },
    },
  },
});

function safeErrorMessage(error: unknown): string {
  const fallback = "Não foi possível consultar a aptidão no Drake.";
  if (!(error instanceof Error)) return fallback;
  if (/ENOENT|no such file|[A-Za-z]:\\|\/tmp\/|node_modules/i.test(error.message)) return fallback;
  return error.message || fallback;
}
