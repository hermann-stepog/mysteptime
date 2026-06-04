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
import { fmtDate } from "@/lib/format";
import { toast } from "sonner";
import { Plus, AlertTriangle } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/admin/hotel")({ component: HotelPage });

function HotelPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: rows } = useQuery({
    queryKey: ["hotels"],
    queryFn: async () => (await supabase.from("hotel_bookings").select("*, profiles!collaborator_id(full_name), vendors(name)").order("check_in", { ascending: false })).data ?? [],
  });
  const { data: collaborators } = useQuery({ queryKey: ["all-profiles"], queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [] });
  const { data: vendors } = useQuery({ queryKey: ["vendors"], queryFn: async () => (await supabase.from("vendors").select("*").eq("active", true)).data ?? [] });

  const alerts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows ?? []) {
      const month = (r.check_in as string).slice(0, 7);
      const key = `${r.collaborator_id}:${month}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).filter(([, c]) => c >= 2).map(([k]) => k);
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Hospedagem &amp; Pré-embarque</h1></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Nova reserva</Button></DialogTrigger>
          <NewDialog collaborators={collaborators ?? []} vendors={vendors ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["hotels"] }); }} />
        </Dialog>
      </div>

      {alerts.length > 0 && (
        <Card className="border-warning/40 bg-warning/10 p-4">
          <div className="flex items-center gap-2 text-warning-foreground"><AlertTriangle className="h-4 w-4" /><span className="font-medium">{alerts.length} colaborador(es) com 2+ pré-embarques no mesmo mês.</span></div>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Colaborador</TableHead><TableHead>Hotel</TableHead><TableHead>Check-in</TableHead><TableHead>Check-out</TableHead><TableHead>Fornecedor</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                <TableCell>{r.hotel_name}</TableCell>
                <TableCell>{fmtDate(r.check_in)}</TableCell>
                <TableCell>{fmtDate(r.check_out)}</TableCell>
                <TableCell>{r.vendors?.name ?? "—"}</TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sem reservas.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewDialog({ collaborators, vendors, onDone }: { collaborators: any[]; vendors: any[]; onDone: () => void }) {
  const [f, setF] = useState({ collaborator_id: "", hotel_name: "", check_in: "", check_out: "", vendor_id: "" });
  const submit = async () => {
    if (!f.collaborator_id || !f.hotel_name || !f.check_in || !f.check_out) { toast.error("Preencha os campos obrigatórios"); return; }
    const { error } = await supabase.from("hotel_bookings").insert({ ...f, vendor_id: f.vendor_id || null });
    if (error) toast.error(error.message); else { toast.success("Reserva criada"); onDone(); }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Nova reserva de hotel</DialogTitle></DialogHeader>
      <div className="grid gap-3">
        <div>
          <Label>Colaborador</Label>
          <Select value={f.collaborator_id} onValueChange={(v) => setF({ ...f, collaborator_id: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{collaborators.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name || c.email}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Hotel</Label><Input value={f.hotel_name} onChange={(e) => setF({ ...f, hotel_name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Check-in</Label><Input type="date" value={f.check_in} onChange={(e) => setF({ ...f, check_in: e.target.value })} /></div>
          <div><Label>Check-out</Label><Input type="date" value={f.check_out} onChange={(e) => setF({ ...f, check_out: e.target.value })} /></div>
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
