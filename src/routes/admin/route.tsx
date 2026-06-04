import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { Loader2, LayoutDashboard, Ship, Truck, Hotel, FileCheck2, ClipboardList, Receipt, CalendarClock, BadgeCheck, BarChart3, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; exact?: boolean };
const nav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/embarkations", label: "Embarques", icon: Ship },
  { to: "/admin/transport", label: "Transporte", icon: Truck },
  { to: "/admin/hotel", label: "Hospedagem", icon: Hotel },
  { to: "/admin/documents", label: "Documentos", icon: FileCheck2 },
  { to: "/admin/timesheets", label: "Timesheets", icon: ClipboardList },
  { to: "/admin/costs", label: "Custos", icon: Receipt },
  { to: "/admin/payroll", label: "Folha", icon: CalendarClock },
  { to: "/admin/approvals", label: "Aprovações", icon: BadgeCheck },
  { to: "/admin/reports", label: "Relatórios", icon: BarChart3 },
  { to: "/admin/settings", label: "Configurações", icon: Settings },
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
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-foreground"><Ship className="h-4 w-4" /></div>
          <div>
            <div className="text-sm font-semibold">My Step Time</div>
            <div className="text-xs text-sidebar-foreground/60">Operador</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}>
                <n.icon className="h-4 w-4" />{n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="px-2 py-1.5 text-xs text-sidebar-foreground/60 truncate">{profile?.full_name || profile?.email}</div>
          <button onClick={async () => { await signOut(); navigate({ to: "/auth" }); }} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex w-full flex-col lg:hidden">
        <header className="sticky top-0 z-10 flex items-center justify-between bg-sidebar px-4 py-3 text-sidebar-foreground">
          <span className="font-semibold">My Step Time</span>
          <button onClick={async () => { await signOut(); navigate({ to: "/auth" }); }} className="text-sm"><LogOut className="h-4 w-4" /></button>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b bg-card px-2 py-2">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={cn("flex-shrink-0 rounded-md px-3 py-1.5 text-xs font-medium", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{n.label}</Link>
            );
          })}
        </nav>
      </div>

      <main className="flex-1 overflow-auto p-4 lg:p-8"><Outlet /></main>
    </div>
  );
}
