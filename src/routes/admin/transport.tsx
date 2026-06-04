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
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Sparkles } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/admin/transport")({ component: TransportPage });

const STATUS = [
  { v: "solicitado", l: "Solicitado", t: "muted" as const },
  { v: "confirmado", l: "Confirmado", t: "primary" as const },
  { v: "em_transito", l: "Em trânsito", t: "warning" as const },
  { v: "concluido", l: "Concluído", t: "success" as const },
  { v: "cancelado", l: "Cancelado", t: "destructive" as const },
];

const TYPES = [
  { v: "carro", l: "Carro" },
  { v: "van", l: "Van" },
  { v: "voo", l: "Voo" },
  { v: "onibus", l: "Ônibus" },
];

function TransportPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["transport"],
    queryFn: async () => (await supabase.from("transport_requests").select("*, profiles!collaborator_id(full_name), vendors(name)").order("scheduled_at", { ascending: false })).data ?? [],
  });
  const { data: collaborators } = useQuery({ queryKey: ["all-profiles"], queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [] });
  const { data: vendors } = useQuery({ queryKey: ["vendors"], queryFn: async () => (await supabase.from("vendors").select("*").eq("active", true).order("name")).data ?? [] });

  // route optimization detection: same origin/dest within ±2h
  const groups = useMemo(() => {
    const r = rows ?? [];
    const seen = new Map<string, string[]>();
    for (const a of r) {
      for (const b of r) {
        if (a.id === b.id) continue;
        if (a.origin === b.origin && a.destination === b.destination) {
          const diff = Math.abs(new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()) / 3600000;
          if (diff <= 2) {
            const key = [a.id, b.id].sort().join(":");
            if (!seen.has(a.origin + "→" + a.destination)) seen.set(a.origin + "→" + a.destination, []);
            const arr = seen.get(a.origin + "→" + a.destination)!;
            if (!arr.includes(key)) arr.push(key);
          }
        }
      }
    }
    return Array.from(seen.entries()).map(([route, pairs]) => ({ route, count: pairs.length + 1 }));
  }, [rows]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("transport_requests").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transport"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transporte &amp; Rotas</h1>
          <p className="text-sm text-muted-foreground">Solicitações de deslocamento e otimização de rotas.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Nova solicitação</Button></DialogTrigger>
          <NewDialog collaborators={collaborators ?? []} vendors={vendors ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["transport"] }); }} />
        </Dialog>
      </div>

      {groups.length > 0 && (
        <Card className="border-warning/40 bg-warning/10 p-4">
          <div className="flex items-center gap-2 text-warning-foreground"><Sparkles className="h-4 w-4" /><span className="font-medium">Oportunidades de aglutinação</span></div>
          <ul className="mt-2 space-y-1 text-sm">
            {groups.map((g) => <li key={g.route}>{g.route} — {g.count} solicitações em janela de ±2h</li>)}
          </ul>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Quando</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => {
              const opt = STATUS.find((s) => s.v === r.status);
              return (
                <TableRow key={r.id}>
                  <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>{r.origin}</TableCell>
                  <TableCell>{r.destination}</TableCell>
                  <TableCell>{fmtDateTime(r.scheduled_at)}</TableCell>
                  <TableCell className="capitalize">{r.transport_type}</TableCell>
                  <TableCell>{r.vendors?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => updateStatus.mutate({ id: r.id, status: v })}>
                      <SelectTrigger className="w-36"><StatusBadge tone={opt?.t}>{opt?.l}</StatusBadge></SelectTrigger>
                      <SelectContent>{STATUS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
            {(rows ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sem solicitações.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewDialog({ collaborators, vendors, onDone }: { collaborators: any[]; vendors: any[]; onDone: () => void }) {
  const [f, setF] = useState({ collaborator_id: "", origin: "", destination: "", scheduled_at: "", transport_type: "carro", vendor_id: "" });
  const submit = async () => {
    if (!f.collaborator_id || !f.origin || !f.destination || !f.scheduled_at) { toast.error("Preencha os campos obrigatórios"); return; }
    const { error } = await supabase.from("transport_requests").insert({ ...f, vendor_id: f.vendor_id || null, transport_type: f.transport_type as any });
    if (error) toast.error(error.message);
    else { toast.success("Solicitação criada"); onDone(); }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nova solicitação de transporte</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div>
          <Label>Colaborador</Label>
          <Select value={f.collaborator_id} onValueChange={(v) => setF({ ...f, collaborator_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{collaborators.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name || c.email}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Origem</Label><Input value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></div>
          <div><Label>Destino</Label><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Data/hora</Label><Input type="datetime-local" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></div>
          <div>
            <Label>Tipo</Label>
            <Select value={f.transport_type} onValueChange={(v) => setF({ ...f, transport_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Fornecedor</Label>
          <Select value={f.vendor_id} onValueChange={(v) => setF({ ...f, vendor_id: v })}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter><Button onClick={submit}>Salvar</Button></DialogFooter>
    </DialogContent>
  );
}
