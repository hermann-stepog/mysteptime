import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useViewAs } from "@/hooks/useViewAs";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { LogOut, X } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { AppLoader } from "@/components/AppLoader";
import { AnimatedOutlet } from "@/components/AnimatedOutlet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pm")({ component: PmLayout });

const NAV = [
  { to: "/pm", label: "Minhas Solicitações" },
  { to: "/pm/bms", label: "BMs para Aprovar" },
  { to: "/admin/histograma-novo", label: "Histograma Offshore" },
];

function PmLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  // "Ver como Solicitante" (ver useViewAs) deixa a conta master entrar aqui também — o gate
  // de quem entra de verdade (usuário logado, papel pending) continua sempre no papel real.
  const { viewAsRole, setViewAsRole } = useViewAs();
  const effectiveRole = viewAsRole ?? role;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (effectiveRole === "visitante") navigate({ to: "/admin/transport" });
    else if (effectiveRole !== "pm") navigate({ to: "/admin/histograma-novo" });
  }, [user, role, effectiveRole, loading, navigate]);

  if (loading || !user || effectiveRole !== "pm") {
    return <AppLoader />;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/60"
    >
      <header className="sticky top-0 z-10 border-b bg-[#0f2744]/90 backdrop-blur-md border-white/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-8 w-auto" />
            <div className="hidden sm:block">
              <p className="text-[11px] font-semibold text-white/90">My Step Time</p>
              <p className="text-[10px] text-white/50">Área do Solicitante</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {viewAsRole === "pm" && (
              <button
                onClick={() => { setViewAsRole(null); navigate({ to: "/admin/histograma-novo" }); }}
                title="Voltar ao seu acesso normal"
                className="flex items-center gap-1 rounded-md border border-amber-300/40 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-400/20"
              >
                Vendo como: Solicitante<X className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="text-xs text-white/60 hidden sm:block">
              {profile?.full_name ?? profile?.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-white/50 hover:bg-red-500/20 hover:text-red-300"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth" });
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-4xl gap-1 px-4 pb-2">
          {NAV.map((n) => {
            const active = pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  active ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/8 hover:text-white/85",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <AnimatedOutlet />
      </main>
    </motion.div>
  );
}
