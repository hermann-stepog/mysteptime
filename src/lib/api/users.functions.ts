import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const appRole = z.enum(["pending", "collaborator", "logistics_operator", "pm", "visitante"]);

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      email: z.string().trim().email().max(255),
      password: z.string().min(8).max(72),
      full_name: z.string().trim().min(1).max(120),
      role: appRole,
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: isOperator, error: roleError } = await context.supabase.rpc("is_operator", {
      _user_id: context.userId,
    });
    if (roleError) throw new Error(roleError.message);
    if (!isOperator) throw new Error("Apenas operadores logísticos podem criar usuários.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (error) throw new Error(error.message);
    const userId = created.user?.id;
    if (!userId) throw new Error("Não foi possível criar o usuário.");

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, email: data.email, full_name: data.full_name }, { onConflict: "id" });

    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: urErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role });
    if (urErr) throw new Error(urErr.message);

    return { id: userId };
  });
