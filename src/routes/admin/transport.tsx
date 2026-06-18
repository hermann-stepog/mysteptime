import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Download, ChevronLeft, ChevronRight, Calendar as CalIcon, ArrowRight, Users as UsersIcon, Package } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { CollaboratorMultiSelect, useCollaboratorsQuery, type Collaborator } from "@/components/CollaboratorSelect";
import { MaterialQuantitySelect, useMaterialsQuery, type Material, type MaterialQty } from "@/components/MaterialMultiSelect";
import { TagMultiSelect, useTagsQuery, type Tag } from "@/components/TagMultiSelect";
import { CLIENTES } from "@/lib/clientes";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type TripStatus = "em_andamento" | "realizado" | "cancelado";
type TripTipo = "pessoas" | "material";

type TransportSearch = { tab?: string; tag?: string; status?: string; cliente?: string; tipo?: string };

export const Route = createFileRoute("/admin/transport")({
  component: TransportPage,
  validateSearch: (s: Record<string, unknown>): TransportSearch => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
    tag: typeof s.tag === "string" ? s.tag : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
    cliente: typeof s.cliente === "string" ? s.cliente : undefined,
    tipo: typeof s.tipo === "string" ? s.tipo : undefined,
  }),
});

type Column = { id: string; name: string; position: number };
type Trip = {
  id: string;
  car_number: string;
  column_id: string | null;
  scheduled_at: string;
  origin: string;
  destination: string;
  notes: string | null;
  tipo: TripTipo;
  bsp: string | null;
  cliente: string | null;
  status: TripStatus;
  tags: { tag_id: string }[];
  collabs: { collaborator_id: string }[];
  materials: { material_id: string; quantidade: number | null }[];
};

const STATUS_LABEL: Record<TripStatus, string> = { em_andamento: "Em Andamento", realizado: "Realizado", cancelado: "Cancelado" };
const STATUS_BADGE: Record<TripStatus, string> = {
  em_andamento: "bg-primary/15 text-primary border-primary/30",
  realizado: "bg-success/15 text-success border-success/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};
const STATUS_BORDER: Record<TripStatus, string> = {
  em_andamento: "border-l-primary",
  realizado: "border-l-success",
  cancelado: "border-l-destructive",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function useTransportData() {
  const columns = useQuery({
    queryKey: ["transport_columns"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transport_columns").select("*").order("position");
      if (error) throw error;
      return (data ?? []) as Column[];
    },
  });
  const trips = useQuery({
    queryKey: ["transport_trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_trips")
        .select("*, tags:transport_trip_tags(tag_id), collabs:transport_trip_collaborators(collaborator_id), materials:transport_trip_materials(material_id, quantidade)")
        .order("scheduled_at");
      if (error) throw error;
      return (data ?? []) as Trip[];
    },
  });
  return { columns, trips };
}

function StatusBadge({ status }: { status: TripStatus }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[status])}>{STATUS_LABEL[status]}</span>;
}

function TripCard({ trip, tagsById, collabsById, materialsById, onClick, onStatus }: {
  trip: Trip;
  tagsById: Map<string, Tag>;
  collabsById: Map<string, Collaborator>;
  materialsById: Map<string, Material>;
  onClick: () => void;
  onStatus: (s: TripStatus) => void;
}) {
  return (
    <Card className={cn("cursor-pointer p-3 hover:border-primary/40 transition border-l-4", STATUS_BORDER[trip.status])} onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="font-semibold">{trip.car_number}</div>
          {trip.tipo === "material" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"><Package className="h-3 w-3" />Material</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"><UsersIcon className="h-3 w-3" />Pessoas</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{fmtTime(trip.scheduled_at)}</div>
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {trip.tags.map((t) => {
          const tag = tagsById.get(t.tag_id);
          if (!tag) return null;
          return <span key={t.tag_id} className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>;
        })}
        {trip.cliente && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">{trip.cliente}</span>}
      </div>

      {trip.bsp && (
        <div className="mt-2 inline-flex items-center rounded-md border border-warning/40 bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
          BSP: {trip.bsp}
        </div>
      )}

      <div className="mt-2 text-sm">
        <span className="text-muted-foreground">{trip.origin}</span>
        <ArrowRight className="inline mx-1 h-3 w-3 text-muted-foreground" />
        <span>{trip.destination}</span>
      </div>

      {trip.tipo === "pessoas" && trip.collabs.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground truncate">
          {trip.collabs.map((c) => collabsById.get(c.collaborator_id)?.full_name).filter(Boolean).join(", ")}
        </div>
      )}
      {trip.tipo === "material" && trip.materials.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground truncate">
          {trip.materials.map((m) => { const mat = materialsById.get(m.material_id); return mat ? `${mat.descricao} ×${m.quantidade ?? 1}` : null; }).filter(Boolean).join(", ")}
        </div>
      )}

      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Select value={trip.status} onValueChange={(v) => onStatus(v as TripStatus)}>
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="realizado">Realizado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function TripDialog({ trip, columns, open, onOpenChange }: { trip: Trip | null; columns: Column[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  type FormState = {
    id?: string; car_number: string; column_id: string; scheduled_at: string;
    origin: string; destination: string; notes: string;
    tipo: TripTipo; bsp: string; cliente: string; status: TripStatus;
    tag_ids: string[]; collab_ids: string[]; materials: MaterialQty[];
  };
  const init = (t: Trip | null, cols: Column[]): FormState => {
    if (t) return {
      id: t.id, car_number: t.car_number, column_id: t.column_id ?? (cols[0]?.id ?? ""),
      scheduled_at: new Date(t.scheduled_at).toISOString().slice(0, 16),
      origin: t.origin, destination: t.destination, notes: t.notes ?? "",
      tipo: t.tipo, bsp: t.bsp ?? "", cliente: t.cliente ?? "", status: t.status,
      tag_ids: t.tags.map((x) => x.tag_id),
      collab_ids: t.collabs.map((x) => x.collaborator_id),
      materials: t.materials.map((x) => ({ material_id: x.material_id, quantidade: x.quantidade ?? 1 })),
    };
    return {
      car_number: "", column_id: cols[0]?.id ?? "", scheduled_at: new Date().toISOString().slice(0, 16),
      origin: "", destination: "", notes: "",
      tipo: "pessoas", bsp: "", cliente: "", status: "em_andamento",
      tag_ids: [], collab_ids: [], materials: [],
    };
  };
  const [f, setF] = useState<FormState>(() => init(trip, columns));
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (open && openedFor !== (trip?.id ?? "new")) {
    setF(init(trip, columns));
    setOpenedFor(trip?.id ?? "new");
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        car_number: f.car_number.trim(), column_id: f.column_id || null,
        scheduled_at: new Date(f.scheduled_at).toISOString(),
        origin: f.origin.trim(), destination: f.destination.trim(),
        notes: f.notes.trim() || null,
        tipo: f.tipo, bsp: f.bsp.trim() || null, cliente: f.cliente || null,
        status: f.status,
        realizado: f.status === "realizado", cancelado: f.status === "cancelado",
      };
      let id = f.id;
      if (id) {
        const { error } = await supabase.from("transport_trips").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("transport_trips").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      await supabase.from("transport_trip_tags").delete().eq("trip_id", id);
      if (f.tag_ids.length) await supabase.from("transport_trip_tags").insert(f.tag_ids.map((tag_id) => ({ trip_id: id!, tag_id })));
      await supabase.from("transport_trip_collaborators").delete().eq("trip_id", id);
      if (f.tipo === "pessoas" && f.collab_ids.length) await supabase.from("transport_trip_collaborators").insert(f.collab_ids.map((cid) => ({ trip_id: id!, collaborator_id: cid })));
      await supabase.from("transport_trip_materials").delete().eq("trip_id", id);
      if (f.tipo === "material" && f.materials.length) await supabase.from("transport_trip_materials").insert(f.materials.map((m) => ({ trip_id: id!, material_id: m.material_id, quantidade: m.quantidade })));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transport_trips"] });
      toast.success("Salvo");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!f.id) return;
      const { error } = await supabase.from("transport_trips").delete().eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transport_trips"] });
      toast.success("Removido");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{f.id ? "Editar viagem" : "Nova viagem"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Número do carro</Label><Input value={f.car_number} onChange={(e) => setF({ ...f, car_number: e.target.value })} placeholder="Carro 01" /></div>
            <div>
              <Label>Coluna</Label>
              <Select value={f.column_id} onValueChange={(v) => setF({ ...f, column_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{columns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Tipo de transporte</Label>
            <div className="mt-1 inline-flex rounded-md border bg-muted p-0.5">
              <button type="button" onClick={() => setF({ ...f, tipo: "pessoas" })} className={cn("px-3 py-1.5 text-xs rounded transition", f.tipo === "pessoas" ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
                <UsersIcon className="inline mr-1 h-3 w-3" />Pessoas
              </button>
              <button type="button" onClick={() => setF({ ...f, tipo: "material" })} className={cn("px-3 py-1.5 text-xs rounded transition", f.tipo === "material" ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
                <Package className="inline mr-1 h-3 w-3" />Material
              </button>
            </div>
          </div>

          <div><Label>Data/hora</Label><Input type="datetime-local" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Origem</Label><Input value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></div>
            <div><Label>Destino</Label><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cliente</Label>
              <Select value={f.cliente || "__none__"} onValueChange={(v) => setF({ ...f, cliente: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>BSP (opcional)</Label><Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} placeholder="Número do BSP" /></div>
          </div>

          <div><Label>Etiquetas</Label><TagMultiSelect value={f.tag_ids} onChange={(ids) => setF({ ...f, tag_ids: ids })} /></div>

          {f.tipo === "pessoas" ? (
            <div><Label>Colaboradores</Label><CollaboratorMultiSelect value={f.collab_ids} onChange={(ids) => setF({ ...f, collab_ids: ids })} /></div>
          ) : (
            <div><Label>Materiais</Label><MaterialQuantitySelect value={f.materials} onChange={(v) => setF({ ...f, materials: v })} /></div>
          )}

          <div><Label>Observações</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} /></div>

          <div>
            <Label>Status</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as TripStatus })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="realizado">Realizado</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {f.id && <Button variant="destructive" onClick={() => del.mutate()}>Excluir</Button>}
          <Button onClick={() => save.mutate()} disabled={!f.car_number || !f.origin || !f.destination}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewColumnDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("transport_columns").insert({ name: name.trim(), position: 999 });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transport_columns"] }); setName(""); setOpen(false); toast.success("Coluna criada"); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Nova coluna</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova coluna</DialogTitle></DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da coluna" />
        <DialogFooter><Button onClick={() => create.mutate()} disabled={!name.trim()}>Criar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportDialog({ trips, tagsById, collabsById, materialsById }: { trips: Trip[]; tagsById: Map<string, Tag>; collabsById: Map<string, Collaborator>; materialsById: Map<string, Material> }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "range">("all");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());

  const doExport = () => {
    let list = trips;
    if (mode === "range") {
      const a = new Date(from + "T00:00:00").getTime();
      const b = new Date(to + "T23:59:59").getTime();
      list = trips.filter((t) => { const x = new Date(t.scheduled_at).getTime(); return x >= a && x <= b; });
    }
    const rows = list.map((t) => ({
      Data: fmtDate(t.scheduled_at),
      Carro: t.car_number,
      Tipo: t.tipo === "material" ? "Material" : "Pessoas",
      Cliente: t.cliente ?? "",
      BSP: t.bsp ?? "",
      Etiquetas: t.tags.map((x) => tagsById.get(x.tag_id)?.name).filter(Boolean).join(", "),
      Horário: fmtTime(t.scheduled_at),
      Origem: t.origin,
      Destino: t.destination,
      Colaboradores: t.collabs.map((x) => collabsById.get(x.collaborator_id)?.full_name).filter(Boolean).join(", "),
      Materiais: t.materials.map((x) => { const m = materialsById.get(x.material_id); return m ? `${m.descricao} ×${x.quantidade ?? 1}` : null; }).filter(Boolean).join(", "),
      Observações: t.notes ?? "",
      Status: STATUS_LABEL[t.status],
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transporte");
    XLSX.writeFile(wb, `transporte_${todayISO()}.xlsx`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}><Download className="mr-2 h-4 w-4" />Exportar Excel</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Exportar planilha</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> Toda a programação</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" checked={mode === "range"} onChange={() => setMode("range")} /> Período</label>
          </div>
          {mode === "range" && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label>Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
        </div>
        <DialogFooter><Button onClick={doExport}>Exportar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransportPage() {
  const search = useSearch({ from: "/admin/transport" });
  const navigate = useNavigate();
  const { columns, trips } = useTransportData();
  const { data: tags = [] } = useTagsQuery();
  const { data: collaborators = [] } = useCollaboratorsQuery();
  const { data: materials = [] } = useMaterialsQuery();
  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const collabsById = useMemo(() => new Map(collaborators.map((c) => [c.id, c])), [collaborators]);
  const materialsById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const [editing, setEditing] = useState<Trip | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TripStatus }) => {
      const { error } = await supabase.from("transport_trips").update({
        status, realizado: status === "realizado", cancelado: status === "cancelado",
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["transport_trips"] }),
  });

  const openEdit = (t: Trip | null) => { setEditing(t); setDialogOpen(true); };

  const allTrips = trips.data ?? [];
  const cols = columns.data ?? [];

  const tab = search.tab ?? "kanban";
  const setTab = (v: string) => navigate({ to: "/admin/transport", search: { ...search, tab: v } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transporte &amp; Rotas</h1>
          <p className="text-sm text-muted-foreground">Kanban de viagens, programação do dia, quadro detalhado e linha do tempo.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportDialog trips={allTrips} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} />
          <Button onClick={() => openEdit(null)}><Plus className="mr-2 h-4 w-4" />Nova viagem</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="day">Painel do Dia</TabsTrigger>
          <TabsTrigger value="detail">Quadro Detalhado</TabsTrigger>
          <TabsTrigger value="timeline">Linha do Tempo</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="mt-4">
          <KanbanView columns={cols} trips={allTrips} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onEdit={openEdit} onStatus={(id: string, status: TripStatus) => setStatus.mutate({ id, status })} />
        </TabsContent>
        <TabsContent value="day" className="mt-4">
          <DayView trips={allTrips} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onEdit={openEdit} />
        </TabsContent>
        <TabsContent value="detail" className="mt-4">
          <DetailView trips={allTrips} tags={tags} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onEdit={openEdit} initialTag={search.tag} initialStatus={search.status} initialCliente={search.cliente} initialTipo={search.tipo} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <TimelineView trips={allTrips} tagsById={tagsById} />
        </TabsContent>
      </Tabs>

      <TripDialog trip={editing} columns={cols} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function KanbanView({ columns, trips, tagsById, collabsById, materialsById, onEdit, onStatus }: any) {
  const byCol = useMemo(() => {
    const m = new Map<string, Trip[]>();
    for (const c of columns as Column[]) m.set(c.id, []);
    for (const t of trips as Trip[]) if (t.column_id && m.has(t.column_id)) m.get(t.column_id)!.push(t);
    return m;
  }, [columns, trips]);

  return (
    <div>
      <div className="mb-3 flex justify-end"><NewColumnDialog /></div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {(columns as Column[]).map((c) => (
          <div key={c.id} className="min-w-[280px] flex-1">
            <div className="mb-2 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold">{c.name}</h3>
              <span className="text-xs text-muted-foreground">{byCol.get(c.id)?.length ?? 0}</span>
            </div>
            <div className="space-y-2 rounded-lg bg-muted/30 p-2 min-h-[200px]">
              {(byCol.get(c.id) ?? []).map((t) => (
                <TripCard key={t.id} trip={t} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onClick={() => onEdit(t)} onStatus={(s) => onStatus(t.id, s)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayView({ trips, tagsById, collabsById, materialsById, onEdit }: any) {
  const [date, setDate] = useState(todayISO());
  const dayTrips = useMemo(() => (trips as Trip[]).filter((t) => t.scheduled_at.slice(0, 10) === date).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)), [trips, date]);
  const shift = (n: number) => {
    const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + n);
    setDate(d.toISOString().slice(0, 10));
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="relative">
          <CalIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-9 w-44" />
        </div>
        <Button variant="outline" size="icon" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm text-muted-foreground">{fmtDate(date)} · {dayTrips.length} viagem(ns)</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {dayTrips.map((t) => (
          <Card key={t.id} className={cn("p-3 cursor-pointer hover:border-primary/40 border-l-4", STATUS_BORDER[t.status])} onClick={() => onEdit(t)}>
            <div className="flex items-start justify-between">
              <div className="font-semibold">{t.car_number}</div>
              <StatusBadge status={t.status} />
            </div>
            <div className="text-xs text-muted-foreground">{fmtTime(t.scheduled_at)} · {t.tipo === "material" ? "Material" : "Pessoas"}{t.cliente ? ` · ${t.cliente}` : ""}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {t.tags.map((x) => { const tag = tagsById.get(x.tag_id); return tag && <span key={x.tag_id} className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>; })}
            </div>
            {t.bsp && <div className="mt-1 inline-block rounded border border-warning/40 bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">BSP: {t.bsp}</div>}
            <div className="mt-2 text-sm">{t.origin} <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" /> {t.destination}</div>
            {t.tipo === "pessoas" && t.collabs.length > 0 && <div className="mt-1 text-xs text-muted-foreground truncate">{t.collabs.map((c: any) => collabsById.get(c.collaborator_id)?.full_name).filter(Boolean).join(", ")}</div>}
            {t.tipo === "material" && t.materials.length > 0 && <div className="mt-1 text-xs text-muted-foreground truncate">{t.materials.map((m: any) => { const mat = materialsById.get(m.material_id); return mat ? `${mat.descricao} ×${m.quantidade ?? 1}` : null; }).filter(Boolean).join(", ")}</div>}
          </Card>
        ))}
        {dayTrips.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">Nenhuma viagem para esta data.</Card>}
      </div>
    </div>
  );
}

function DetailView({ trips, tags, tagsById, collabsById, materialsById, onEdit, initialTag, initialStatus, initialCliente, initialTipo }: any) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tagId, setTagId] = useState(initialTag ?? "all");
  const [status, setStatus] = useState(initialStatus ?? "all");
  const [cliente, setCliente] = useState(initialCliente ?? "all");
  const [tipo, setTipo] = useState(initialTipo ?? "all");

  const filtered = useMemo(() => {
    return (trips as Trip[]).filter((t) => {
      if (from && t.scheduled_at < from) return false;
      if (to && t.scheduled_at > to + "T23:59:59") return false;
      if (tagId !== "all" && !t.tags.some((x) => x.tag_id === tagId)) return false;
      if (status !== "all" && t.status !== status) return false;
      if (cliente !== "all" && t.cliente !== cliente) return false;
      if (tipo !== "all" && t.tipo !== tipo) return false;
      return true;
    });
  }, [trips, from, to, tagId, status, cliente, tipo]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><Label className="text-xs">De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pessoas">Pessoas</SelectItem>
              <SelectItem value="material">Material</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Etiqueta</Label>
          <Select value={tagId} onValueChange={setTagId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {(tags as Tag[]).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Cliente</Label>
          <Select value={cliente} onValueChange={setCliente}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="em_andamento">Em Andamento</SelectItem>
              <SelectItem value="realizado">Realizado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Carro</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>BSP</TableHead>
              <TableHead>Etiquetas</TableHead>
              <TableHead>Horário</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Pessoas/Materiais</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => onEdit(t)}>
                <TableCell>{fmtDate(t.scheduled_at)}</TableCell>
                <TableCell>{t.car_number}</TableCell>
                <TableCell>{t.tipo === "material" ? "Material" : "Pessoas"}</TableCell>
                <TableCell>{t.cliente ?? "—"}</TableCell>
                <TableCell>{t.bsp ?? "—"}</TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{t.tags.map((x) => { const tag = tagsById.get(x.tag_id); return tag && <span key={x.tag_id} className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>; })}</div></TableCell>
                <TableCell>{fmtTime(t.scheduled_at)}</TableCell>
                <TableCell>{t.origin}</TableCell>
                <TableCell>{t.destination}</TableCell>
                <TableCell className="max-w-[200px] truncate">
                  {t.tipo === "pessoas"
                    ? t.collabs.map((c: any) => collabsById.get(c.collaborator_id)?.full_name).filter(Boolean).join(", ")
                    : t.materials.map((m: any) => materialsById.get(m.material_id)?.descricao).filter(Boolean).join(", ")}
                </TableCell>
                <TableCell><StatusBadge status={t.status} /></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Sem viagens.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function TimelineView({ trips, tagsById }: { trips: Trip[]; tagsById: Map<string, Tag> }) {
  const [date, setDate] = useState(todayISO());
  const dayTrips = useMemo(() => trips.filter((t) => t.scheduled_at.slice(0, 10) === date).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)), [trips, date]);
  const byCar = useMemo(() => {
    const m = new Map<string, Trip[]>();
    for (const t of dayTrips) { if (!m.has(t.car_number)) m.set(t.car_number, []); m.get(t.car_number)!.push(t); }
    return Array.from(m.entries());
  }, [dayTrips]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const slot = (iso: string) => {
    const d = new Date(iso); return d.getHours() + d.getMinutes() / 60;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        <span className="text-sm text-muted-foreground">{fmtDate(date)}</span>
      </div>
      <Card className="p-4 overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="ml-32 grid grid-cols-24 text-[10px] text-muted-foreground border-b pb-1" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {hours.map((h) => <div key={h} className="text-center">{String(h).padStart(2, "0")}h</div>)}
          </div>
          {byCar.map(([car, list]) => (
            <div key={car} className="flex items-center border-b py-2">
              <div className="w-32 text-sm font-medium pr-2">{car}</div>
              <div className="relative flex-1 h-10 bg-muted/30 rounded">
                {list.map((t) => {
                  const left = (slot(t.scheduled_at) / 24) * 100;
                  const tag = t.tags[0] ? tagsById.get(t.tags[0].tag_id) : null;
                  return (
                    <div key={t.id} className="absolute top-1 bottom-1 rounded px-1.5 text-[10px] text-white flex items-center overflow-hidden shadow"
                      style={{ left: `${left}%`, minWidth: 80, maxWidth: 160, backgroundColor: tag?.color ?? "#3b82f6", opacity: t.status === "cancelado" ? 0.4 : 1 }}
                      title={`${fmtTime(t.scheduled_at)} ${t.origin} → ${t.destination}`}>
                      <span className="truncate">{fmtTime(t.scheduled_at)} {t.origin}→{t.destination}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {byCar.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Sem viagens neste dia.</div>}
        </div>
      </Card>
    </div>
  );
}
