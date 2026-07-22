/**
 * Fetch server-only para o cliente Supabase usado nas server functions.
 *
 * Resolve falhas de TLS em ambientes corporativos (ex.: SELF_SIGNED_CERT_IN_CHAIN)
 * sem desabilitar a validação HTTPS do processo Node inteiro:
 *
 * - SUPABASE_CA_CERT_PATH: carrega a CA corporativa e mantém rejectUnauthorized=true
 *   (opção preferencial para produção).
 * - SUPABASE_IGNORE_HTTPS_ERRORS=true: fallback controlado que desabilita a
 *   verificação SOMENTE no dispatcher deste módulo (não afeta Drake nem outras
 *   integrações).
 * - Nenhum dos dois: validação TLS estrita padrão.
 *
 * NUNCA importar este módulo em código de frontend — ele depende de node:fs e undici.
 */
import "@tanstack/react-start/server-only";
import { readFileSync } from "node:fs";
import process from "node:process";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

interface SupabaseTlsConfig {
  caCertPath: string;
  ignoreHttpsErrors: boolean;
}

function readTlsConfig(): SupabaseTlsConfig {
  return {
    caCertPath: (process.env.SUPABASE_CA_CERT_PATH ?? "").trim(),
    ignoreHttpsErrors:
      (process.env.SUPABASE_IGNORE_HTTPS_ERRORS ?? "").trim().toLowerCase() === "true",
  };
}

export function createSupabaseDispatcher(config: SupabaseTlsConfig): Dispatcher | null {
  if (config.caCertPath) {
    const ca = readFileSync(config.caCertPath, "utf8");
    console.info(
      "[supabase-server-fetch] CA corporativa carregada para conexões Supabase (rejectUnauthorized=true).",
    );
    return new Agent({ connect: { ca, rejectUnauthorized: true } });
  }
  if (config.ignoreHttpsErrors) {
    console.warn(
      "[supabase-server-fetch] SUPABASE_IGNORE_HTTPS_ERRORS=true — verificação de certificado desabilitada SOMENTE nas chamadas server-side ao Supabase. Use apenas em ambiente corporativo autorizado.",
    );
    return new Agent({ connect: { rejectUnauthorized: false } });
  }
  return null;
}

let cachedDispatcher: Dispatcher | null | undefined;
let cachedKey: string | undefined;

function getDispatcher(): Dispatcher | null {
  const config = readTlsConfig();
  const key = `${config.caCertPath}|${config.ignoreHttpsErrors}`;
  if (cachedDispatcher === undefined || cachedKey !== key) {
    cachedDispatcher = createSupabaseDispatcher(config);
    cachedKey = key;
  }
  return cachedDispatcher;
}

/**
 * Fetch compatível com `typeof globalThis.fetch`, injetável em
 * `createClient(..., { global: { fetch: supabaseServerFetch } })`.
 * Preserva method, headers, body, signal, redirect e demais opções;
 * apenas acrescenta o dispatcher com a configuração TLS quando necessário.
 */
export const supabaseServerFetch: typeof globalThis.fetch = async (input, init) => {
  const dispatcher = getDispatcher();
  if (!dispatcher) {
    return globalThis.fetch(input, init);
  }
  const response = await undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    } as Parameters<typeof undiciFetch>[1],
  );
  return response as unknown as Response;
};
