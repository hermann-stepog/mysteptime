import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({ component: Index });

function Index() {
  const { user, role, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/auth" />;
  if (!role || role === "pending") return <Navigate to="/pending" />;
  if (role === "logistics_operator") return <Navigate to="/admin" />;
  return <Navigate to="/app" />;
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}
