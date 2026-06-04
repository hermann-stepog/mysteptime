import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/admin/embarkations")({ component: EmbarkationsPage });

const STATUS_OPTS = [
  { v: "scheduled", l: "Agendado", t: "muted" as const },
  { v: "confirmed", l: "Confirmado", t: "primary" as const },
  { v: "boarded", l: "Embarcado", t: "success" as const },
  { v: "disembarked", l: "Desembarcado", t: "muted" as const },
  { v: "cancelled", l: "Cancelado", t: "destructive" as const },
  { v: "transferred", l: "Transferido", t: "warning" as const },
];

function EmbarkationsPage() {
  const qc = useQueryClient();
  const [filterClient, setFilterClient] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [open, setOpen] = useState(false);

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: async () => (await supabase.from("clients").select("*").eq("active", true).order("name")).data ?? [] });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: async () => (await supabase.from("projects").select("*").eq("active", true)).data ?? [] });
  const { data: collaborators } = useQuery({ queryKey: ["collabs"], queryFn: async () => {
    const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "collaborator");
    const ids = (roles ?? []).map((r) => r.user_id);
    if (!ids.length) return [];
    return (await supabase.from("profiles").select("id, full_name, email").in("id", ids)).data ?? [];
  }});

  const { data: rows } = useQuery({
    queryKey: ["embarkations", filterClient, filterStatus],
    queryFn: async () => {
      let q = supabase.from("embarkations").select("*, profiles!collaborator_id(full_name), clients(name), projects(code, name)").order("embark_date", { ascending: false });
      if (filterClient !== "all") q = q.eq("client_id", filterClient);
      if (filterStatus !== "all") q = q.eq("status", filterStatus as any);
      return (await q).data ?? [];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("embarkations").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["embarkations"] }); toast.success("Status atualizado"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Embarques</h1>
          <p className="text-sm text-muted-foreground">Gerencie ciclos de embarque e desembarque.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo embarque</Button></DialogTrigger>
          <NewEmbarkDialog clients={clients ?? []} projects={projects ?? []} collaborators={collaborators ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["embarkations"] }); }} />
        </Dialog>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <div className="min-w-40">
            <Label className="text-xs">Cliente</Label>
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-40">
            <Label className="text-xs">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {STATUS_OPTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Projeto</TableHead>
              <TableHead>Embarque</TableHead>
              <TableHead>Desembarque</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Atualizar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => {
              const opt = STATUS_OPTS.find((s) => s.v === r.status);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>{r.clients?.name ?? "—"}</TableCell>
                  <TableCell>{r.projects ? `${r.projects.code} — ${r.projects.name}` : "—"}</TableCell>
                  <TableCell>{fmtDate(r.embark_date)}</TableCell>
                  <TableCell>{fmtDate(r.disembark_date)}</TableCell>
                  <TableCell><StatusBadge tone={opt?.t}>{opt?.l ?? r.status}</StatusBadge></TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => updateStatus.mutate({ id: r.id, status: v })}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUS_OPTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
            {(rows ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum embarque cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewEmbarkDialog({ clients, projects, collaborators, onDone }: { clients: any[]; projects: any[]; collaborators: any[]; onDone: () => void }) {
  const [collaboratorId, setCollaboratorId] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [embarkDate, setEmbarkDate] = useState("");
  const [disembarkDate, setDisembarkDate] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async () => {
    if (!collaboratorId || !embarkDate) { toast.error("Colaborador e data de embarque obrigatórios"); return; }
    const { error } = await supabase.from("embarkations").insert({
      collaborator_id: collaboratorId,
      client_id: clientId || null,
      project_id: projectId || null,
      embark_date: embarkDate,
      disembark_date: disembarkDate || null,
      notes: notes || null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Embarque criado"); onDone(); }
  };

  const filteredProjects = projects.filter((p) => !clientId || p.client_id === clientId);

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Novo embarque</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div>
          <Label>Colaborador</Label>
          <Select value={collaboratorId} onValueChange={setCollaboratorId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{collaborators.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name || c.email}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Projeto</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{filteredProjects.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Data embarque</Label><Input type="date" value={embarkDate} onChange={(e) => setEmbarkDate(e.target.value)} /></div>
          <div><Label>Data desembarque</Label><Input type="date" value={disembarkDate} onChange={(e) => setDisembarkDate(e.target.value)} /></div>
        </div>
        <div><Label>Observações</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <DialogFooter><Button onClick={submit}>Criar</Button></DialogFooter>
    </DialogContent>
  );
}
