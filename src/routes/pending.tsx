import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Clock, RefreshCw, LogOut } from "lucide-react";
import { useEffect } from "react";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/pending")({ head: () => pageTitle("Aguardando Aprovação"), component: Pending });

function Pending() {
  const { user, role, signOut, refreshRole, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/auth" });
    else if (role && role !== "pending") navigate({ to: "/" });
  }, [user, role, loading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/20 text-warning-foreground">
          <Clock className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Acesso em configuração</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Seu acesso está sendo configurado. Entre em contato com a Logística.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshRole}><RefreshCw className="mr-2 h-4 w-4" />Verificar</Button>
          <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}><LogOut className="mr-2 h-4 w-4" />Sair</Button>
        </div>
      </Card>
    </div>
  );
}
