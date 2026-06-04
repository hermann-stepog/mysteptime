import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/app/timesheet")({ component: TS });

const ACTIVITY = ["Operação", "Manutenção", "Standby", "Treinamento", "Deslocamento"];

function TS() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["my-ts"],
    queryFn: async () => (await supabase.from("timesheets").select("*, projects(code)").eq("collaborator_id", user!.id).order("work_date", { ascending: false }).limit(60)).data ?? [],
  });

  const accumulated = useMemo(() => (rows ?? []).reduce((s, r) => s + Number(r.hours), 0), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Time Sheet</h1>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />Novo</Button>
      </div>

      <Card className="p-4 bg-primary text-primary-foreground">
        <div className="text-xs uppercase tracking-wider opacity-80">Horas acumuladas no ciclo</div>
        <div className="mt-1 text-3xl font-semibold">{accumulated.toFixed(1)}h</div>
      </Card>

      {creating && <NewTS onClose={() => { setCreating(false); qc.invalidateQueries({ queryKey: ["my-ts"] }); }} />}

      <div className="space-y-2">
        {(rows ?? []).map((r: any) => (
          <Card key={r.id} className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{fmtDate(r.work_date)}</div>
              <div className="text-xs text-muted-foreground">{r.projects?.code ?? "—"} · {r.activity_type}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">{r.hours}h</div>
              <StatusBadge tone={r.status === "approved" ? "success" : r.status === "submitted" ? "primary" : r.status === "rejected" ? "destructive" : "muted"}>
                {r.status === "draft" ? "Rascunho" : r.status === "submitted" ? "Enviado" : r.status === "approved" ? "Aprovado" : "Rejeitado"}
              </StatusBadge>
            </div>
          </Card>
        ))}
        {(rows ?? []).length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum registro.</Card>}
      </div>
    </div>
  );
}

function NewTS({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: async () => (await supabase.from("projects").select("*").eq("active", true)).data ?? [] });
  const [f, setF] = useState({ work_date: new Date().toISOString().slice(0, 10), project_id: "", activity_type: ACTIVITY[0], hours: "8" });

  const save = async (status: "draft" | "submitted") => {
    const { error } = await supabase.from("timesheets").insert({
      collaborator_id: user!.id, work_date: f.work_date, project_id: f.project_id || null,
      activity_type: f.activity_type, hours: Number(f.hours) || 0, status,
    });
    if (error) toast.error(error.message); else { toast.success("Salvo"); onClose(); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div><Label>Data</Label><Input type="date" value={f.work_date} onChange={(e) => setF({ ...f, work_date: e.target.value })} /></div>
      <div><Label>Projeto</Label>
        <Select value={f.project_id} onValueChange={(v) => setF({ ...f, project_id: v })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>{(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label>Atividade</Label>
        <Select value={f.activity_type} onValueChange={(v) => setF({ ...f, activity_type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{ACTIVITY.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label>Horas</Label><Input type="number" step="0.5" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => save("draft")}>Rascunho</Button>
        <Button className="flex-1" onClick={() => save("submitted")}>Enviar</Button>
      </div>
    </Card>
  );
}
