import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/app/")({ component: RDOPage });

function RDOPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["my-rdo"],
    queryFn: async () => (await supabase.from("rdo_entries").select("*, projects(code, name)").eq("collaborator_id", user!.id).order("report_date", { ascending: false })).data ?? [],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">RDO — Relatório Diário</h1>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />Novo</Button>
      </div>

      {creating && <NewRDO onClose={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["my-rdo"] }); }} />}

      <div className="space-y-2">
        {(rows ?? []).map((r: any) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-medium">{fmtDate(r.report_date)} — {r.projects?.code ?? "—"}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{r.activity}</div>
              </div>
              <StatusBadge tone={r.status === "approved" ? "success" : r.status === "submitted" ? "primary" : "muted"}>
                {r.status === "draft" ? "Rascunho" : r.status === "submitted" ? "Enviado" : "Aprovado"}
              </StatusBadge>
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{r.hours}h</span>
              {r.observations && <span className="truncate max-w-[60%]">{r.observations}</span>}
            </div>
          </Card>
        ))}
        {(rows ?? []).length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum RDO. Toque em Novo.</Card>}
      </div>
    </div>
  );
}

function NewRDO({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: async () => (await supabase.from("projects").select("*").eq("active", true)).data ?? [] });
  const [f, setF] = useState({ report_date: new Date().toISOString().slice(0, 10), project_id: "", activity: "", hours: "8", observations: "" });

  const save = async (status: "draft" | "submitted") => {
    if (!f.activity) { toast.error("Descreva a atividade"); return; }
    const { error } = await supabase.from("rdo_entries").insert({
      collaborator_id: user!.id, report_date: f.report_date, project_id: f.project_id || null,
      activity: f.activity, hours: Number(f.hours) || 0, observations: f.observations || null, status,
    });
    if (error) toast.error(error.message); else { toast.success(status === "draft" ? "Rascunho salvo" : "RDO enviado"); onClose(); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div><Label>Data</Label><Input type="date" value={f.report_date} onChange={(e) => setF({ ...f, report_date: e.target.value })} /></div>
      <div><Label>Projeto</Label>
        <Select value={f.project_id} onValueChange={(v) => setF({ ...f, project_id: v })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>{(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label>Atividade</Label><Textarea value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} /></div>
      <div><Label>Horas</Label><Input type="number" step="0.5" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></div>
      <div><Label>Observações</Label><Textarea value={f.observations} onChange={(e) => setF({ ...f, observations: e.target.value })} /></div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => save("draft")}>Salvar rascunho</Button>
        <Button className="flex-1" onClick={() => save("submitted")}>Enviar</Button>
      </div>
    </Card>
  );
}
