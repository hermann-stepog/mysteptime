import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  const { user, role, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user) {
      if (!role || role === "pending") navigate({ to: "/pending" });
      else if (role === "logistics_operator") navigate({ to: "/admin" });
      else navigate({ to: "/app" });
    }
  }, [user, role, loading, navigate]);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-12 w-auto brightness-0 invert" />
        </div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight">Logística de pessoal offshore, sem fricção.</h1>
          <p className="mt-4 max-w-md text-sidebar-foreground/70">Embarques, transporte, documentação, timesheet e custos em um único painel para operações de óleo &amp; gás.</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© {new Date().getFullYear()} STEP Oil &amp; Gas</p>
      </div>
      <div className="flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md p-8">
          <h2 className="text-2xl font-semibold">Acesso</h2>
          <p className="mt-1 text-sm text-muted-foreground">Entre com seu e-mail corporativo.</p>
          <Tabs defaultValue="signin" className="mt-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <Form busy={busy} setBusy={setBusy} onSubmit={async (email, password) => {
                const { error } = await signIn(email, password);
                if (error) toast.error(error);
              }} />
            </TabsContent>
            <TabsContent value="signup">
              <Form busy={busy} setBusy={setBusy} withName onSubmit={async (email, password, name) => {
                const { error } = await signUp(email, password, name ?? email);
                if (error) toast.error(error);
                else toast.success("Conta criada. Aguarde liberação do acesso.");
              }} />
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function Form({ busy, setBusy, onSubmit, withName }: { busy: boolean; setBusy: (b: boolean) => void; onSubmit: (email: string, password: string, name?: string) => Promise<void>; withName?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(email, password, name); setBusy(false); }}
    >
      {withName && (
        <div className="space-y-2">
          <Label htmlFor="name">Nome completo</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={withName ? "new-password" : "current-password"} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {withName ? "Criar conta" : "Entrar"}
      </Button>
    </form>
  );
}
