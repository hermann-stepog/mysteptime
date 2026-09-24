import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Ações administrativas de usuário (criar usuário / redefinir senha) exigem a service_role
// key do Supabase. Via Lovable Cloud o projeto nunca expõe essa chave pro app (não existe
// service_role no .env local nem no painel da Lovable) — só as Edge Functions recebem essa
// chave automaticamente em tempo de execução (SUPABASE_SERVICE_ROLE_KEY injetada pelo
// runtime). Por isso a ação em si mora aqui, e o backend do app (adminUserManagement.
// functions.ts) só encaminha a chamada, repassando o token de quem está logado.
// verify_jwt fica no padrão (true) — o próprio gateway do Supabase já recusa quem não mandar
// um JWT válido antes mesmo da função rodar; aqui dentro só falta checar o *cargo* de quem
// chamou (é operador logístico?).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function ok(body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: true, ...body }), { headers: jsonHeaders });
}
function fail(error: string) {
  return new Response(JSON.stringify({ ok: false, error }), { headers: jsonHeaders });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return fail("SUPABASE_URL/SERVICE_ROLE_KEY não configurados na função.");

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("Não autenticado.");

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return fail("Token inválido.");

    const { data: roleRow, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (roleErr) return fail(roleErr.message);
    if (roleRow?.role !== "logistics_operator") return fail("Sem permissão para gerenciar usuários.");

    const body = await req.json();

    if (body.action === "resetPassword") {
      const { userId, newPassword } = body;
      if (typeof userId !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
        return fail("Dados inválidos.");
      }
      const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
      if (error) return fail(error.message);
      // A senha que o operador digitou aqui é só provisória — a pessoa é obrigada a trocar
      // por uma só dela no próximo login (ver RequirePasswordChange no app).
      await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
      return ok();
    }

    if (body.action === "createUser") {
      const { email, password, fullName, role, perfil } = body;
      if (
        typeof email !== "string" || typeof password !== "string" ||
        typeof fullName !== "string" || typeof role !== "string" ||
        (perfil !== undefined && perfil !== null && typeof perfil !== "string")
      ) {
        return fail("Dados inválidos.");
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (createErr) return fail(createErr.message);
      const newUserId = created.user?.id;
      if (!newUserId) return fail("Falha ao criar usuário.");

      const { error: roleUpdateErr } = await admin.from("user_roles").update({ role }).eq("user_id", newUserId);
      if (roleUpdateErr) return fail(roleUpdateErr.message);

      // Mesmo motivo do resetPassword acima: a senha definida aqui é provisória, tem que ser
      // trocada no primeiro acesso. Cargo/perfil (ex.: "Diretor") é opcional, aparece no
      // cabeçalho junto do nome.
      await admin.from("profiles").update({ must_change_password: true, perfil: perfil || null }).eq("id", newUserId);

      return ok({ userId: newUserId });
    }

    if (body.action === "deleteUser") {
      const { userId } = body;
      if (typeof userId !== "string") return fail("Dados inválidos.");
      if (userId === userData.user.id) return fail("Você não pode excluir seu próprio usuário.");

      // profiles.id -> auth.users(id) é ON DELETE CASCADE, e várias tabelas operacionais
      // antigas (embarkations/transport_requests/hotel_bookings/documents/rdo_entries/
      // timesheets/payroll_summaries/approval_requests) referenciam profiles(id) como
      // collaborator_id, também em cascata — excluir o usuário sem checar apagaria esse
      // histórico junto, sem avisar. Preferimos recusar a exclusão a perder dado calado.
      const tabelasComCascata: { tabela: string; label: string }[] = [
        { tabela: "embarkations", label: "Embarques" },
        { tabela: "transport_requests", label: "Solicitações de transporte" },
        { tabela: "hotel_bookings", label: "Hospedagens" },
        { tabela: "documents", label: "Documentos" },
        { tabela: "rdo_entries", label: "RDOs" },
        { tabela: "timesheets", label: "Timesheets" },
        { tabela: "payroll_summaries", label: "Folhas de pagamento" },
        { tabela: "approval_requests", label: "Aprovações" },
      ];
      const checagens = await Promise.all(
        tabelasComCascata.map(({ tabela }) => admin.from(tabela).select("id", { count: "exact", head: true }).eq("collaborator_id", userId)),
      );
      const bloqueios = checagens
        .map((r, i) => (r.count && r.count > 0 ? tabelasComCascata[i].label : null))
        .filter((l): l is string => !!l);
      if (bloqueios.length > 0) {
        return fail(`Não é possível excluir: esse usuário tem registros vinculados em ${bloqueios.join(", ")}.`);
      }

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return fail(error.message);
      return ok();
    }

    return fail("Ação desconhecida.");
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
