/**
 * Autenticação do APLICATIVO nas server functions (server-only).
 *
 * Valida a sessão do usuário no Supabase ANTES de qualquer interação com o
 * Drake, classificando corretamente falhas de sessão, TLS e indisponibilidade.
 * Nunca converter erros deste módulo em códigos DRAKE_*.
 */
import "@tanstack/react-start/server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import process from "node:process";
import {
  AppAuthError,
  APP_AUTH_VALIDATION_FAILED,
  APP_SESSION_INVALID,
  classifySupabaseInfraError,
  SUPABASE_TLS_ERROR,
  SUPABASE_UNAVAILABLE,
  encodeAppAuthError,
} from "./app-auth-errors";
import { supabaseServerFetch } from "./supabase-server-fetch";

const LOCAL_DEV_USER_ID = "local-development";

function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase não configurado no servidor.");
  return { url, key };
}

function boolEnv(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

/**
 * Bypass exclusivo de desenvolvimento para testar a integração Drake
 * quando o Supabase corporativo está inacessível.
 *
 * Só ativo se TODAS as condições forem verdadeiras:
 * - NODE_ENV !== "production"
 * - DRAKE_DEV_BYPASS_APP_AUTH === true
 * - não forçado a produção por outras flags
 *
 * Em produção o bypass é sempre ignorado.
 */
export function isDrakeDevBypassAppAuthActive(): boolean {
  const requested = boolEnv("DRAKE_DEV_BYPASS_APP_AUTH");
  if (!requested) return false;

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[app-authentication] DRAKE_DEV_BYPASS_APP_AUTH=true ignorado em producao — autenticacao normal exigida.",
    );
    return false;
  }

  return true;
}

export function getDrakeDevTriggeredBy(): string {
  const value = (process.env.DRAKE_DEV_TRIGGERED_BY ?? "").trim();
  return value || LOCAL_DEV_USER_ID;
}

/** Cliente Supabase server-side com o fetch TLS customizado injetado. */
export function createUserClient(accessToken: string): SupabaseClient {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
      fetch: supabaseServerFetch,
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

/**
 * Mesmo mecanismo da tela de login (`useAuth.signIn` → `auth.signInWithPassword`).
 * Cliente efêmero server-side (sem localStorage / persistSession).
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{
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
}> {
  const { url, key } = getSupabaseEnv();
  const client = createClient(url, key, {
    global: { fetch: supabaseServerFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: undefined,
    },
  });
  return client.auth.signInWithPassword({ email, password });
}

/**
 * Cliente com service role — somente no bypass local, para gravar o job
 * sem depender de getUser/RLS quando o Supabase auth está inacessível.
 * triggered_by fica null (coluna UUID); a auditoria vai para o log.
 */
function createServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    global: { fetch: supabaseServerFetch },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

type GetUserFn = (token: string) => Promise<{
  data: { user: { id: string } | null };
  error: { message?: string; code?: string; status?: number; name?: string } | null;
}>;

/**
 * Resolve o ID do usuário autenticado no aplicativo.
 *
 * Casos tratados (etapa: app-authentication):
 * - bypass local de desenvolvimento → "local-development";
 * - usuário válido → retorna o ID;
 * - sessão ausente/JWT inválido → APP_SESSION_INVALID;
 * - erro de certificado (ex.: SELF_SIGNED_CERT_IN_CHAIN) → SUPABASE_TLS_ERROR;
 * - rede/indisponibilidade (fetch failed, ECONNREFUSED...) → SUPABASE_UNAVAILABLE;
 * - qualquer outro erro → APP_AUTH_VALIDATION_FAILED.
 */
export async function resolveUserId(
  client: Pick<SupabaseClient, "auth"> | { auth: { getUser: GetUserFn } },
  accessToken: string,
): Promise<string> {
  if (isDrakeDevBypassAppAuthActive()) {
    console.info("[app-authentication] Bypass local de autenticacao ativo");
    console.info("[app-authentication] Modo local de teste da integracao Drake ativo");
    return LOCAL_DEV_USER_ID;
  }

  console.info("[app-authentication] Validando autenticacao do aplicativo");

  let data: { user: { id: string } | null };
  let error: unknown;
  try {
    const result = await (client.auth.getUser as GetUserFn)(accessToken);
    data = result.data;
    error = result.error;
  } catch (err) {
    throw classifyAndWrap(err);
  }

  if (error) {
    // auth-js frequentemente devolve falhas de fetch/TLS como `error` em vez de lançar.
    const infra = classifySupabaseInfraError(error);
    if (infra) throw classifyAndWrap(error);
    console.info("[app-authentication] Sessao do aplicativo ausente ou invalida");
    throw new AppAuthError(APP_SESSION_INVALID);
  }

  if (!data.user) {
    console.info("[app-authentication] Sessao do aplicativo ausente ou invalida");
    throw new AppAuthError(APP_SESSION_INVALID);
  }

  console.info("[app-authentication] Sessao do aplicativo validada");
  return data.user.id;
}

function classifyAndWrap(err: unknown): AppAuthError {
  const infra = classifySupabaseInfraError(err);
  if (infra === SUPABASE_TLS_ERROR) {
    console.error("[app-authentication] Falha TLS ao consultar Supabase");
    return new AppAuthError(SUPABASE_TLS_ERROR);
  }
  if (infra === SUPABASE_UNAVAILABLE) {
    console.error("[app-authentication] Servico Supabase indisponivel");
    return new AppAuthError(SUPABASE_UNAVAILABLE);
  }
  console.error("[app-authentication] Falha desconhecida na validacao da autenticacao do app");
  return new AppAuthError(APP_AUTH_VALIDATION_FAILED);
}

async function assertOperator(client: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    const infra = classifySupabaseInfraError(error);
    if (infra) throw new AppAuthError(infra);
    throw new Error("Não foi possível validar a permissão do usuário.");
  }
  if (data?.role !== "logistics_operator") {
    throw new Error("Sem permissão para atualizar dados do Drake.");
  }
}

export interface AuthenticatedRequest {
  client: SupabaseClient;
  userId: string;
  /** Quando true, triggered_by no banco deve ser null (não é UUID de auth.users). */
  developmentBypass: boolean;
  /** Rótulo de auditoria local (só log) quando bypass ativo. */
  triggeredByLabel: string | null;
}

/**
 * Passos 1 e 2 do fluxo (validar usuário e permissão).
 * Com bypass local: não chama getUser; usa service role se disponível.
 */
export async function authenticateAppRequest(accessToken: string): Promise<AuthenticatedRequest> {
  const bypass = isDrakeDevBypassAppAuthActive();

  if (bypass) {
    console.info("[app-authentication] Bypass local de autenticacao ativo");
    console.info("[app-authentication] Modo local de teste da integracao Drake ativo");
    const service = createServiceClient();
    const client = service ?? createUserClient(accessToken);
    if (!service) {
      console.info(
        "[app-authentication] Bypass ativo sem SUPABASE_SERVICE_ROLE_KEY — usando token do usuario para o cliente Supabase dos importadores.",
      );
    }
    return {
      client,
      userId: LOCAL_DEV_USER_ID,
      developmentBypass: true,
      triggeredByLabel: getDrakeDevTriggeredBy(),
    };
  }

  const client = createUserClient(accessToken);
  try {
    const userId = await resolveUserId(client, accessToken);
    await assertOperator(client, userId);
    return {
      client,
      userId,
      developmentBypass: false,
      triggeredByLabel: null,
    };
  } catch (err) {
    if (err instanceof AppAuthError) {
      throw new Error(encodeAppAuthError(err));
    }
    throw err;
  }
}
