/**
 * Login da conta de automação do MyStepTime para o scheduler Drake.
 *
 * Reutiliza o mesmo mecanismo da tela de login:
 * `useAuth.signIn` → `signInWithPassword` (app-auth.server).
 *
 * Credenciais: MYSTEPTIME_AUTOMATION_EMAIL / MYSTEPTIME_AUTOMATION_PASSWORD
 * (conta normal do sistema — mesmo e-mail/senha da tela de autenticação).
 */
import "@tanstack/react-start/server-only";
import { DrakeIntegrationError } from "./integration-error.server";
import { logger } from "./logger";
import {
  DRAKE_ERROR_MESSAGES,
  MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
  MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED,
  MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
} from "./update-types";

export type MyStepTimeAutomationSession = {
  accessToken: string;
  userId: string;
};

type SignInFn = (
  email: string,
  password: string,
) => Promise<{
  data: {
    session: { access_token: string; user?: { id?: string } | null } | null;
    user: { id?: string } | null;
  };
  error: {
    message?: string;
    code?: string;
    status?: number;
    name?: string;
  } | null;
}>;

function readAutomationCredentials(): { email: string; password: string } {
  const email = (process.env.MYSTEPTIME_AUTOMATION_EMAIL ?? "").trim();
  const password = (process.env.MYSTEPTIME_AUTOMATION_PASSWORD ?? "").trim();
  if (!email || !password) {
    throw new DrakeIntegrationError({
      code: MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING,
      message: DRAKE_ERROR_MESSAGES[MYSTEPTIME_AUTOMATION_CREDENTIALS_MISSING]!,
      stage: "queued",
    });
  }
  return { email, password };
}

function isInteractiveAuthRequired(error: {
  message?: string;
  code?: string;
  status?: number;
} | null): boolean {
  if (!error) return false;
  const blob = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    /\bmfa\b/.test(blob) ||
    /\baal\b/.test(blob) ||
    /\bfactor\b/.test(blob) ||
    /\botp\b/.test(blob) ||
    /challenge/.test(blob) ||
    /multi.?factor/.test(blob) ||
    /verification.?code/.test(blob) ||
    /additional.?step/.test(blob)
  );
}

/**
 * Autentica no MyStepTime com a conta de automação (mesmo login da tela).
 * Retorna apenas accessToken + userId.
 */
export async function authenticateMyStepTimeAutomationUser(
  options?: { signIn?: SignInFn },
): Promise<MyStepTimeAutomationSession> {
  const { email, password } = readAutomationCredentials();

  logger.info("mysteptime-automation-auth", "Autenticando conta de automação do MyStepTime");
  const startedAt = Date.now();

  const signIn: SignInFn =
    options?.signIn ??
    (async (e, p) => {
      const { signInWithPassword } = await import("@/lib/supabase/app-auth.server");
      return signInWithPassword(e, p);
    });

  let result: Awaited<ReturnType<SignInFn>>;
  try {
    result = await signIn(email, password);
  } catch (error: unknown) {
    const durationMs = Date.now() - startedAt;
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;
    logger.error("mysteptime-automation-auth", "Falha na autenticação", {
      errorCode: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
      status: Number.isFinite(status) ? status : null,
      errorName: error instanceof Error ? error.name : "Error",
      durationMs,
    });
    throw new DrakeIntegrationError({
      code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
      message: DRAKE_ERROR_MESSAGES[MYSTEPTIME_AUTOMATION_LOGIN_FAILED]!,
      stage: "queued",
      cause: error,
    });
  }

  const durationMs = Date.now() - startedAt;

  if (result.error) {
    if (isInteractiveAuthRequired(result.error)) {
      logger.error("mysteptime-automation-auth", "Falha na autenticação", {
        errorCode: MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED,
        status: result.error.status ?? null,
        errorName: result.error.name ?? "AuthError",
        durationMs,
      });
      throw new DrakeIntegrationError({
        code: MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED,
        message: DRAKE_ERROR_MESSAGES[MYSTEPTIME_AUTOMATION_INTERACTIVE_AUTH_REQUIRED]!,
        stage: "queued",
      });
    }

    logger.error("mysteptime-automation-auth", "Falha na autenticação", {
      errorCode: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
      status: result.error.status ?? null,
      errorName: result.error.name ?? "AuthError",
      durationMs,
    });
    throw new DrakeIntegrationError({
      code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
      message: DRAKE_ERROR_MESSAGES[MYSTEPTIME_AUTOMATION_LOGIN_FAILED]!,
      stage: "queued",
    });
  }

  const accessToken = (result.data.session?.access_token ?? "").trim();
  const userId = (
    result.data.session?.user?.id ??
    result.data.user?.id ??
    ""
  ).trim();

  if (!accessToken || !userId) {
    logger.error("mysteptime-automation-auth", "Falha na autenticação", {
      errorCode: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
      status: null,
      errorName: "MissingSession",
      durationMs,
    });
    throw new DrakeIntegrationError({
      code: MYSTEPTIME_AUTOMATION_LOGIN_FAILED,
      message: DRAKE_ERROR_MESSAGES[MYSTEPTIME_AUTOMATION_LOGIN_FAILED]!,
      stage: "queued",
    });
  }

  logger.info("mysteptime-automation-auth", "Conta de automação autenticada no MyStepTime", {
    userIdPresent: true,
    accessTokenPresent: true,
    durationMs,
  });

  return { accessToken, userId };
}

export function discardMyStepTimeAutomationAuthContext(): void {
  logger.info("mysteptime-automation-auth", "Contexto de autenticação descartado");
}
