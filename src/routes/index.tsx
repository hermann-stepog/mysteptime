import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { hasOperatorAccess } from "@/lib/access-roles";
import { AppLoader } from "@/components/AppLoader";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/")({ head: () => pageTitle("Início"), component: Index });

function Index() {
  const { user, role, loading } = useAuth();
  if (loading) return <AppLoader />;
  if (!user) return <Navigate to="/auth" />;
  if (!role || role === "pending") return <Navigate to="/pending" />;
  if (hasOperatorAccess(role)) return <Navigate to="/admin/histograma-novo" />;
  if (role === "adm_master") return <Navigate to="/admin/nominations" />;
  if (role === "visitante") return <Navigate to="/admin/transport" />;
  if (role === "orcamentos_projetos") return <Navigate to="/admin/cost-simulator" />;
  return <Navigate to="/app" />;
}
