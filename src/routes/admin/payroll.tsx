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
import { fmtDate, downloadCSV } from "@/lib/format";
import { notify } from "@/lib/notify";
import { Plus, FileText } from "lucide-react";
import { useState } from "react";
import { EmptyStateRow } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/payroll")({ head: () => pageTitle("Folha de Pagamento"), component: PayrollPage });

// Exportação da folha — usada pelo módulo de Relatórios (card "Folha de Pagamento").
export async function generateFolhaPagamento(): Promise<void> {
  const { data: rows, error } = await supabase
    .from("payroll_summaries")
    .select("*, profiles!collaborator_id(full_name, email)")
    .order("cycle_end", { ascending: false });
  if (error) throw error;
  const out = (rows ?? []).map((r: any) => ({
    colaborador: r.profiles?.full_name, email: r.profiles?.email,
    ciclo_inicio: r.cycle_start, ciclo_fim: r.cycle_end,
    dias_onboard: r.days_onboard, horas_total: r.total_hours, horas_extra: r.overtime_hours,
    sobreaviso_dias: r.sobreaviso_days, status: r.status, enviado: r.sent_at, confirmado: r.confirmed_at,
    exportado_em: new Date().toISOString(),
  }));
  downloadCSV(`folha_${new Date().toISOString().slice(0, 10)}.csv`, out);
}

const STATUS = [
  { v: "pendente", l: "Pendente", t: "warning" as const },
  { v: "enviado_dp", l: "Enviado ao DP", t: "primary" as const },
  { v: "confirmado_dp", l: "Confirmado", t: "success" as const },
];

function PayrollPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: rows } = useQuery({
    queryKey: ["payroll"],
    queryFn: async () => (await supabase.from("payroll_summaries").select("*, profiles!collaborator_id(full_name, email)").order("cycle_end", { ascending: false })).data ?? [],
  });
  const { data: collaborators } = useQuery({ queryKey: ["all-profiles"], queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [] });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === "enviado_dp") updates.sent_at = new Date().toISOString();
      if (status === "confirmado_dp") updates.confirmed_at = new Date().toISOString();
      const { error } = await supabase.from("payroll_summaries").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold">Comunicação à folha</h1></div>
        <div className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo resumo</Button></DialogTrigger>
            <NewDialog collaborators={collaborators ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["payroll"] }); }} />
          </Dialog>
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Colaborador</TableHead><TableHead>Ciclo</TableHead><TableHead>Dias</TableHead><TableHead>Horas</TableHead><TableHead>Extra</TableHead><TableHead>Sobreaviso</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => {
              const opt = STATUS.find((s) => s.v === r.status);
              return (
                <TableRow key={r.id}>
                  <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                  <TableCell>{fmtDate(r.cycle_start)} → {fmtDate(r.cycle_end)}</TableCell>
                  <TableCell>{r.days_onboard}</TableCell>
                  <TableCell>{r.total_hours}</TableCell>
                  <TableCell>{r.overtime_hours}</TableCell>
                  <TableCell>{r.sobreaviso_days}</TableCell>
                  <TableCell>
                    <Select value={r.status} onValueChange={(v) => setStatus.mutate({ id: r.id, status: v })}>
                      <SelectTrigger className="w-40"><StatusBadge tone={opt?.t}>{opt?.l}</StatusBadge></SelectTrigger>
                      <SelectContent>{STATUS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
            {(rows ?? []).length === 0 && <EmptyStateRow colSpan={7} icon={FileText} title="Sem resumos" />}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewDialog({ collaborators, onDone }: { collaborators: any[]; onDone: () => void }) {
  const [f, setF] = useState({ collaborator_id: "", cycle_start: "", cycle_end: "", days_onboard: "0", total_hours: "0", overtime_hours: "0", sobreaviso_days: "0" });
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!f.collaborator_id || !f.cycle_start || !f.cycle_end) { notify.error("Preencha os campos"); return; }
    setSubmitting(true);
    const { error } = await supabase.from("payroll_summaries").insert({
      collaborator_id: f.collaborator_id, cycle_start: f.cycle_start, cycle_end: f.cycle_end,
      days_onboard: Number(f.days_onboard), total_hours: Number(f.total_hours),
      overtime_hours: Number(f.overtime_hours), sobreaviso_days: Number(f.sobreaviso_days),
    });
    setSubmitting(false);
    if (error) notify.error(error.message); else { notify.success("Resumo criado"); onDone(); }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Novo resumo de folha</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Colaborador</Label>
          <Select value={f.collaborator_id} onValueChange={(v) => setF({ ...f, collaborator_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{collaborators.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name || c.email}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Início</Label><Input type="date" value={f.cycle_start} onChange={(e) => setF({ ...f, cycle_start: e.target.value })} /></div>
        <div><Label>Fim</Label><Input type="date" value={f.cycle_end} onChange={(e) => setF({ ...f, cycle_end: e.target.value })} /></div>
        <div><Label>Dias onboard</Label><Input type="number" value={f.days_onboard} onChange={(e) => setF({ ...f, days_onboard: e.target.value })} /></div>
        <div><Label>Horas totais</Label><Input type="number" step="0.5" value={f.total_hours} onChange={(e) => setF({ ...f, total_hours: e.target.value })} /></div>
        <div><Label>Horas extra</Label><Input type="number" step="0.5" value={f.overtime_hours} onChange={(e) => setF({ ...f, overtime_hours: e.target.value })} /></div>
        <div><Label>Sobreaviso (dias)</Label><Input type="number" value={f.sobreaviso_days} onChange={(e) => setF({ ...f, sobreaviso_days: e.target.value })} /></div>
      </div>
      <DialogFooter><Button onClick={submit} loading={submitting}>Salvar</Button></DialogFooter>
    </DialogContent>
  );
}
