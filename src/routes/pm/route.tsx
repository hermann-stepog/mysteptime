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

export const Route = createFileRoute("/pm")({ component: PmLayout });

function PmLayout() {
  const { user, role, loading, signOut, profile } = useAuth();
  const navigate = useNavigate();

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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/60"
    >
      <header className="sticky top-0 z-10 border-b bg-[#0f2744]/90 backdrop-blur-md border-white/10">
        <div className="flex items-center justify-between px-3 py-4 sm:px-4 lg:px-6">
          <div className="flex items-center gap-4">
            <BrandLogo className="h-11 w-auto" />
            <div className="hidden items-center gap-2 sm:flex">
              <p className="text-base font-semibold text-white/90">My Step Time</p>
              <span className="text-white/30">|</span>
              <p className="text-sm text-white/70">Área do Solicitante</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:flex sm:flex-col sm:items-end leading-tight">
              <span className="text-sm text-white/80">{profile?.full_name ?? profile?.email}</span>
              {profile?.perfil && <span className="text-xs text-white/50">{profile.perfil}</span>}
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
