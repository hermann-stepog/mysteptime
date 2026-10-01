import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { trackFlowEvent, resetFlowSession } from "@/lib/flowTrack";

export type AppRole =
  | "pending" | "collaborator" | "logistics_operator" | "pm" | "visitante"
  | "aprovacao_tecnica" | "qualidade" | "rh" | "sms" | "adm_master" | "solicitante_master"
  | "diretoria" | "medicao" | "administrador";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  profile: { id: string; full_name: string | null; email: string; must_change_password: boolean; perfil: string | null } | null;
  loading: boolean;
  roleLoaded: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [profile, setProfile] = useState<AuthCtx["profile"]>(null);
  const [loading, setLoading] = useState(true);

  const [roleLoaded, setRoleLoaded] = useState(false);

  const loadRole = async (uid: string) => {
    const [{ data: roleRow }, { data: profileRow }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
      // must_change_password/perfil ainda não estão nos tipos gerados (colunas novas); cast
      // local nesta consulta, mesmo padrão já usado em planejamento_embarque e outras colunas
      // recentes.
      (supabase as any).from("profiles").select("id, full_name, email, must_change_password, perfil").eq("id", uid).maybeSingle(),
    ]);
    setRole((roleRow?.role as AppRole) ?? "pending");
    setProfile(profileRow ?? null);
    setRoleLoaded(true);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setRoleLoaded(false);
        setTimeout(() => loadRole(sess.user.id), 0);
      } else {
        setRole(null);
        setProfile(null);
        setRoleLoaded(true);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadRole(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthCtx["signIn"] = async (email, password) => {
    resetFlowSession();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      const uid = data.user.id;
      Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
        supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
      ]).then(([r, p]) => trackFlowEvent({ id: uid, name: (p.data as any)?.full_name ?? email, role: (r.data as any)?.role ?? null }, "login", { tela: "/auth", modulo: "Login" }));
    }
    return { error: error?.message ?? null };
  };

  const signUp: AuthCtx["signUp"] = async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    if (user) {
      const fu = { id: user.id, name: profile?.full_name ?? profile?.email ?? null, role };
      await trackFlowEvent(fu, "logout");
      await (supabase as any).from("flow_track_presence").update({ last_seen: new Date(0).toISOString(), ultima_acao: "Saída" }).eq("user_id", user.id);
    }
    await supabase.auth.signOut();
    resetFlowSession();
    setRole(null);
    setProfile(null);
  };

  const refreshRole = async () => {
    if (user) await loadRole(user.id);
  };

  return (
    <Ctx.Provider value={{ user, session, role, profile, loading, roleLoaded, signIn, signUp, signOut, refreshRole }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
