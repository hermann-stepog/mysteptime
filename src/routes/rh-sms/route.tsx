import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { LogOut } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { AppLoader } from "@/components/AppLoader";
import { AnimatedOutlet } from "@/components/AnimatedOutlet";
import { Button } from "@/components/ui/button";
import { ChangePasswordButton } from "@/components/ChangePassword";

export const Route = createFileRoute("/rh-sms")({ component: RhSmsLayout });

const SUBTITLE: Record<string, string> = {
  rh: "Validação RH",
  sms: "Validação SMS",
};

// Área dedicada só pra RH e SMS — pedido dela: nada além do board de Nomeações aparece aqui
// (sem Histograma Offshore, sem as outras abas de Nomeações), então nem precisa de navegação
// interna, diferente de /pm. A restrição de só mover os próprios cards já existe hoje (ver
// STAGE_ROLE/useCanActOnStage em NominationsPage.tsx), isso aqui só isola o ambiente.
function RhSmsLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (!role || role === "pending") navigate({ to: "/pending" });
    else if (role !== "rh" && role !== "sms") navigate({ to: "/admin/histograma-novo" });
  }, [user, role, loading, navigate]);

  if (loading || !user || (role !== "rh" && role !== "sms")) {
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
        <div className="flex items-center justify-between px-3 py-3 sm:px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-8 w-auto" />
            <div className="hidden sm:block">
              <p className="text-[11px] font-semibold text-white/90">My Step Time</p>
              <p className="text-[10px] text-white/50">{SUBTITLE[role ?? ""] ?? "Validação de Nomeações"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/60 hidden sm:block">
              {profile?.full_name ?? profile?.email}
            </span>
            <ChangePasswordButton className="text-white/50 hover:bg-white/10 hover:text-white/85" />
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
      </header>

      <main className="p-4 lg:p-8">
        <AnimatedOutlet />
      </main>
    </motion.div>
  );
}
