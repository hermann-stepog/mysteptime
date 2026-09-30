import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { moduleFromPath, trackFlowEvent, updatePresence, type FlowUser } from "@/lib/flowTrack";

// Registra automaticamente cada tela aberta (com o tempo gasto na anterior) e mantém a
// presença "ao vivo" do usuário (sinal a cada 30s) para o Flow Track.
export function FlowTracker() {
  const { user, role, profile } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const last = useRef<{ path: string; at: number } | null>(null);
  const sessionStarted = useRef<string | null>(null);

  const fu: FlowUser | null = user ? { id: user.id, name: profile?.full_name ?? profile?.email ?? user.email ?? null, role } : null;

  useEffect(() => {
    if (!fu || pathname === "/auth") return;
    const now = Date.now();
    const prev = last.current;
    if (prev?.path === pathname) return;
    if (sessionStarted.current !== fu.id) {
      sessionStarted.current = fu.id;
      updatePresence(fu, { sessao_inicio: new Date().toISOString() });
    }
    trackFlowEvent(fu, "abertura_tela", {
      tela: pathname,
      detalhe: prev ? `Veio de ${moduleFromPath(prev.path)} (${Math.round((now - prev.at) / 1000)}s)` : undefined,
      duracao_ms: prev ? now - prev.at : undefined,
    });
    updatePresence(fu, { tela: pathname, modulo: moduleFromPath(pathname), ultima_acao: "Abriu tela", ultima_acao_em: new Date().toISOString() });
    last.current = { path: pathname, at: now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, fu?.id, role]);

  useEffect(() => {
    if (!fu) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") updatePresence(fu, {}); }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fu?.id]);

  return null;
}
