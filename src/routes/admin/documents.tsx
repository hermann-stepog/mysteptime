import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, docStatus } from "@/lib/format";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/admin/documents")({ component: DocControl });

function DocControl() {
  const qc = useQueryClient();
  const [filterAlert, setFilterAlert] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifMsg, setNotifMsg] = useState("Renove seus documentos pendentes.");

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles-docs"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email, embarkation_blocked")).data ?? [],
  });
  const { data: docs } = useQuery({
    queryKey: ["all-docs"],
    queryFn: async () => (await supabase.from("documents").select("*").order("expires_at")).data ?? [],
  });

  const toggleBlock = useMutation({
    mutationFn: async ({ id, blocked }: { id: string; blocked: boolean }) => {
      const { error } = await supabase.from("profiles").update({ embarkation_blocked: blocked }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all-profiles-docs"] }); toast.success("Status atualizado"); },
  });

  const sendNotifs = async () => {
    if (selected.size === 0) { toast.error("Selecione ao menos um colaborador"); return; }
    const inserts = Array.from(selected).map((uid) => ({ user_id: uid, title: "Documentos pendentes", body: notifMsg }));
    const { error } = await supabase.from("notifications").insert(inserts);
    if (error) toast.error(error.message); else { toast.success(`${selected.size} notificação(ões) enviada(s)`); setSelected(new Set()); }
  };

  const docsBy = (uid: string) => (docs ?? []).filter((d) => d.collaborator_id === uid);
  const collabStatus = (uid: string) => {
    const ds = docsBy(uid);
    if (!ds.length) return { tone: "muted" as const, label: "Sem docs" };
    const statuses = ds.map((d) => docStatus(d.expires_at));
    if (statuses.includes("expired")) return { tone: "destructive" as const, label: "Vencido" };
    if (statuses.includes("expiring")) return { tone: "warning" as const, label: "Atenção" };
    return { tone: "success" as const, label: "Em dia" };
  };

  const filtered = (profiles ?? []).filter((p) => {
    if (!filterAlert) return true;
    const s = collabStatus(p.id);
    return s.tone === "destructive" || s.tone === "warning";
  });

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Controle de documentos</h1></div>

      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2"><Checkbox checked={filterAlert} onCheckedChange={(v) => setFilterAlert(!!v)} /><Label>Somente vencidos/expirando</Label></div>
        <div className="flex-1 min-w-60"><Label>Mensagem da notificação</Label><Input value={notifMsg} onChange={(e) => setNotifMsg(e.target.value)} /></div>
        <Button onClick={sendNotifs}><Bell className="mr-2 h-4 w-4" />Notificar selecionados ({selected.size})</Button>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Colaborador</TableHead><TableHead>Status</TableHead><TableHead>Documentos</TableHead><TableHead>Bloquear embarque</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const st = collabStatus(p.id);
              return (
                <TableRow key={p.id}>
                  <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => { const n = new Set(selected); v ? n.add(p.id) : n.delete(p.id); setSelected(n); }} /></TableCell>
                  <TableCell className="font-medium">{p.full_name || p.email}</TableCell>
                  <TableCell><StatusBadge tone={st.tone}>{st.label}</StatusBadge></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {docsBy(p.id).map((d) => {
                        const s = docStatus(d.expires_at);
                        const tone = s === "expired" ? "destructive" : s === "expiring" ? "warning" : "success";
                        return <StatusBadge key={d.id} tone={tone}>{d.doc_type}: {fmtDate(d.expires_at)}</StatusBadge>;
                      })}
                      {docsBy(p.id).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell><Switch checked={p.embarkation_blocked} onCheckedChange={(v) => toggleBlock.mutate({ id: p.id, blocked: v })} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
