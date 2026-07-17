import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { AppLoader } from "@/components/AppLoader";
import { AnimatedOutlet } from "@/components/AnimatedOutlet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pm")({ component: PmLayout });

const NAV = [
  { to: "/pm", label: "Minhas Solicitações" },
  { to: "/pm/bms", label: "BMs para Aprovar" },
];

function PmLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (role === "visitante") navigate({ to: "/admin/transport" });
    else if (role !== "pm") navigate({ to: "/admin/histograma-novo" });
  }, [user, role, loading, navigate]);

  if (loading || !user || role !== "pm") {
    return <AppLoader />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/60">
      <header className="sticky top-0 z-10 border-b bg-[#0f2744]/90 backdrop-blur-md border-white/10">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-8 w-auto" />
            <div className="hidden sm:block">
              <p className="text-[11px] font-semibold text-white/90">My Step Time</p>
              <p className="text-[10px] text-white/50">Área do PM</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
    </div>
  );
}
