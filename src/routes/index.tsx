import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { AppLoader } from "@/components/AppLoader";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/")({ head: () => pageTitle("Início"), component: Index });

function Index() {
  const { user, role, loading } = useAuth();
  if (loading) return <AppLoader />;
  if (!user) return <Navigate to="/auth" />;
  if (!role || role === "pending") return <Navigate to="/pending" />;
  if (role === "logistics_operator") return <Navigate to="/admin/embarkations" />;
  if (role === "visitante") return <Navigate to="/admin/transport" />;
  return <Navigate to="/app" />;
}
