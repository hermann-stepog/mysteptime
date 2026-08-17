import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    }),
  )
  .handler(async ({ data, context }) => {
    await assertOperator(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr) throw new Error(createErr.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("Falha ao criar usuário.");

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .update({ role: data.role })
      .eq("user_id", userId);
    if (roleErr) throw new Error(roleErr.message);

    return { userId };
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);

    return { ok: true };
  });
