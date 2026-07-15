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
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDateTime } from "@/lib/format";
import { notify } from "@/lib/notify";
import { Plus, Check, X, Inbox } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyStateRow } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/approvals")({ head: () => pageTitle("Aprovações"), component: ApprovalsPage });

function ApprovalsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});

  const { data: rows } = useQuery({
    queryKey: ["approvals"],
    queryFn: async () => (await supabase.from("approval_requests").select("*, approvers(full_name, role_title), profiles!collaborator_id(full_name)").order("created_at", { ascending: false })).data ?? [],
  });
  const { data: approvers } = useQuery({ queryKey: ["approvers-active"], queryFn: async () => (await supabase.from("approvers").select("*").eq("active", true).order("full_name")).data ?? [] });
  const { data: collaborators } = useQuery({ queryKey: ["all-profiles"], queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [] });

  const decide = useMutation({
    mutationFn: async ({ id, approve, comment }: { id: string; approve: boolean; comment?: string }) => {
      const { error } = await supabase.from("approval_requests").update({
        status: approve ? "approved" : "rejected", comment: comment ?? null, decided_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["approvals"] }); notify.success("Decisão registrada"); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Aprovações</h1><p className="text-sm text-muted-foreground">Hora extra / MO sem folga indenizada</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Nova solicitação</Button></DialogTrigger>
          <NewDialog approvers={approvers ?? []} collaborators={collaborators ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["approvals"] }); }} />
        </Dialog>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tipo</TableHead><TableHead>Colaborador</TableHead><TableHead>Aprovador</TableHead><TableHead>Status</TableHead><TableHead>Criado</TableHead><TableHead>Comentário</TableHead><TableHead className="text-right">Ações</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.request_type}</TableCell>
                <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                <TableCell>{r.approvers?.full_name} — {r.approvers?.role_title}</TableCell>
                <TableCell><StatusBadge tone={r.status === "approved" ? "success" : r.status === "rejected" ? "destructive" : "warning"}>{r.status}</StatusBadge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.created_at)}</TableCell>
                <TableCell>
                  {r.status === "pending" ? (
                    <Textarea rows={1} value={comments[r.id] ?? ""} onChange={(e) => setComments({ ...comments, [r.id]: e.target.value })} placeholder="Comentário" />
                  ) : <span className="text-xs text-muted-foreground">{r.comment ?? "—"}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "pending" && (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide.mutate({ id: r.id, approve: false, comment: comments[r.id] })}
                        loading={decide.isPending && decide.variables?.id === r.id && decide.variables.approve === false}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => decide.mutate({ id: r.id, approve: true, comment: comments[r.id] })}
                        loading={decide.isPending && decide.variables?.id === r.id && decide.variables.approve === true}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && <EmptyStateRow colSpan={7} icon={Inbox} title="Nenhuma solicitação" description="Não há aprovações pendentes no momento." />}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewDialog({ approvers, collaborators, onDone }: { approvers: any[]; collaborators: any[]; onDone: () => void }) {
  const { user } = useAuth();
  const [f, setF] = useState({ request_type: "Hora extra", approver_id: "", collaborator_id: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!f.approver_id) { notify.error("Selecione um aprovador"); return; }
    setSubmitting(true);
    const { error } = await supabase.from("approval_requests").insert({
      request_type: f.request_type, approver_id: f.approver_id, requested_by: user!.id,
      collaborator_id: f.collaborator_id || null, payload: { notes: f.notes },
    });
    setSubmitting(false);
    if (error) notify.error(error.message); else { notify.success("Solicitação criada"); onDone(); }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nova solicitação de aprovação</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div><Label>Tipo</Label>
          <Select value={f.request_type} onValueChange={(v) => setF({ ...f, request_type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Hora extra">Hora extra</SelectItem>
              <SelectItem value="MO sem folga indenizada">MO sem folga indenizada</SelectItem>
              <SelectItem value="Liberação bloqueio embarque">Liberação bloqueio embarque</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Aprovador</Label>
          <Select value={f.approver_id} onValueChange={(v) => setF({ ...f, approver_id: v })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{approvers.map((a) => <SelectItem key={a.id} value={a.id}>{a.full_name} — {a.role_title}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Colaborador (opcional)</Label>
          <Select value={f.collaborator_id} onValueChange={(v) => setF({ ...f, collaborator_id: v })}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{collaborators.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name || c.email}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Detalhes</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <DialogFooter><Button onClick={submit} loading={submitting}>Criar</Button></DialogFooter>
    </DialogContent>
  );
}
