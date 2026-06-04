import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { Loader2, ClipboardList, CalendarDays, FileText, Bell, Wallet, LogOut, Ship } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({ component: AppLayout });

type T = { to: string; label: string; icon: typeof ClipboardList; exact?: boolean };
const tabs: T[] = [
  { to: "/app", label: "RDO", icon: ClipboardList, exact: true },
  { to: "/app/timesheet", label: "Timesheet", icon: CalendarDays },
  { to: "/app/documents", label: "Docs", icon: FileText },
  { to: "/app/schedule", label: "Agenda", icon: Bell },
  { to: "/app/financial", label: "Financeiro", icon: Wallet },
];

function AppLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (role === "logistics_operator") navigate({ to: "/admin" });
  }, [user, role, loading, navigate]);

  if (loading || !user || role !== "collaborator") {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-sidebar px-4 py-3 text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-foreground"><Ship className="h-4 w-4" /></div>
          <div>
            <div className="text-sm font-semibold">My Step Time</div>
            <div className="text-xs text-sidebar-foreground/70 truncate max-w-[180px]">{profile?.full_name ?? profile?.email}</div>
          </div>
        </div>
        <button onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}><LogOut className="h-5 w-5" /></button>
      </header>
      <main className="flex-1 p-4"><Outlet /></main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 grid grid-cols-5 border-t bg-card">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to as never} className={cn("flex flex-col items-center justify-center gap-1 py-2 text-[10px] transition-colors", active ? "text-primary" : "text-muted-foreground")}>
              <t.icon className="h-5 w-5" />{t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
