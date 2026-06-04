import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, docStatus } from "@/lib/format";
import { toast } from "sonner";
import { Plus, AlertTriangle } from "lucide-react";
import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/app/documents")({ component: Docs });

const DOC_TYPES = ["ASO", "NR-10", "NR-13", "CREA", "Certificado de Sobrevivência Offshore", "Outros"];

function Docs() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: docs } = useQuery({
    queryKey: ["my-docs"],
    queryFn: async () => (await supabase.from("documents").select("*").eq("collaborator_id", user!.id).order("expires_at")).data ?? [],
  });

  const alerts = useMemo(() => (docs ?? []).filter((d) => docStatus(d.expires_at) !== "valid"), [docs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Meus documentos</h1>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />Adicionar</Button>
      </div>

      {alerts.length > 0 && (
        <Card className="border-warning/40 bg-warning/10 p-3 text-sm">
          <div className="flex items-center gap-2 text-warning-foreground"><AlertTriangle className="h-4 w-4" />{alerts.length} documento(s) precisam de atenção.</div>
        </Card>
      )}

      {creating && <NewDoc onClose={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["my-docs"] }); }} />}

      <div className="space-y-2">
        {(docs ?? []).map((d) => {
          const s = docStatus(d.expires_at);
          const tone = s === "expired" ? "destructive" : s === "expiring" ? "warning" : "success";
          return (
            <Card key={d.id} className="p-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{d.doc_name}</div>
                <div className="text-xs text-muted-foreground">{d.doc_type} · Validade {fmtDate(d.expires_at)}</div>
              </div>
              <StatusBadge tone={tone}>{s === "valid" ? "Válido" : s === "expiring" ? "Expirando" : "Vencido"}</StatusBadge>
            </Card>
          );
        })}
        {(docs ?? []).length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum documento.</Card>}
      </div>
    </div>
  );
}

function NewDoc({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [f, setF] = useState({ doc_type: DOC_TYPES[0], doc_name: "", expires_at: "" });
  const save = async () => {
    if (!f.doc_name || !f.expires_at) { toast.error("Preencha os campos"); return; }
    const { error } = await supabase.from("documents").insert({ collaborator_id: user!.id, ...f });
    if (error) toast.error(error.message); else { toast.success("Documento salvo"); onClose(); }
  };
  return (
    <Card className="p-4 space-y-3">
      <div><Label>Tipo</Label>
        <Select value={f.doc_type} onValueChange={(v) => setF({ ...f, doc_type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{DOC_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label>Nome / nº</Label><Input value={f.doc_name} onChange={(e) => setF({ ...f, doc_name: e.target.value })} /></div>
      <div><Label>Validade</Label><Input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></div>
      <Button onClick={save} className="w-full">Salvar</Button>
    </Card>
  );
}
