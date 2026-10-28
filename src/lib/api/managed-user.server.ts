import "@tanstack/react-start/server-only";

/** Only call after verifying the caller's operator role with their own client. */
export async function createManagedUser(data: {
  email: string;
  password: string;
  fullName: string;
  role: string;
  perfil?: string;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { full_name: data.fullName },
  });
  if (error) throw new Error(error.message);
  const userId = created.user?.id;
  if (!userId) throw new Error("Falha ao criar usuário.");

  try {
    const { error: roleError } = await supabaseAdmin.from("user_roles")
      .update({ role: data.role }).eq("user_id", userId);
    if (roleError) throw new Error(roleError.message);
    const { error: profileError } = await supabaseAdmin.from("profiles")
      .update({ must_change_password: true, perfil: data.perfil || null }).eq("id", userId);
    if (profileError) throw new Error(profileError.message);
  } catch (error) {
    // Do not leave a partially provisioned account that blocks the next attempt.
    const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (cleanupError) {
      throw new Error("Cadastro incompleto; não repita a criação antes de verificar a conta em Configurações.");
    }
    throw error;
  }
  return userId;
}