import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { AppLoader } from "@/components/AppLoader";
import { AnimatedOutlet } from "@/components/AnimatedOutlet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

type NavItem = { to: string; label: string; exact?: boolean };
const nav: NavItem[] = [
  { to: "/admin/embarkations",   label: "Histograma Offshore" },
  { to: "/admin/histograma-novo", label: "Histograma Offshore Novo" },
  { to: "/admin/timesheet-offshore", label: "Timesheet Offshore" },
  { to: "/admin/nominations",    label: "Nomeações" },
  { to: "/admin/transport",      label: "Transporte" },
  { to: "/admin/collaborators",  label: "Colaboradores" },
  { to: "/admin/costs",          label: "Custos" },
  { to: "/admin/rates",          label: "Rates" },
  { to: "/admin/bm",             label: "Boletim de Medição" },
  { to: "/admin/approvals",      label: "Aprovações" },
  { to: "/admin/reports",        label: "Relatórios" },
  { to: "/admin/settings",       label: "Configurações" },
];

// Visitante só vê 3 módulos no menu (o acesso de verdade — quais abas/dados aparecem
// dentro de cada um — é restringido dentro de cada página e via RLS no Supabase).
const VISITANTE_PATHS = ["/admin/transport", "/admin/histograma-novo", "/admin/timesheet-offshore"];

function AdminLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (role !== "logistics_operator" && role !== "visitante") navigate({ to: "/app" });
  }, [user, role, loading, navigate]);

  if (loading || !user || (role !== "logistics_operator" && role !== "visitante")) {
    return <AppLoader />;
  }

  const visibleNav = role === "visitante" ? nav.filter((n) => VISITANTE_PATHS.includes(n.to)) : nav;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 to-slate-100/60">

      {/* ── Top navbar ── */}
      <header className="sticky top-0 z-10 flex items-center gap-4 bg-[#0f2744]/90 backdrop-blur-md border-b border-white/10 px-4 py-2 lg:px-6">
        <BrandLogo className="h-9 w-auto shrink-0" />

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {visibleNav.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-white/15 text-white shadow-sm border border-white/20"
                    : "text-white/55 hover:bg-white/8 hover:text-white/85",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
          title={`Sair (${profile?.full_name || profile?.email || ""})`}
          className="shrink-0 text-white/50 hover:text-red-300 transition-colors"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 overflow-auto p-4 lg:p-8">
        <AnimatedOutlet />
      </main>
    </div>
  );
}
