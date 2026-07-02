import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { Loader2, BarChart2, Truck, Hotel, FileCheck2, ClipboardList, Receipt, BadgeCheck, BarChart3, Settings, LogOut, Users, ClipboardCheck } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

type NavItem = { to: string; label: string; icon: typeof BarChart2; exact?: boolean };
const nav: NavItem[] = [
  { to: "/admin/embarkations",   label: "Histograma Offshore", icon: BarChart2 },
  { to: "/admin/nominations",    label: "Nomeações",           icon: ClipboardCheck },
  { to: "/admin/transport",      label: "Transporte",          icon: Truck },
  { to: "/admin/collaborators",  label: "Colaboradores",       icon: Users },
  { to: "/admin/hotel",          label: "Hospedagem",          icon: Hotel },
  { to: "/admin/documents",      label: "Documentos",          icon: FileCheck2 },
  { to: "/admin/timesheets",     label: "Timesheets",          icon: ClipboardList },
  { to: "/admin/costs",          label: "Custos",              icon: Receipt },
  { to: "/admin/approvals",      label: "Aprovações",          icon: BadgeCheck },
  { to: "/admin/reports",        label: "Relatórios",          icon: BarChart3 },
  { to: "/admin/settings",       label: "Configurações",       icon: Settings },
];

function AdminLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (role !== "logistics_operator") navigate({ to: "/app" });
  }, [user, role, loading, navigate]);

  if (loading || !user || role !== "logistics_operator") {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden w-64 flex-col lg:flex bg-[#0f2744]/80 backdrop-blur-md border-r border-white/10">

        {/* Logo area */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
          <BrandLogo className="h-10 w-auto" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-white/90 leading-tight">My Step Time</p>
            <p className="text-[10px] text-white/40 leading-tight">Operador</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150 font-medium",
                  active
                    ? "bg-white/15 text-white shadow-sm border border-white/20"
                    : "text-white/55 hover:bg-white/8 hover:text-white/85",
                )}
              >
                <n.icon className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-white/40")} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="h-7 w-7 rounded-full bg-white/15 flex items-center justify-center shrink-0 border border-white/20">
              <span className="text-[11px] font-bold text-white/80">
                {(profile?.full_name || profile?.email || "?")[0].toUpperCase()}
              </span>
            </div>
            <span className="text-xs text-white/50 truncate">{profile?.full_name || profile?.email}</span>
          </div>
          <button
            onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/40 hover:bg-red-500/20 hover:text-red-300 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      {/* ── Mobile layout ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="lg:hidden">
          <header className="sticky top-0 z-10 flex items-center justify-between bg-[#0f2744]/80 backdrop-blur-md border-b border-white/10 px-4 py-3">
            <BrandLogo className="h-8 w-auto" />
            <button
              onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
              className="text-white/50 hover:text-red-300 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-white/10 bg-[#0f2744]/70 px-2 py-2">
            {nav.map((n) => {
              const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "flex-shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    active ? "bg-white/20 text-white border border-white/25" : "text-white/50 hover:bg-white/10 hover:text-white/80",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <main className="flex-1 overflow-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
