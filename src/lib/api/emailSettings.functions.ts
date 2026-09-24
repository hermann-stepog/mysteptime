import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkResendDomain, decryptSecret, encryptSecret, sendResendHtml } from "../emailSettings.server";

async function assertOperator(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_operator", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Somente a Logística de Pessoal pode alterar as configurações de e-mail.");
}

async function readRow(supabase: any) {
  const { data, error } = await supabase.from("app_email_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as any;
}

function publicView(row: any) {
  return {
    hasApiKey: !!row?.resend_api_key_encrypted,
    apiKeyLast4: row?.api_key_last4 ?? null,
    senderEmail: row?.sender_email ?? "",
    senderName: row?.sender_name ?? "",
    verifiedDomain: row?.verified_domain ?? "",
    enabled: !!row?.enabled,
    validationStatus: (row?.validation_status ?? null) as string | null,
    validationMessage: (row?.validation_message ?? null) as string | null,
    validatedAt: (row?.validated_at ?? null) as string | null,
  };
}

export const getEmailSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOperator(context.supabase, context.userId);
    return publicView(await readRow(context.supabase));
  });

const domainRe = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

// Salva e valida. Qualquer mudança desativa os avisos até uma nova validação passar.
export const saveEmailSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    apiKey: z.string().trim().max(200).optional(),
    senderEmail: z.string().trim().email().max(255),
    senderName: z.string().trim().max(100).optional(),
    verifiedDomain: z.string().trim().toLowerCase().max(253).regex(domainRe, "Domínio inválido"),
  }))
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);
    const row = await readRow(context.supabase);
    const senderDomain = data.senderEmail.split("@")[1].toLowerCase();
    if (senderDomain !== data.verifiedDomain && !senderDomain.endsWith(`.${data.verifiedDomain}`)) {
      throw new Error(`O remetente precisa ser do domínio ${data.verifiedDomain}.`);
    }
    let apiKey: string | null = null;
    if (data.apiKey) {
      if (!data.apiKey.startsWith("re_")) throw new Error("A chave do Resend começa com \"re_\".");
      apiKey = data.apiKey;
    } else if (row?.resend_api_key_encrypted) {
      apiKey = await decryptSecret(row.resend_api_key_encrypted);
    }
    if (!apiKey) throw new Error("Informe a chave da API do Resend.");

    const check = await checkResendDomain(apiKey, data.verifiedDomain);
    const payload = {
      id: 1,
      resend_api_key_encrypted: await encryptSecret(apiKey),
      api_key_last4: apiKey.slice(-4),
      sender_email: data.senderEmail,
      sender_name: data.senderName || null,
      verified_domain: data.verifiedDomain,
      enabled: false,
      validation_status: check.status,
      validation_message: check.message,
      validated_at: check.status === "verified" ? new Date().toISOString() : null,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await context.supabase.from("app_email_settings").upsert(payload);
    if (error) throw new Error(error.message);
    return publicView(payload);
  });

// Envia um e-mail de teste com a config salva; se der certo, conta como validação.
export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ to: z.string().trim().email().max(255) }))
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);
    const row = await readRow(context.supabase);
    if (!row?.resend_api_key_encrypted || !row.sender_email) throw new Error("Salve as configurações antes de testar.");
    const apiKey = await decryptSecret(row.resend_api_key_encrypted);
    const from = row.sender_name ? `${row.sender_name} <${row.sender_email}>` : row.sender_email;
    await sendResendHtml(
      { apiKey, from },
      data.to,
      "Teste de envio — My Step Time",
      "<p>Olá!</p><p>Este é um e-mail de teste do <strong>My Step Time</strong>. Se você recebeu, os avisos por e-mail estão prontos para uso.</p>",
      "Olá! Este é um e-mail de teste do My Step Time. Se você recebeu, os avisos por e-mail estão prontos para uso.",
    );
    const patch = {
      validation_status: "verified",
      validation_message: `E-mail de teste aceito pelo Resend para ${data.to}.`,
      validated_at: new Date().toISOString(),
    };
    await context.supabase.from("app_email_settings").update(patch).eq("id", 1);
    return publicView({ ...row, ...patch });
  });

export const setEmailAlertsEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);
    const row = await readRow(context.supabase);
    if (data.enabled && row?.validation_status !== "verified") {
      throw new Error("Valide as configurações (domínio verificado ou e-mail de teste) antes de ativar.");
    }
    const { error } = await context.supabase.from("app_email_settings").update({ enabled: data.enabled }).eq("id", 1);
    if (error) throw new Error(error.message);
    return publicView({ ...row, enabled: data.enabled });
  });
