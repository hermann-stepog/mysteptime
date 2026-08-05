import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/lib/notify";
import { Loader2, Mail, Lock, Eye, EyeOff, User } from "lucide-react";
import heroUrl from "@/assets/ChatGPT Image 18 de jun. de 2026, 09_16_55.png";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/auth")({ head: () => pageTitle("Login"), component: AuthPage });

function AuthPage() {
  const { user, role, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user) {
      if (!role || role === "pending") navigate({ to: "/pending" });
      else if (role === "logistics_operator") navigate({ to: "/admin/histograma-novo" });
      else if (role === "pm") navigate({ to: "/pm" });
      else navigate({ to: "/app" });
    }
  }, [user, role, loading, navigate]);

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(14px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="relative flex min-h-screen w-full overflow-hidden"
    >
      {/* Metade esquerda: imagem de fundo com a logo STEP e os selos (Segurança/Transporte/Eficiência). */}
      <div
        className="hidden bg-cover bg-left lg:block lg:w-1/2"
        style={{ backgroundImage: `url(${heroUrl})` }}
        aria-hidden
      />

      {/* Metade direita: painel azul marinho com o formulário. */}
      <div className="flex w-full flex-col items-center justify-center bg-[#0e1c38] p-8 lg:w-1/2">
        <motion.div
          className="w-full max-w-md text-center"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: "easeOut" }}
        >
          <h1
            className="font-serif text-2xl uppercase tracking-[0.15em] text-white"
            style={{ textShadow: "0 0 18px rgba(255,255,255,0.45), 0 0 40px rgba(96,165,250,0.35)" }}
          >
            Step Time Hub
          </h1>
          <div className="relative mx-auto mt-3 h-px w-40 bg-gradient-to-r from-transparent via-white/50 to-transparent">
            <div
              className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              style={{ boxShadow: "0 0 10px 2px rgba(255,255,255,0.9), 0 0 22px 6px rgba(96,165,250,0.5)" }}
            />
          </div>
          <p className="mt-3 text-xs uppercase tracking-widest text-slate-500">Logística de Pessoal</p>

          <div className="mt-8 text-left">
            <h2 className="text-2xl font-bold text-white">Acesso</h2>
            <p className="mt-1 text-sm text-slate-400">Entre com seu e-mail corporativo.</p>
          </div>

          <Tabs defaultValue="signin" className="mt-6">
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-white/5 p-1">
              <TabsTrigger value="signin" className="rounded-lg text-sm text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white">Entrar</TabsTrigger>
              <TabsTrigger value="signup" className="rounded-lg text-sm text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-white">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <Form busy={busy} setBusy={setBusy} onSubmit={async (email, password) => {
                const { error } = await signIn(email, password);
                if (error) notify.error(error);
              }} />
            </TabsContent>
            <TabsContent value="signup">
              <Form busy={busy} setBusy={setBusy} withName onSubmit={async (email, password, name) => {
                const { error } = await signUp(email, password, name ?? email);
                if (error) notify.error(error);
                else notify.success("Conta criada. Aguarde liberação do acesso.");
              }} />
            </TabsContent>
          </Tabs>
        </motion.div>

        <p className="mt-10 text-xs text-slate-600">© {new Date().getFullYear()} STEP Integrated Solutions</p>
      </div>
    </motion.div>
  );
}

// Campos escuros (pra combinar com o painel azul marinho), com ícone à esquerda e espaço
// reservado à direita pro botão de mostrar/ocultar senha.
const AUTH_INPUT_CLASS =
  "h-12 rounded-xl border-white/10 bg-white/5 pl-11 pr-11 text-sm text-white shadow-none placeholder:text-slate-500 " +
  "focus-visible:ring-1 focus-visible:ring-blue-400/60 focus-visible:ring-offset-0 " +
  "[&:-webkit-autofill]:[-webkit-text-fill-color:#fff] [&:-webkit-autofill]:[box-shadow:inset_0_0_0px_1000px_#132038]";

function Form({ busy, setBusy, onSubmit, withName }: { busy: boolean; setBusy: (b: boolean) => void; onSubmit: (email: string, password: string, name?: string) => Promise<void>; withName?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit(email, password, name); setBusy(false); }}
    >
      {withName && (
        <div>
          <Label htmlFor="name" className="text-xs font-medium text-slate-400">Nome completo</Label>
          <div className="relative mt-1.5">
            <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input id="name" placeholder="Digite seu nome completo" className={AUTH_INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        </div>
      )}
      <div>
        <Label htmlFor="email" className="text-xs font-medium text-slate-400">E-mail</Label>
        <div className="relative mt-1.5">
          <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input id="email" type="email" placeholder="Digite seu e-mail" className={AUTH_INPUT_CLASS} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
      </div>
      <div>
        <Label htmlFor="password" className="text-xs font-medium text-slate-400">Senha</Label>
        <div className="relative mt-1.5">
          <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Digite sua senha"
            className={AUTH_INPUT_CLASS}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={withName ? "new-password" : "current-password"}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="mt-2 h-12 w-full rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 text-sm font-semibold uppercase tracking-widest hover:from-blue-400 hover:to-blue-600" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {withName ? "Criar conta" : "Entrar"}
      </Button>
    </form>
  );
}
