import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { AppLoader } from "@/components/AppLoader";
import { AnimatedOutlet } from "@/components/AnimatedOutlet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

type NavItem = { to: string; label: string; exact?: boolean };
const nav: NavItem[] = [
  { to: "/admin/histograma-novo", label: "Histograma Offshore" },
  { to: "/admin/timesheet-offshore", label: "Timesheet Offshore" },
  { to: "/admin/nominations",    label: "Nomeações" },
  { to: "/admin/transport",      label: "Transporte" },
  { to: "/admin/hospedagem",     label: "Hospedagem" },
  { to: "/admin/passagens-aereas", label: "Passagens Aéreas" },
  { to: "/admin/reembolsos",     label: "Reembolsos" },
  { to: "/admin/collaborators",  label: "Colaboradores" },
  { to: "/admin/costs",          label: "Custos" },
  { to: "/admin/rates",          label: "Rates" },
  { to: "/admin/bm",             label: "Boletim de Medição" },
  { to: "/admin/approvals",      label: "Aprovações" },
  { to: "/admin/reports",        label: "Relatórios" },
  { to: "/admin/settings",       label: "Configurações" },
];

// Todo mundo que não é operador (Visitante, Solicitante e os 4 papéis de etapa de Nomeações)
// tem acesso às mesmas 3 abas: Histograma Offshore (Dashboard + Histograma, sem Lançamentos —
// ver histograma-novo.tsx) e Nomeações (board inteiro visível, todas as etapas, em tempo
// real — cada um só mexe na própria etapa, via os gates já existentes em canMoveToColumn/RLS).
const NAO_OPERADOR_PATHS = ["/admin/histograma-novo", "/admin/nominations"];

// Visitante ainda tem Transporte e Timesheet Offshore além disso (acesso histórico dele).
const VISITANTE_PATHS = ["/admin/transport", "/admin/timesheet-offshore", ...NAO_OPERADOR_PATHS];

const PM_PATHS = NAO_OPERADOR_PATHS;

// Papéis de etapa do fluxo de Nomeações (Aprovação Técnica/Qualidade/RH/SMS) — a ação real (o
// que cada um pode editar dentro de Nomeações) continua restrita por etapa via RLS, isso aqui
// só decide o que aparece no menu.
const STAGE_ROLES = ["aprovacao_tecnica", "qualidade", "rh", "sms"];
const STAGE_ROLE_PATHS = NAO_OPERADOR_PATHS;

// RH e SMS (só esses dois papéis de etapa, não Aprovação Técnica/Qualidade) também
// acompanham o Relatório de Viagens Internacionais — a própria PassagensAereasPage esconde
// o resto da tela (Solicitações/Próximas Viagens) pra esses dois papéis, mostra só o relatório.
const RH_SMS_EXTRA_PATHS = ["/admin/passagens-aereas"];

function AdminLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAllowedRole = role === "logistics_operator" || role === "visitante" || role === "pm" || STAGE_ROLES.includes(role ?? "");

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (!isAllowedRole) navigate({ to: "/app" });
  }, [user, role, loading, isAllowedRole, navigate]);

  if (loading || !user || !isAllowedRole) {
    return <AppLoader />;
  }

  const visibleNav = role === "visitante"
    ? nav.filter((n) => VISITANTE_PATHS.includes(n.to))
    : role === "pm"
      ? nav.filter((n) => PM_PATHS.includes(n.to))
      : STAGE_ROLES.includes(role ?? "")
        ? nav.filter((n) => STAGE_ROLE_PATHS.includes(n.to) || ((role === "rh" || role === "sms") && RH_SMS_EXTRA_PATHS.includes(n.to)))
        : nav;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 to-slate-100/60"
    >

      {/* ── Top navbar ──
          O header inteiro é um flex-wrap: em telas largas os itens cabem numa linha só e
          nada muda visualmente. Quando não cabem, o próprio nav quebra em várias linhas
          (em vez de rolar por baixo do pano, que é o que gerava a barra de rolagem
          horizontal) — sem largura fixa em nenhum elemento, então nada ultrapassa a viewport. */}
      <header className="sticky top-0 z-10 w-full max-w-full bg-[#0f2744]/90 backdrop-blur-md border-b border-white/10 px-3 py-2 sm:px-4 lg:px-6">
        <div className="flex w-full max-w-full flex-wrap items-start gap-x-4 gap-y-2">
          <BrandLogo className="mt-0.5 h-7 w-auto shrink-0 sm:h-8 lg:h-9" />

          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {visibleNav.map((n) => {
              const active = n.exact ? pathname === n.to : pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm",
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
            className="mt-1 shrink-0 text-white/50 hover:text-red-300 transition-colors"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 lg:p-8">
        <AnimatedOutlet />
      </main>
    </motion.div>
  );
}
