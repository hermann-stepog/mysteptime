import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { diagnoseEmailAlert } from "@/lib/api/emailDiagnosis.functions";

function renderLine(line: string, i: number) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="min-h-[0.5rem]">
      {parts.map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : p))}
    </p>
  );
}

export function EmailDiagnosisCard() {
  const run = useServerFn(diagnoseEmailAlert);
  const [details, setDetails] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function analyze() {
    setBusy(true); setError(""); setAnswer("");
    try {
      const r = await run({ data: { details } });
      setAnswer(r.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na análise.");
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" />Diagnóstico de alertas por e-mail</CardTitle>
        <CardDescription>Descreva o problema ou cole a mensagem de erro. A IA indica a causa provável e como corrigir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={5} value={details} onChange={(e) => setDetails(e.target.value)}
          placeholder="Ex.: cadastrei o usuário fulano@step-og.com e o aviso de boas-vindas não chegou..." maxLength={8000} />
        <Button onClick={analyze} disabled={busy || details.trim().length < 5}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Analisar
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {answer && <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">{answer.split("\n").map(renderLine)}</div>}
      </CardContent>
    </Card>
  );
}
