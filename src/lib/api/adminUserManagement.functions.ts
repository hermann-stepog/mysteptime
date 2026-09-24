import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendEmail } from "@/lib/email.server";

const appRole = z.enum([
  "pending",
  "collaborator",
  "logistics_operator",
  "visitante",
  "pm",
  "aprovacao_tecnica",
  "qualidade",
  "rh",
  "sms",
]);

async function assertOperator(supabase: any, userId: string) {
  const { data: roleRow, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (roleRow?.role !== "logistics_operator") {
    throw new Error("Sem permissão para gerenciar usuários.");
  }
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      email: z.string().trim().email().max(255),
      password: z.string().min(8).max(72),
      fullName: z.string().trim().min(1).max(120),
      role: appRole,
      // Cargo/perfil da pessoa (ex.: "Diretor") — texto livre, opcional, aparece no cabeçalho
      // junto do nome ("Nome - Perfil"). Diferente do "role" acima (controla permissão).
      perfil: z.string().trim().max(120).optional(),
      // Origem de onde o formulário foi enviado (window.location.origin, no cliente) — só pra
      // montar o link de acesso no e-mail de boas-vindas, sem hardcodar domínio no servidor.
      loginUrl: z.string().url().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);

    // A criação de usuário exige a service_role key, que o Lovable Cloud nunca expõe pro app
    // (nem no .env, nem no painel) — só as Edge Functions recebem essa chave automaticamente.
    // Por isso a ação em si roda lá (ver supabase/functions/admin-user-management), e aqui só
    // encaminha a chamada com o token de quem está logado (o cliente já vem com ele no header,
    // graças ao requireSupabaseAuth).
    const { data: result, error } = await context.supabase.functions.invoke("admin-user-management", {
      body: { action: "createUser", email: data.email, password: data.password, fullName: data.fullName, role: data.role, perfil: data.perfil || null },
    });
    if (error) throw new Error("Falha ao comunicar com o servidor de autenticação.");
    if (!result?.ok) throw new Error(result?.error ?? "Falha ao criar usuário.");

    // Aviso por e-mail é best-effort — o usuário já foi criado com sucesso, então uma falha de
    // SMTP aqui (mesma tolerância de notifyStageAdvance/notifyPassagemStageAdvance) não pode
    // desfazer nem travar o cadastro, só avisa a operadora que o e-mail não saiu.
    let emailSent = false;
    try {
      const loginUrl = `${data.loginUrl ?? ""}/auth`;
      await sendEmail({
        to: data.email,
        subject: "Bem-vindo(a) ao My Step Time",
        text: [
          `Olá, ${data.fullName}!`,
          "",
          "Uma conta foi criada para você no My Step Time.",
          "",
          `Acesse: ${loginUrl}`,
          `E-mail de login: ${data.email}`,
          "",
          "Use a senha provisória informada pela Logística de Pessoal — no primeiro acesso você será solicitado(a) a definir uma nova senha.",
        ].join("\n"),
      });
      emailSent = true;
    } catch (err) {
      console.warn("Falha ao enviar e-mail de boas-vindas ao novo usuário (aviso, não bloqueia o cadastro):", err);
    }

    return { userId: result.userId as string, emailSent };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);

    const { data: result, error } = await context.supabase.functions.invoke("admin-user-management", {
      body: { action: "deleteUser", userId: data.userId },
    });
    if (error) throw new Error("Falha ao comunicar com o servidor de autenticação.");
    if (!result?.ok) throw new Error(result?.error ?? "Falha ao excluir usuário.");

    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      userId: z.string().uuid(),
      newPassword: z.string().min(8).max(72),
    }),
  )
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);

    // Mesmo motivo do adminCreateUser acima: redefinir senha de outro usuário exige
    // service_role, que só a Edge Function recebe automaticamente no Lovable Cloud.
    const { data: result, error } = await context.supabase.functions.invoke("admin-user-management", {
      body: { action: "resetPassword", userId: data.userId, newPassword: data.newPassword },
    });
    if (error) throw new Error("Falha ao comunicar com o servidor de autenticação.");
    if (!result?.ok) throw new Error(result?.error ?? "Falha ao redefinir senha.");

    return { ok: true };
  });
