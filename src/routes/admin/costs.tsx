import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney, downloadCSV } from "@/lib/format";
import { notify } from "@/lib/notify";
import { Plus, DollarSign } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { EmptyStateRow } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/admin/costs")({ head: () => pageTitle("Custos"), component: CostsPage });

const COST_TYPES = [
  { v: "transporte_pessoal", l: "Transporte de Pessoal" },
  { v: "passagem_aerea", l: "Passagem Aérea" },
  { v: "hospedagem", l: "Hospedagem" },
  { v: "pre_embarque", l: "Pré-embarque" },
  { v: "embarque_cancelado", l: "Embarque Cancelado" },
  { v: "embarque_transferido", l: "Embarque Transferido" },
  { v: "servico_externo", l: "Serviço Externo" },
  { v: "demandas_diversas", l: "Demandas Diversas" },
];

// Exportação de custos — usada pelo módulo de Relatórios (card "Custos"). Exporta tudo,
// sem respeitar os filtros de tela (que só valem enquanto a página de Custos está aberta).
export async function generateRelatorioCustos(dataInicio?: string, dataFim?: string): Promise<void> {
  let query = supabase
    .from("cost_logs")
    .select("*, profiles!collaborator_id(full_name), clients(name), vendors(name), projects(code)")
    .order("created_at", { ascending: false });
  if (dataInicio) query = query.gte("created_at", dataInicio);
  if (dataFim) query = query.lte("created_at", `${dataFim}T23:59:59`);
  const { data: rows, error } = await query;
  if (error) throw error;
  const out = (rows ?? []).map((r: any) => ({
    colaborador: r.profiles?.full_name, cliente: r.clients?.name, projeto: r.projects?.code,
    tipo: COST_TYPES.find((c) => c.v === r.cost_type)?.l, fornecedor: r.vendors?.name,
    valor: r.amount, periodo_inicio: r.period_start, periodo_fim: r.period_end, cobranca: r.billing,
  }));
  downloadCSV(`custos_${new Date().toISOString().slice(0, 10)}.csv`, out);
}

function CostsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filterClient, setFilterClient] = useState("all");
  const [filterType, setFilterType] = useState("all");

  const { data: rows } = useQuery({
    queryKey: ["costs", filterClient, filterType],
    queryFn: async () => {
      let q = supabase.from("cost_logs").select("*, profiles!collaborator_id(full_name), clients(name), vendors(name), projects(code)").order("created_at", { ascending: false });
      if (filterClient !== "all") q = q.eq("client_id", filterClient);
      if (filterType !== "all") q = q.eq("cost_type", filterType as any);
      return (await q).data ?? [];
    },
  });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: async () => (await supabase.from("clients").select("*").eq("active", true)).data ?? [] });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: async () => (await supabase.from("projects").select("*").eq("active", true)).data ?? [] });
  const { data: vendors } = useQuery({ queryKey: ["vendors"], queryFn: async () => (await supabase.from("vendors").select("*").eq("active", true)).data ?? [] });
  const { data: collaborators } = useQuery({ queryKey: ["all-profiles"], queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [] });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Custos (Lançamentos)</h1></div>
        <div className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo lançamento</Button></DialogTrigger>
            <NewDialog clients={clients ?? []} projects={projects ?? []} vendors={vendors ?? []} collaborators={collaborators ?? []} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["costs"] }); }} />
          </Dialog>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3">
        <div className="min-w-40">
          <Label className="text-xs">Cliente</Label>
          <Select value={filterClient} onValueChange={setFilterClient}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem>{(clients ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-48">
          <Label className="text-xs">Tipo</Label>
          <Select value={filterType} onValueChange={setFilterType}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos</SelectItem>{COST_TYPES.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Colaborador</TableHead><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead><TableHead>Fornecedor</TableHead><TableHead>Período</TableHead><TableHead>Cobrança</TableHead><TableHead className="text-right">Valor</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(rows ?? []).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{r.profiles?.full_name ?? "—"}</TableCell>
                <TableCell>{r.clients?.name ?? "—"}</TableCell>
                <TableCell>{COST_TYPES.find((c) => c.v === r.cost_type)?.l}</TableCell>
                <TableCell>{r.vendors?.name ?? "—"}</TableCell>
                <TableCell className="text-xs">{r.period_start ? `${fmtDate(r.period_start)} → ${fmtDate(r.period_end)}` : "—"}</TableCell>
                <TableCell>{r.billing === "com_cobranca" ? "C/ Cobrança" : "S/ Cobrança"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(r.amount)}</TableCell>
              </TableRow>
            ))}
            {(rows ?? []).length === 0 && <EmptyStateRow colSpan={7} icon={DollarSign} title="Sem lançamentos" />}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function NewDialog({ clients, projects, vendors, collaborators, onDone }: { clients: any[]; projects: any[]; vendors: any[]; collaborators: any[]; onDone: () => void }) {
  const { user } = useAuth();
  const [f, setF] = useState<any>({ collaborator_id: "", client_id: "", project_id: "", cost_type: "", vendor_id: "", amount: "", period_start: "", period_end: "", billing: "com_cobranca", notes: "" });
  const periodRequired = ["hospedagem", "passagem_aerea"].includes(f.cost_type);
  const isCancel = ["embarque_cancelado", "embarque_transferido"].includes(f.cost_type);

  const submit = async () => {
    if (!f.collaborator_id || !f.client_id || !f.cost_type || !f.vendor_id) { notify.error("Preencha os campos obrigatórios"); return; }
    if (!isCancel && Number(f.amount) <= 0) { notify.error("Valor obrigatório"); return; }
    if (periodRequired && (!f.period_start || !f.period_end)) { notify.error("Período obrigatório para hospedagem/passagens"); return; }
    const { error } = await supabase.from("cost_logs").insert({
      collaborator_id: f.collaborator_id, client_id: f.client_id, project_id: f.project_id || null,
      cost_type: f.cost_type, vendor_id: f.vendor_id, amount: Number(f.amount) || 0,
      period_start: f.period_start || null, period_end: f.period_end || null,
      billing: f.billing, notes: f.notes || null, created_by: user?.id,
    });
    if (error) notify.error(error.message); else { notify.success("Lançado"); onDone(); }
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Novo lançamento de custo</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Colaborador</Label>
          <Select value={f.collaborator_id} onValueChange={(v) => setF({ ...f, collaborator_id: v })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{collaborators.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name || c.email}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Cliente</Label>
          <Select value={f.client_id} onValueChange={(v) => setF({ ...f, client_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Projeto</Label>
          <Select value={f.project_id} onValueChange={(v) => setF({ ...f, project_id: v })}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{projects.filter((p) => !f.client_id || p.client_id === f.client_id).map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Tipo</Label>
          <Select value={f.cost_type} onValueChange={(v) => setF({ ...f, cost_type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COST_TYPES.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Fornecedor</Label>
          <Select value={f.vendor_id} onValueChange={(v) => setF({ ...f, vendor_id: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select>
        </div>
        <div><Label>Valor</Label><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div><Label>Cobrança</Label>
          <Select value={f.billing} onValueChange={(v) => setF({ ...f, billing: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="com_cobranca">C/ Cobrança</SelectItem><SelectItem value="sem_cobranca">S/ Cobrança</SelectItem></SelectContent></Select>
        </div>
        <div><Label>Período início{periodRequired ? " *" : ""}</Label><Input type="date" value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} /></div>
        <div><Label>Período fim{periodRequired ? " *" : ""}</Label><Input type="date" value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} /></div>
        <div className="col-span-2"><Label>Observações</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <DialogFooter><Button onClick={submit}>Salvar</Button></DialogFooter>
    </DialogContent>
  );
}
