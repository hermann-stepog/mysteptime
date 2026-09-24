import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/notify";
import { Mail, ShieldCheck, AlertTriangle, Send } from "lucide-react";
import { getEmailSettings, saveEmailSettings, sendTestEmail, setEmailAlertsEnabled } from "@/lib/api/emailSettings.functions";

export function EmailSettingsCard() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getEmailSettings);
  const save = useServerFn(saveEmailSettings);
  const test = useServerFn(sendTestEmail);
  const toggle = useServerFn(setEmailAlertsEnabled);
  const { data, isLoading, error } = useQuery({ queryKey: ["email-settings"], queryFn: () => fetchSettings() });

  const [apiKey, setApiKey] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [domain, setDomain] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "toggle">(null);

  useEffect(() => {
    if (!data) return;
    setSenderEmail(data.senderEmail);
    setSenderName(data.senderName);
    setDomain(data.verifiedDomain);
  }, [data]);

  const refresh = (v: unknown) => qc.setQueryData(["email-settings"], v);

  const onSave = async () => {
    setBusy("save");
    try {
      const r = await save({ data: { apiKey: apiKey || undefined, senderEmail, senderName: senderName || undefined, verifiedDomain: domain } });
      refresh(r); setApiKey("");
      if (r.validationStatus === "verified") notify.success("Salvo e validado. Agora você pode ativar os avisos.");
      else notify.error(r.validationMessage ?? "Salvo, mas a validação não passou.");
    } catch (e: any) { notify.error(e?.message ?? "Falha ao salvar"); } finally { setBusy(null); }
  };

  const onTest = async () => {
    setBusy("test");
    try { refresh(await test({ data: { to: testTo } })); notify.success(`E-mail de teste enviado para ${testTo}.`); }
    catch (e: any) { notify.error(e?.message ?? "Falha no envio de teste"); } finally { setBusy(null); }
  };

  const onToggle = async (enabled: boolean) => {
    setBusy("toggle");
    try { refresh(await toggle({ data: { enabled } })); notify.success(enabled ? "Avisos por e-mail ativados." : "Avisos por e-mail desativados."); }
    catch (e: any) { notify.error(e?.message ?? "Falha ao alterar"); } finally { setBusy(null); }
  };

  if (isLoading) return <Card className="p-5 space-y-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></Card>;
  if (error) return null; // só operadores veem

  const validated = data?.validationStatus === "verified";

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4" />Avisos por e-mail (Resend)</h3>
          <p className="text-sm text-muted-foreground">A chave fica guardada cifrada e nunca é exibida de novo.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="email-enabled" className="text-sm">{data?.enabled ? "Ativo" : "Desativado"}</Label>
          <Switch id="email-enabled" checked={!!data?.enabled} disabled={busy !== null || (!validated && !data?.enabled)} onCheckedChange={onToggle} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Chave da API do Resend</Label>
          <Input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={data?.hasApiKey ? `Salva (termina em ${data.apiKeyLast4}) — deixe vazio para manter` : "re_..."} />
        </div>
        <div><Label>Domínio verificado</Label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="step-og.com" /></div>
        <div><Label>E-mail do remetente</Label><Input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="avisos@step-og.com" /></div>
        <div><Label>Nome do remetente</Label><Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Logística STEP" /></div>
        <div className="flex items-end"><Button onClick={onSave} loading={busy === "save"} disabled={!senderEmail || !domain}>Salvar e validar</Button></div>
      </div>

      {data?.validationMessage && (
        <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${validated ? "border-primary/40 text-foreground" : "border-destructive/40 text-destructive"}`}>
          {validated ? <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" /> : <AlertTriangle className="mt-0.5 h-4 w-4" />}
          <span>{data.validationMessage}</span>
        </div>
      )}

      {data?.hasApiKey && (
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div><Label>Enviar e-mail de teste para</Label><Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="seu.email@step-og.com" /></div>
          <div className="flex items-end"><Button variant="outline" onClick={onTest} loading={busy === "test"} disabled={!testTo}><Send className="mr-2 h-4 w-4" />Enviar teste</Button></div>
        </div>
      )}
    </Card>
  );
}
