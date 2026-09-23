import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BrandLogo } from "@/components/BrandLogo";

// Formulário compartilhado por dois usos: a troca voluntária (ChangePasswordButton, qualquer
// usuário pode usar quando quiser) e a troca obrigatória de primeiro acesso (ver
// RequirePasswordChange abaixo). Trocar a senha aqui sempre desliga must_change_password —
// mesmo numa troca voluntária, se por acaso ainda estivesse marcada, ela deixa de valer.
function ChangePasswordFields({ submitLabel, onSuccess }: { submitLabel: string; onSuccess: () => void }) {
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);

  const salvar = useMutation({
    mutationFn: async () => {
      if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
      if (senha !== confirmar) throw new Error("As senhas não coincidem.");
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        // must_change_password ainda não está nos tipos gerados (coluna nova); cast local.
        await (supabase as any).from("profiles").update({ must_change_password: false }).eq("id", userData.user.id);
      }
    },
    onSuccess: () => { notify.success("Senha atualizada."); onSuccess(); },
    onError: (e: any) => notify.error(e.message ?? "Erro ao trocar a senha."),
  });

  return (
    <div className="grid gap-3">
      <div>
        <Label className="text-xs">Nova senha</Label>
        <div className="relative">
          <Input
            type={mostrar ? "text" : "password"} value={senha} onChange={(e) => setSenha(e.target.value)}
            placeholder="Mínimo 8 caracteres" className="pr-9"
          />
          <button
            type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            onClick={() => setMostrar((v) => !v)} tabIndex={-1}
          >
            {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <Label className="text-xs">Confirmar nova senha</Label>
        <Input type={mostrar ? "text" : "password"} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
      </div>
      <Button
        className="w-full" disabled={!senha || !confirmar} loading={salvar.isPending}
        onClick={() => salvar.mutate()}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

// Botão "Trocar senha" — pra qualquer usuário logado usar quando quiser (pedido dela: quem se
// cadastra sozinho também precisa ter essa opção, não só quem recebeu senha de um operador).
// Colocado no cabeçalho de cada ambiente (admin, /pm, /rh-sms, /app), do lado do "Sair".
export function ChangePasswordButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="icon" className={className} title="Trocar senha" onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Trocar senha</DialogTitle></DialogHeader>
          <ChangePasswordFields submitLabel="Salvar nova senha" onSuccess={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

// Tela cheia, sem como fechar/pular — mostrada no lugar de qualquer rota enquanto
// profiles.must_change_password estiver true (ver RequirePasswordChange). Acontece quando um
// operador cria o usuário ou redefine a senha dele: a senha que o operador digitou é só
// provisória, então a pessoa é obrigada a trocar por uma só dela antes de continuar.
function ForcePasswordChangeScreen() {
  const { signOut, refreshRole } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100/60 px-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <BrandLogo className="h-8 w-auto" />
        <div>
          <h1 className="text-lg font-semibold">Defina uma nova senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Por segurança, antes de continuar você precisa trocar a senha provisória por uma só sua.
          </p>
        </div>
        <ChangePasswordFields submitLabel="Definir senha e continuar" onSuccess={refreshRole} />
        <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={signOut}>
          Sair
        </Button>
      </Card>
    </div>
  );
}

// Ponto único de aplicação — envolve o <Outlet/> lá no __root.tsx, então cobre todo ambiente
// (admin, pm, rh-sms, app, etc.) sem precisar mexer em cada layout separadamente.
export function RequirePasswordChange({ children }: { children: ReactNode }) {
  const { user, roleLoaded, profile } = useAuth();
  if (user && roleLoaded && profile?.must_change_password) {
    return <ForcePasswordChangeScreen />;
  }
  return <>{children}</>;
}
