import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas ainda não migradas (transport_solicitations/nominations/weld_type_config); cast local.
const supabase: any = supabaseTyped;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Calendar as CalIcon, ArrowRight, Users as UsersIcon, Package, Wand2, TrendingUp, CheckCircle2, Activity, X, Copy, Loader2, Check, ChevronsUpDown, ChevronsDownUp, Upload, AlertTriangle, Building2, Ship, Layers3, Wallet } from "lucide-react";
import { parsePlanilhaCustos, parseCustoBRL, parseDataBR, parseUnidadeBsp, splitNomes, parseBooleanoSN, parseBooleanoSimNao, type LinhaCustoBruta } from "@/lib/importCustos";
import { useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";
import { CollaboratorMultiSelect, useCollaboratorsQuery, type Collaborator } from "@/components/CollaboratorSelect";
import { MaterialQuantitySelect, useMaterialsQuery, materialLabel, type Material, type MaterialQty } from "@/components/MaterialMultiSelect";
import { TagMultiSelect, useTagsQuery, type Tag } from "@/components/TagMultiSelect";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { FadeInView } from "@/components/FadeInView";
import { Skeleton } from "@/components/ui/skeleton";
import { CLIENTES, clienteDaUnidade } from "@/lib/clientes";
import { useRateioPercentual, RateioPercentualPanel } from "@/components/LogisticaFormFields";
import { selectAllPages } from "@/lib/supabasePaginate";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate, fmtDateTime, fmtMoney, toDisplayCase } from "@/lib/format";
import { cn, matchesNameSearch } from "@/lib/utils";
import { PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, CartesianGrid, BarChart, Bar, LabelList } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { pageTitle } from "@/lib/pageTitle";


type TripStatus = "em_andamento" | "realizado" | "faturado" | "cancelado";
type TripTipo = "pessoas" | "material";

type TransportSearch = { tab?: string; tag?: string; status?: string; cliente?: string; tipo?: string };

export const Route = createFileRoute("/admin/transport")({ head: () => pageTitle("Transporte"),
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
  origens_extras: string[] | null;
  destinos_extras: string[] | null;
  notes: string | null;
  tipo: TripTipo;
  bsp: string | null;
  bsp_2: string | null;
  bsp_3: string | null;
  cliente: string | null;
  cliente_2: string | null;
  cliente_3: string | null;
  unidade: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  status: TripStatus;
  custo: number | null;
  custo_2: number | null;
  custo_3: number | null;
  // Campos vindos da importação da planilha de custos histórica (ver src/lib/importCustos.ts)
  // — também editáveis pra lançamentos novos.
  nf: string | null;
  motivo: string | null;
  cobrado: boolean | null;
  status_lancamento: string | null;
  faturado: boolean | null;
  usuario_faturamento: string | null;
  data_faturamento: string | null;
  tags: { tag_id: string }[];
  collabs: { collaborator_id: string }[];
  materials: { material_id: string; quantidade: number | null }[];
};

const STATUS_LABEL: Record<TripStatus, string> = { em_andamento: "Em Andamento", realizado: "Realizado", faturado: "Faturado", cancelado: "Cancelado" };
const STATUS_BADGE: Record<TripStatus, string> = {
  em_andamento: "bg-primary/15 text-primary border-primary/30",
  realizado: "bg-success/15 text-success border-success/30",
  faturado: "bg-violet-500/15 text-violet-700 border-violet-500/30",
  cancelado: "bg-destructive/15 text-destructive border-destructive/30",
};
const STATUS_BORDER: Record<TripStatus, string> = {
  em_andamento: "border-l-primary",
  realizado: "border-l-success",
  faturado: "border-l-violet-500",
  cancelado: "border-l-destructive",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function fmtTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
// Soma o valor rateado entre os até 3 BSPs de uma viagem (null quando nenhum foi preenchido).
function custoTotal(t: Trip): number | null {
  const valores = [t.custo, t.custo_2, t.custo_3].filter((v): v is number => v != null);
  return valores.length ? valores.reduce((a, b) => a + b, 0) : null;
}
function compareCarNumber(a: string, b: string) {
  const na = parseInt((a.match(/\d+/) ?? ["0"])[0], 10);
  const nb = parseInt((b.match(/\d+/) ?? ["0"])[0], 10);
  if (na !== nb) return na - nb;
  return a.localeCompare(b);
}

// Exportação de todas as viagens — usada pelo módulo de Relatórios (card "Transporte").
// Busca os próprios dados (não depende de nenhuma tela já aberta) e já baixa tudo, sem
// diálogo de opções — igual ao resto dos cartões de Relatórios.
export async function generateRelatorioTransporte(dataInicio?: string, dataFim?: string): Promise<void> {
  let tripsQuery = supabase.from("transport_trips")
    .select("*, tags:transport_trip_tags(tag_id), collabs:transport_trip_collaborators(collaborator_id), materials:transport_trip_materials(material_id, quantidade)")
    .order("scheduled_at");
  if (dataInicio) tripsQuery = tripsQuery.gte("scheduled_at", dataInicio);
  if (dataFim) tripsQuery = tripsQuery.lte("scheduled_at", `${dataFim}T23:59:59`);

  const [{ data: trips, error: tripsErr }, { data: tags }, { data: collabs }, { data: materials }] = await Promise.all([
    tripsQuery,
    supabase.from("transport_tags").select("*"),
    supabase.from("collaborators").select("*").eq("active", true),
    supabase.from("materials").select("*").eq("active", true),
  ]);
  if (tripsErr) throw tripsErr;

  const tagsById = new Map(((tags ?? []) as Tag[]).map((t) => [t.id, t]));
  const collabsById = new Map(((collabs ?? []) as Collaborator[]).map((c) => [c.id, c]));
  const materialsById = new Map(((materials ?? []) as Material[]).map((m) => [m.id, m]));

  const rows = ((trips ?? []) as Trip[]).map((t) => ({
    Data: fmtDate(t.scheduled_at),
    Carro: t.car_number,
    Tipo: t.tipo === "material" ? "Material" : "Pessoas",
    Cliente: t.cliente ?? "",
    "Cliente 2": t.cliente_2 ?? "",
    "Cliente 3": t.cliente_3 ?? "",
    BSP: t.bsp ?? "",
    "BSP 2": t.bsp_2 ?? "",
    "BSP 3": t.bsp_3 ?? "",
    Unidade: t.unidade ?? "",
    Etiquetas: t.tags.map((x) => tagsById.get(x.tag_id)?.name).filter(Boolean).join(", "),
    Horário: fmtTime(t.scheduled_at),
    Origem: [t.origin, ...(t.origens_extras ?? [])].filter(Boolean).join("; "),
    Destino: [t.destination, ...(t.destinos_extras ?? [])].filter(Boolean).join("; "),
    Colaboradores: t.collabs.map((x) => collabsById.get(x.collaborator_id)?.full_name).filter(Boolean).join(", "),
    Materiais: t.materials.map((x) => { const m = materialsById.get(x.material_id); return m ? `${materialLabel(m)} ×${x.quantidade ?? 1}` : null; }).filter(Boolean).join(", "),
    Observações: t.notes ?? "",
    Status: STATUS_LABEL[t.status],
    Custo: t.custo ?? "",
    "Custo 2": t.custo_2 ?? "",
    "Custo 3": t.custo_3 ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transporte");
  XLSX.writeFile(wb, `transporte_${todayISO()}.xlsx`);
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
    // Sem paginação, o PostgREST corta em 1000 linhas — como a consulta vem ordenada por
    // scheduled_at crescente, o corte silencioso derruba justamente as viagens mais recentes
    // (ex.: quando a tabela passa de 1000 linhas, agosto some quase inteiro da tela, mesmo com
    // o dado intacto no banco). selectAllPages já é o padrão usado pras outras tabelas grandes
    // do app (timesheet_dias, hist_novo_periodos etc.) por esse mesmo motivo.
    queryFn: () => selectAllPages<Trip>((from, to) =>
      supabase
        .from("transport_trips")
        .select("*, tags:transport_trip_tags(tag_id), collabs:transport_trip_collaborators(collaborator_id), materials:transport_trip_materials(material_id, quantidade)")
        .order("scheduled_at")
        .range(from, to),
    ),
  });
  return { columns, trips };
}

function StatusBadge({ status }: { status: TripStatus }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[status])}>{STATUS_LABEL[status]}</span>;
}

function TripCard({ trip, tagsById, collabsById, materialsById, onClick, onStatus, onDuplicate }: {
  trip: Trip;
  tagsById: Map<string, Tag>;
  collabsById: Map<string, Collaborator>;
  materialsById: Map<string, Material>;
  onClick: () => void;
  onStatus: (s: TripStatus) => void;
  onDuplicate?: () => void;
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
        <div className="text-right text-xs text-muted-foreground">
          <div>{fmtDate(trip.scheduled_at)}</div>
          {(trip.departure_time || trip.arrival_time) && (
            <div className="mt-0.5 text-[10px]">
              {trip.departure_time && <span>Part.: {trip.departure_time}</span>}
              {trip.departure_time && trip.arrival_time && <span> · </span>}
              {trip.arrival_time && <span>Dest.: {trip.arrival_time}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {trip.tags.map((t) => {
          const tag = tagsById.get(t.tag_id);
          if (!tag) return null;
          return <span key={t.tag_id} className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>;
        })}
        {[trip.cliente, trip.cliente_2, trip.cliente_3].filter(Boolean).map((c, i) => (
          <span key={`cli-${i}`} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">{c}</span>
        ))}
      </div>

      {[trip.bsp, trip.bsp_2, trip.bsp_3].some(Boolean) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {[trip.bsp, trip.bsp_2, trip.bsp_3].filter(Boolean).map((b, i) => (
            <span key={`bsp-${i}`} className="inline-flex items-center rounded-md border border-warning/40 bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">
              BSP: {b}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 text-sm space-y-0.5">
        <div>
          <span className="text-muted-foreground">{trip.origin}</span>
          <ArrowRight className="inline mx-1 h-3 w-3 text-muted-foreground" />
          <span>{trip.destination}</span>
        </div>
        {(trip.origens_extras ?? []).map((o, i) => {
          const d = (trip.destinos_extras ?? [])[i] ?? "";
          if (!o && !d) return null;
          return (
            <div key={`xtr-${i}`}>
              <span className="text-muted-foreground">{o || "—"}</span>
              <ArrowRight className="inline mx-1 h-3 w-3 text-muted-foreground" />
              <span>{d || "—"}</span>
            </div>
          );
        })}
      </div>

      {trip.tipo === "pessoas" && trip.collabs.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground truncate">
          {trip.collabs.map((c) => collabsById.get(c.collaborator_id)?.full_name).filter(Boolean).join(", ")}
        </div>
      )}
      {trip.tipo === "material" && trip.materials.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground truncate">
          {trip.materials.map((m) => { const mat = materialsById.get(m.material_id); return mat ? `${materialLabel(mat)} ×${m.quantidade ?? 1}` : null; }).filter(Boolean).join(", ")}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Select value={trip.status} onValueChange={(v) => onStatus(v as TripStatus)}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="realizado">Realizado</SelectItem>
            <SelectItem value="faturado">Faturado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        {onDuplicate && (
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onDuplicate} title="Duplicar viagem">
            <Copy className="mr-1 h-3 w-3" />Duplicar
          </Button>
        )}
      </div>
    </Card>
  );
}

type CollabFormSlice = { collab_ids: string[]; origin: string; destination: string; notes: string; unidade: string };

function CollaboratorsSection<T extends CollabFormSlice>({ f, setF }: { f: T; setF: (v: T) => void }) {
  const { data: collaborators = [] } = useCollaboratorsQuery();
  const selectedCollabs = f.collab_ids
    .map((id) => collaborators.find((c) => c.id === id))
    .filter((c): c is Collaborator => !!c);
  const citiesAvailable = selectedCollabs.filter((c) => c.city).length;

  const autoTrajeto = () => {
    const cities: string[] = [];
    for (const c of selectedCollabs) {
      const city = (c.city ?? "").trim();
      if (city && cities[cities.length - 1] !== city) cities.push(city);
    }
    if (cities.length === 0) { notify.error("Nenhum colaborador com cidade cadastrada"); return; }
    if (cities.length === 1) {
      setF({ ...f, origin: cities[0], destination: cities[0] });
      notify.success("Trajeto sugerido aplicado");
      return;
    }
    const origin = cities[0];
    const destination = cities[cities.length - 1];
    const stops = cities.slice(1, -1);
    const stopsLine = stops.length ? `Paradas: ${stops.join(" → ")}` : "";
    const baseNotes = (f.notes ?? "").replace(/\n?Paradas: .*/g, "").trim();
    const notes = [baseNotes, stopsLine].filter(Boolean).join("\n");
    setF({ ...f, origin, destination, notes });
    notify.success("Trajeto sugerido aplicado");
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>Colaboradores</Label>
        {selectedCollabs.length >= 2 && citiesAvailable >= 1 && (
          <Button type="button" variant="ghost" size="sm" onClick={autoTrajeto} className="h-7 text-xs">
            <Wand2 className="mr-1 h-3 w-3" />Montar trajeto automaticamente
          </Button>
        )}
      </div>
      <CollaboratorMultiSelect
        value={f.collab_ids}
        onChange={(ids) => {
          const prev = f.collab_ids;
          const added = ids.find((id) => !prev.includes(id));
          let next: T = { ...f, collab_ids: ids };
          if (added) {
            const c = collaborators.find((x) => x.id === added);
            if (c?.city) {
              if (!f.origin.trim()) next = { ...next, origin: c.city };
              else if (!f.destination.trim()) next = { ...next, destination: c.city };
            }
            if (c?.unit && !f.unidade.trim()) next = { ...next, unidade: c.unit };
          }
          setF(next);
        }}
        onUseAsOrigin={(c) => c.city && setF({ ...f, origin: c.city })}
        onUseAsDestination={(c) => c.city && setF({ ...f, destination: c.city })}
      />
    </div>
  );
}

// Lista fixa de clientes (CLIENTES) + opção de digitar um cliente manual não cadastrado.
function ClientSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isKnown = (v: string) => (CLIENTES as readonly string[]).includes(v);
  const [manual, setManual] = useState(() => !!value && !isKnown(value));

  useEffect(() => {
    setManual(!!value && !isKnown(value));
  }, [value]);

  return (
    <div>
      <Label>{label}</Label>
      {manual ? (
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Nome do cliente"
            className="flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => { setManual(false); onChange(""); }}>
            Lista
          </Button>
        </div>
      ) : (
        <Select
          value={value || "__none__"}
          onValueChange={(v) => {
            if (v === "__custom__") { setManual(true); onChange(""); }
            else onChange(v === "__none__" ? "" : v);
          }}
        >
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">—</SelectItem>
            {CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            <SelectItem value="__custom__">Outro (digitar)...</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

const CARRO_PRESETS = ["Uber", "Transfer", "Transporte Step"];
const CARRO_OPCOES = [...CARRO_PRESETS, "Future", "Outro"];

function parseCarro(car_number: string): { carro_opcao: string; carro_future_num: string; carro_outro: string } {
  const v = car_number.trim();
  if (!v) return { carro_opcao: "", carro_future_num: "", carro_outro: "" };
  if (CARRO_PRESETS.includes(v)) return { carro_opcao: v, carro_future_num: "", carro_outro: "" };
  const futureMatch = /^Future\s+(\d{1,2})$/i.exec(v);
  if (futureMatch) return { carro_opcao: "Future", carro_future_num: futureMatch[1], carro_outro: "" };
  return { carro_opcao: "Outro", carro_future_num: "", carro_outro: v };
}

function TripDialog({ trip, columns, open, onOpenChange }: { trip: Trip | null; columns: Column[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  type FormState = {
    id?: string; car_number: string; carro_opcao: string; carro_future_num: string; carro_outro: string; column_id: string; scheduled_at: string;
    departure_time: string; arrival_time: string;
    origin: string; destination: string;
    origens_extras: string[]; destinos_extras: string[];
    notes: string;
    tipo: TripTipo; bsp: string; bsp_2: string; bsp_3: string; cliente: string; cliente_2: string; cliente_3: string; unidade: string; status: TripStatus;
    custo: string; custo_2: string; custo_3: string;
    nf: string; motivo: string; cobrado: boolean; status_lancamento: string; faturado: boolean; usuario_faturamento: string; data_faturamento: string;
    tag_ids: string[]; collab_ids: string[]; materials: MaterialQty[];
  };
  const init = (t: Trip | null, cols: Column[]): FormState => {
    if (t) return {
      id: t.id, car_number: t.car_number, ...parseCarro(t.car_number), column_id: t.column_id ?? (cols[0]?.id ?? ""),
      scheduled_at: (t.scheduled_at ?? "").slice(0, 10),
      departure_time: t.departure_time ?? "", arrival_time: t.arrival_time ?? "",
      origin: t.origin, destination: t.destination,
      origens_extras: t.origens_extras ?? [], destinos_extras: t.destinos_extras ?? [],
      notes: t.notes ?? "",
      tipo: t.tipo,
      bsp: t.bsp ?? "", bsp_2: t.bsp_2 ?? "", bsp_3: t.bsp_3 ?? "",
      cliente: t.cliente ?? "", cliente_2: t.cliente_2 ?? "", cliente_3: t.cliente_3 ?? "",
      unidade: t.unidade ?? "", status: t.status,
      custo: t.custo != null ? String(t.custo) : "",
      custo_2: t.custo_2 != null ? String(t.custo_2) : "",
      custo_3: t.custo_3 != null ? String(t.custo_3) : "",
      nf: t.nf ?? "", motivo: t.motivo ?? "", cobrado: t.cobrado ?? false,
      status_lancamento: t.status_lancamento ?? "", faturado: t.faturado ?? false,
      usuario_faturamento: t.usuario_faturamento ?? "", data_faturamento: t.data_faturamento ?? "",
      tag_ids: t.tags.map((x) => x.tag_id),
      collab_ids: t.collabs.map((x) => x.collaborator_id),
      materials: t.materials.map((x) => ({ material_id: x.material_id, quantidade: x.quantidade ?? 1 })),
    };
    return {
      car_number: "", carro_opcao: "", carro_future_num: "", carro_outro: "", column_id: cols[0]?.id ?? "", scheduled_at: new Date().toISOString().slice(0, 10),
      departure_time: "", arrival_time: "",
      origin: "", destination: "",
      origens_extras: [], destinos_extras: [],
      notes: "",
      tipo: "pessoas",
      bsp: "", bsp_2: "", bsp_3: "",
      cliente: "", cliente_2: "", cliente_3: "",
      unidade: "", status: "em_andamento",
      custo: "", custo_2: "", custo_3: "",
      nf: "", motivo: "", cobrado: false, status_lancamento: "", faturado: false, usuario_faturamento: "", data_faturamento: "",
      tag_ids: [], collab_ids: [], materials: [],
    };
  };
  const [f, setF] = useState<FormState>(() => init(trip, columns));
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const rateio = useRateioPercentual(3);
  if (open && openedFor !== (trip?.id ?? "new")) {
    setF(init(trip, columns));
    setOpenedFor(trip?.id ?? "new");
    rateio.reset();
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  // Rateio ligado: os 3 campos de Valor deixam de ser digitados direto e passam a refletir
  // total × percentual — sem isso, a pessoa preencheria os dois de qualquer jeito e um
  // sobrescreveria o outro sem nenhum aviso.
  useEffect(() => {
    if (!rateio.ativo) return;
    setF((atual) => ({
      ...atual,
      custo: String(rateio.valores[0] ?? 0),
      custo_2: String(rateio.valores[1] ?? 0),
      custo_3: String(rateio.valores[2] ?? 0),
    }));
  }, [rateio.ativo, rateio.valores[0], rateio.valores[1], rateio.valores[2]]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        car_number: f.car_number.trim(), column_id: f.column_id || null,
        scheduled_at: `${f.scheduled_at}T12:00:00.000Z`,
        departure_time: f.departure_time || null,
        arrival_time: f.arrival_time || null,
        origin: f.origin.trim(), destination: f.destination.trim(),
        origens_extras: f.origens_extras.map((s) => s.trim()).filter((_, i) => f.origens_extras[i].trim() || (f.destinos_extras[i] ?? "").trim()),
        destinos_extras: f.destinos_extras.map((s) => s.trim()).filter((_, i) => (f.origens_extras[i] ?? "").trim() || f.destinos_extras[i].trim()),
        notes: f.notes.trim() || null,
        tipo: f.tipo,
        bsp: f.bsp.trim() || null, bsp_2: f.bsp_2.trim() || null, bsp_3: f.bsp_3.trim() || null,
        cliente: f.cliente || null, cliente_2: f.cliente_2 || null, cliente_3: f.cliente_3 || null,
        unidade: f.unidade.trim() || null,
        status: f.status,
        custo: f.custo.trim() ? Number(f.custo.trim()) : null,
        custo_2: f.custo_2.trim() ? Number(f.custo_2.trim()) : null,
        custo_3: f.custo_3.trim() ? Number(f.custo_3.trim()) : null,
        realizado: f.status === "realizado", cancelado: f.status === "cancelado",
        nf: f.nf.trim() || null, motivo: f.motivo.trim() || null, cobrado: f.cobrado,
        status_lancamento: f.status_lancamento.trim() || null, faturado: f.faturado,
        usuario_faturamento: f.usuario_faturamento.trim() || null, data_faturamento: f.data_faturamento || null,
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
      notify.success("Salvo");
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const setCarroOpcao = (opcao: string) => {
    if (opcao === "Future") setF({ ...f, carro_opcao: opcao, car_number: f.carro_future_num ? `Future ${f.carro_future_num}` : "" });
    else if (opcao === "Outro") setF({ ...f, carro_opcao: opcao, car_number: f.carro_outro });
    else setF({ ...f, carro_opcao: opcao, car_number: opcao });
  };
  const setCarroFutureNum = (num: string) => setF({ ...f, carro_future_num: num, car_number: `Future ${num}` });
  const setCarroOutro = (val: string) => setF({ ...f, carro_outro: val, car_number: val });

  const del = useMutation({
    mutationFn: async () => {
      if (!f.id) return;
      const { error } = await supabase.from("transport_trips").delete().eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transport_trips"] });
      notify.success("Removido");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{f.id ? "Editar viagem" : "Nova viagem"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Transporte</Label>
              <div className="flex gap-2">
                <Select value={f.carro_opcao} onValueChange={setCarroOpcao}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{CARRO_OPCOES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
                {f.carro_opcao === "Future" && (
                  <Select value={f.carro_future_num} onValueChange={setCarroFutureNum}>
                    <SelectTrigger className="w-20"><SelectValue placeholder="Nº" /></SelectTrigger>
                    <SelectContent>{Array.from({ length: 20 }, (_, i) => String(i + 1)).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              {f.carro_opcao === "Outro" && (
                <Input className="mt-2" value={f.carro_outro} onChange={(e) => setCarroOutro(e.target.value)} placeholder="Especifique o transporte" />
              )}
            </div>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label>Data</Label><Input type="date" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></div>
            <div><Label>Horário de Partida</Label><Input type="time" value={f.departure_time} onChange={(e) => setF({ ...f, departure_time: e.target.value })} /></div>
            <div><Label>Horário de Destino</Label><Input type="time" value={f.arrival_time} onChange={(e) => setF({ ...f, arrival_time: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Origem</Label><Input value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></div>
            <div><Label>Destino</Label><Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></div>
          </div>

          {f.origens_extras.map((_, i) => (
            <div key={`extra-${i}`} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div>
                <Label>Origem {i + 2}</Label>
                <Input
                  value={f.origens_extras[i] ?? ""}
                  onChange={(e) => {
                    const next = [...f.origens_extras];
                    next[i] = e.target.value;
                    setF({ ...f, origens_extras: next });
                  }}
                />
              </div>
              <div>
                <Label>Destino {i + 2}</Label>
                <Input
                  value={f.destinos_extras[i] ?? ""}
                  onChange={(e) => {
                    const next = [...f.destinos_extras];
                    next[i] = e.target.value;
                    setF({ ...f, destinos_extras: next });
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  const o = [...f.origens_extras]; o.splice(i, 1);
                  const d = [...f.destinos_extras]; d.splice(i, 1);
                  setF({ ...f, origens_extras: o, destinos_extras: d });
                }}
                aria-label="Remover par"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setF({ ...f, origens_extras: [...f.origens_extras, ""], destinos_extras: [...f.destinos_extras, ""] })}
            >
              <Plus className="mr-1 h-3 w-3" />Adicionar origem/destino
            </Button>
          </div>


          {/* Cliente/BSP/Valor em até 3 linhas — cobre o caso raro de uma mesma viagem levar
              colaboradores de BSPs diferentes, ratear o custo entre eles preenchendo mais de
              uma linha. Na maioria das viagens só a primeira linha é usada. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3">
            <ClientSelect label="Cliente" value={f.cliente} onChange={(v) => setF({ ...f, cliente: v })} />
            <div><Label>BSP (opcional)</Label><Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} placeholder="Número do BSP" /></div>
            <div>
              <Label>Valor (opcional)</Label>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal" readOnly={rateio.ativo}
                className={rateio.ativo ? "bg-muted/40" : undefined}
                value={f.custo} onChange={(e) => setF({ ...f, custo: e.target.value })}
                placeholder="R$ 0,00"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3">
            <ClientSelect label="Cliente 2 (opcional)" value={f.cliente_2} onChange={(v) => setF({ ...f, cliente_2: v })} />
            <div><Label>BSP 2 (opcional)</Label><Input value={f.bsp_2} onChange={(e) => setF({ ...f, bsp_2: e.target.value })} placeholder="Número do BSP" /></div>
            <div>
              <Label>Valor 2 (opcional)</Label>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal" readOnly={rateio.ativo}
                className={rateio.ativo ? "bg-muted/40" : undefined}
                value={f.custo_2} onChange={(e) => setF({ ...f, custo_2: e.target.value })}
                placeholder="R$ 0,00"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3">
            <ClientSelect label="Cliente 3 (opcional)" value={f.cliente_3} onChange={(v) => setF({ ...f, cliente_3: v })} />
            <div><Label>BSP 3 (opcional)</Label><Input value={f.bsp_3} onChange={(e) => setF({ ...f, bsp_3: e.target.value })} placeholder="Número do BSP" /></div>
            <div>
              <Label>Valor 3 (opcional)</Label>
              <Input
                type="number" step="0.01" min="0" inputMode="decimal" readOnly={rateio.ativo}
                className={rateio.ativo ? "bg-muted/40" : undefined}
                value={f.custo_3} onChange={(e) => setF({ ...f, custo_3: e.target.value })}
                placeholder="R$ 0,00"
              />
            </div>
          </div>

          <RateioPercentualPanel rateio={rateio} labels={["BSP 1", "BSP 2", "BSP 3"]} />

          <div><Label>Unidade</Label><Input value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })} placeholder="Preenchido automaticamente ao selecionar colaborador" /></div>

          <div><Label>Etiquetas</Label><TagMultiSelect value={f.tag_ids} onChange={(ids) => setF({ ...f, tag_ids: ids })} /></div>

          {f.tipo === "pessoas" ? (
            <CollaboratorsSection f={f} setF={setF} />
          ) : (
            <div><Label>Materiais</Label><MaterialQuantitySelect value={f.materials} onChange={(v) => setF({ ...f, materials: v })} /></div>
          )}

          <div><Label>Observações</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} /></div>

          {/* Campos de faturamento/custo — vieram da importação da planilha histórica, mas
              seguem editáveis pra lançamentos novos também. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Motivo</Label><Input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></div>
            <div><Label>NF</Label><Input value={f.nf} onChange={(e) => setF({ ...f, nf: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Status Lanç.</Label><Input value={f.status_lancamento} onChange={(e) => setF({ ...f, status_lancamento: e.target.value })} placeholder="Ex.: Definitivo" /></div>
            <div className="flex items-end gap-2 pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.cobrado} onChange={(e) => setF({ ...f, cobrado: e.target.checked })} />
                Cobrado do cliente
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-end gap-2 pb-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.faturado} onChange={(e) => setF({ ...f, faturado: e.target.checked })} />
                Faturado
              </label>
            </div>
            
            <div><Label>Data Faturamento</Label><Input type="date" value={f.data_faturamento} onChange={(e) => setF({ ...f, data_faturamento: e.target.value })} /></div>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as TripStatus })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="realizado">Realizado</SelectItem>
                <SelectItem value="faturado">Faturado</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {f.id && <Button variant="destructive" onClick={() => del.mutate()} loading={del.isPending}>Excluir</Button>}
          <Button onClick={() => save.mutate()} disabled={!f.car_number || !f.origin || !f.destination} loading={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Importação da planilha de custos histórica (aba "Transporte") ──────────────────────────
// Uma linha da planilha = uma viagem (Trip); Transporte já suporta múltiplos colaboradores
// por viagem via transport_trip_collaborators, então os nomes da coluna Funcionário viram
// vínculos da MESMA viagem, sem duplicar linha (diferente de Hospedagem/Passagens).
interface ParsedTransporteRow {
  payload: Record<string, unknown> | null;
  colaboradorIds: string[];
  nomesNaoEncontrados: string[];
  erro: string | null;
  data: string; fornecedor: string; custo: number | null; funcionarios: string;
  // Preenchidos depois de casar com os cartões já existentes (ver acharCartaoExistente) — null
  // até essa etapa rodar.
  acao?: "cria" | "atualiza" | "sem_mudanca";
  tripIdExistente?: string;
  camposParaAtualizar?: Record<string, unknown>;
}

// Campos de custo que a importação pode completar num cartão já existente — nunca mexe em
// origem/destino/tipo/bsp/unidade/carro/observações/colaboradores, que já foram preenchidos
// manualmente por quem criou o cartão.
const CAMPOS_CUSTO_ATUALIZAVEIS = ["nf", "motivo", "cobrado", "status_lancamento", "faturado", "usuario_faturamento", "data_faturamento", "custo"] as const;

function vazio(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function buildTransportRow(l: LinhaCustoBruta, collabByName: Map<string, Collaborator>): ParsedTransporteRow {
  const data = parseDataBR(l.data);
  const custo = parseCustoBRL(l.custo);
  const base = { data: l.data, fornecedor: l.fornecedor, custo, funcionarios: l.funcionario };
  if (!data) return { payload: null, colaboradorIds: [], nomesNaoEncontrados: [], erro: "Data inválida", ...base };
  if (custo == null) return { payload: null, colaboradorIds: [], nomesNaoEncontrados: [], erro: "Custo inválido", ...base };

  const { unidade, bsp } = parseUnidadeBsp(l.projeto);
  const nomes = splitNomes(l.funcionario);
  const colaboradorIds: string[] = [];
  const nomesNaoEncontrados: string[] = [];
  nomes.forEach((n) => {
    const c = collabByName.get(n.trim().toUpperCase());
    if (c) colaboradorIds.push(c.id); else nomesNaoEncontrados.push(n);
  });

  // "CARAPEBUS X MACAE" → origem/destino; sem esse padrão, fica "Não informado" nos dois
  // (o texto completo continua em notes, nada se perde).
  const obsMatch = l.observacao.match(/^(.+?)\s+[Xx]\s+(.+)$/);
  const origin = obsMatch ? obsMatch[1].trim() : "Não informado";
  const destination = obsMatch ? obsMatch[2].trim() : "Não informado";

  const notes = [
    l.tipoApontamento,
    l.observacao,
    nomesNaoEncontrados.length ? `Colaborador(es) não localizado(s): ${nomesNaoEncontrados.join(", ")}` : null,
  ].filter(Boolean).join(" — ") || null;

  const payload = {
    car_number: l.fornecedor.trim() || "Não informado",
    column_id: null,
    scheduled_at: `${data}T12:00:00.000Z`,
    origin, destination,
    origens_extras: [], destinos_extras: [],
    notes,
    tipo: "pessoas",
    bsp, bsp_2: null, bsp_3: null,
    cliente: null, cliente_2: null, cliente_3: null,
    unidade,
    status: "realizado", realizado: true, cancelado: false,
    custo, custo_2: null, custo_3: null,
    nf: l.nf.trim() || null, motivo: l.motivo.trim() || null, cobrado: parseBooleanoSN(l.cobrado),
    status_lancamento: l.statusLancamento.trim() || null, faturado: parseBooleanoSimNao(l.faturado),
    usuario_faturamento: l.usuarioFaturamento.trim() || null, data_faturamento: parseDataBR(l.dataFaturamento),
  };
  return { payload, colaboradorIds, nomesNaoEncontrados, erro: null, ...base };
}

function ImportCustosTransporteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: collaborators = [] } = useCollaboratorsQuery();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedTransporteRow[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const collabByName = useMemo(() => {
    const m = new Map<string, Collaborator>();
    collaborators.forEach((c) => m.set(c.full_name.trim().toUpperCase(), c));
    return m;
  }, [collaborators]);

  const onFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const linhas = parsePlanilhaCustos(buf, "Transporte");
    if (linhas.length === 0) { notify.error('Nenhuma linha encontrada na aba "Transporte" da planilha.'); return; }
    const rows = linhas.map((l) => buildTransportRow(l, collabByName));
    const validasIniciais = rows.filter((r) => !r.erro && r.payload);
    if (validasIniciais.length === 0) { setPreview(rows); return; }

    // Transporte já tem cartões criados manualmente, muitos deles já com bastante coisa
    // preenchida (tags, materiais, observações) — antes de criar cartão novo, procura se já
    // existe um pra essa data+colaborador e só completa os campos de custo que ainda estiverem
    // vazios nele, sem tocar em mais nada (decisão confirmada com a usuária).
    const datas = validasIniciais.map((r) => String(r.payload!.scheduled_at).slice(0, 10));
    const minData = datas.reduce((a, b) => (a < b ? a : b));
    const maxData = datas.reduce((a, b) => (a > b ? a : b));

    const { data: existentes, error } = await supabase
      .from("transport_trips")
      .select("id, scheduled_at, nf, motivo, cobrado, status_lancamento, faturado, usuario_faturamento, data_faturamento, custo, collabs:transport_trip_collaborators(collaborator_id)")
      .gte("scheduled_at", `${minData}T00:00:00.000Z`)
      .lte("scheduled_at", `${maxData}T23:59:59.999Z`);
    if (error) { notify.error(error.message); return; }

    const porDataColaborador = new Map<string, any>();
    (existentes ?? []).forEach((t: any) => {
      const dia = String(t.scheduled_at).slice(0, 10);
      (t.collabs ?? []).forEach((c: any) => {
        const key = `${dia}::${c.collaborator_id}`;
        if (!porDataColaborador.has(key)) porDataColaborador.set(key, t);
      });
    });

    const enriquecidas = rows.map((r): ParsedTransporteRow => {
      if (r.erro || !r.payload) return r;
      const dia = String(r.payload.scheduled_at).slice(0, 10);
      const match = r.colaboradorIds.map((cid) => porDataColaborador.get(`${dia}::${cid}`)).find((t) => t);
      if (!match) return { ...r, acao: "cria" };
      const camposParaAtualizar: Record<string, unknown> = {};
      CAMPOS_CUSTO_ATUALIZAVEIS.forEach((campo) => {
        if (vazio(match[campo]) && !vazio((r.payload as Record<string, unknown>)[campo])) {
          camposParaAtualizar[campo] = (r.payload as Record<string, unknown>)[campo];
        }
      });
      const temMudanca = Object.keys(camposParaAtualizar).length > 0;
      return { ...r, acao: temMudanca ? "atualiza" : "sem_mudanca", tripIdExistente: match.id, camposParaAtualizar };
    });
    setPreview(enriquecidas);
  };

  const validas = preview?.filter((p) => !p.erro) ?? [];
  const invalidas = preview?.filter((p) => p.erro) ?? [];
  const nomesNaoEncontradosUnicos = Array.from(new Set(validas.flatMap((p) => p.nomesNaoEncontrados))).sort();
  const paraCriar = validas.filter((p) => p.acao === "cria");
  const paraAtualizar = validas.filter((p) => p.acao === "atualiza");
  const semMudanca = validas.filter((p) => p.acao === "sem_mudanca");

  const importar = useMutation({
    mutationFn: async () => {
      const total = paraCriar.length + paraAtualizar.length;
      const BATCH = 500;
      for (let i = 0; i < paraCriar.length; i += BATCH) {
        const lote = paraCriar.slice(i, i + BATCH);
        const { data, error } = await supabase.from("transport_trips").insert(lote.map((r) => r.payload)).select("id");
        if (error) throw error;
        const collabRows: { trip_id: string; collaborator_id: string }[] = [];
        (data ?? []).forEach((row: { id: string }, idx: number) => {
          lote[idx].colaboradorIds.forEach((cid) => collabRows.push({ trip_id: row.id, collaborator_id: cid }));
        });
        if (collabRows.length) {
          const { error: ce } = await supabase.from("transport_trip_collaborators").insert(collabRows);
          if (ce) throw ce;
        }
        setProgress({ done: Math.min(i + BATCH, paraCriar.length), total });
      }
      for (let i = 0; i < paraAtualizar.length; i++) {
        const r = paraAtualizar[i];
        const { error } = await supabase.from("transport_trips").update(r.camposParaAtualizar).eq("id", r.tripIdExistente);
        if (error) throw error;
        setProgress({ done: paraCriar.length + i + 1, total });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transport_trips"] });
      notify.success(
        `${paraCriar.length} cartão(ões) novo(s), ${paraAtualizar.length} completado(s)`
        + (semMudanca.length ? `, ${semMudanca.length} já estavam completos.` : "."),
      );
      setPreview(null); setProgress(null); onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importar.isPending) { onOpenChange(o); if (!o) { setPreview(null); setProgress(null); } } }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Importar planilha de custos — Transporte</DialogTitle></DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecione o arquivo "Relatorio_Custos_Stepup..." — cada linha da aba "Transporte" primeiro tenta
              completar um cartão já existente (mesma data + colaborador); só cria cartão novo quando não encontra nenhum.
            </p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Escolher arquivo</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Card className="p-3"><p className="text-xs text-muted-foreground">Linhas na planilha</p><p className="text-xl font-semibold">{preview.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Cartões novos</p><p className="text-xl font-semibold text-success">{paraCriar.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Cartões completados</p><p className="text-xl font-semibold text-sky-600">{paraAtualizar.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Já completos</p><p className="text-xl font-semibold text-muted-foreground">{semMudanca.length}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Com erro</p><p className="text-xl font-semibold text-destructive">{invalidas.length}</p></Card>
            </div>
            {nomesNaoEncontradosUnicos.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-warning-foreground"><AlertTriangle className="h-3.5 w-3.5" />{nomesNaoEncontradosUnicos.length} nome(s) não encontrado(s) em Colaboradores (a viagem é importada mesmo assim, com o nome guardado nas observações)</p>
                <p className="text-muted-foreground">{nomesNaoEncontradosUnicos.join(", ")}</p>
              </div>
            )}
            {invalidas.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {invalidas.length} linha(s) não serão importadas (data ou custo inválido) — revise a planilha se o número parecer alto.
              </div>
            )}
            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Data</TableHead><TableHead>Fornecedor</TableHead><TableHead>Funcionário(s)</TableHead><TableHead>Custo</TableHead><TableHead>Situação</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 200).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{p.data}</TableCell>
                      <TableCell className="text-xs">{p.fornecedor}</TableCell>
                      <TableCell className="text-xs">{p.funcionarios}</TableCell>
                      <TableCell className="text-xs">{p.custo != null ? fmtMoney(p.custo) : "—"}</TableCell>
                      <TableCell className="text-xs">
                        {p.erro ? <span className="text-destructive">{p.erro}</span>
                          : p.acao === "cria" ? <span className="text-success">Cria cartão novo</span>
                          : p.acao === "atualiza" ? <span className="text-sky-600">Completa cartão existente</span>
                          : <span className="text-muted-foreground">Cartão já completo</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.length > 200 && <p className="p-2 text-center text-xs text-muted-foreground">Mostrando as primeiras 200 de {preview.length} linhas — a importação processa todas.</p>}
            </div>
            {progress && <p className="text-xs text-muted-foreground">Importando {progress.done}/{progress.total}...</p>}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} disabled={importar.isPending}>Escolher outro arquivo</Button>
              <Button onClick={() => importar.mutate()} loading={importar.isPending} disabled={paraCriar.length + paraAtualizar.length === 0}>
                Confirmar importação ({paraCriar.length + paraAtualizar.length})
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba "Custos" — cascata Cliente → Unidade → BSP, mesmo formato da aba Lançamentos de
// Hospedagem (src/routes/admin/hospedagem.tsx). Uma viagem pode ter até 3 BSPs/clientes/custos
// (bsp/bsp_2/bsp_3) — cada um vira uma "perna" própria na árvore, com o valor já rateado que o
// próprio custo/custo_2/custo_3 representa (não soma custoTotal em mais de um lugar).
type PernaCusto = { trip: Trip; bsp: string; cliente: string; custo: number };
type TripsSortColumn = "data" | "carro" | "unidade" | "bsp" | "custo" | "status";

function buildPernas(trips: Trip[]): PernaCusto[] {
  const pernas: PernaCusto[] = [];
  trips.forEach((t) => {
    const slots: [string | null, string | null, number | null][] = [
      [t.bsp, t.cliente, t.custo], [t.bsp_2, t.cliente_2, t.custo_2], [t.bsp_3, t.cliente_3, t.custo_3],
    ];
    const preenchidos = slots.filter(([bsp, , custo]) => bsp || custo != null);
    if (preenchidos.length === 0) {
      pernas.push({ trip: t, bsp: "Não informado", cliente: t.cliente ?? clienteDaUnidade(t.unidade) ?? t.unidade ?? "Base", custo: custoTotal(t) ?? 0 });
      return;
    }
    preenchidos.forEach(([bsp, cliente, custo]) => {
      pernas.push({
        trip: t, bsp: bsp?.trim() || "Não informado",
        cliente: cliente ?? clienteDaUnidade(t.unidade) ?? t.unidade ?? "Base",
        custo: custo ?? 0,
      });
    });
  });
  return pernas;
}

function CustosTab({ trips }: { trips: Trip[] }) {
  const [periodoDe, setPeriodoDe] = useState(() => `${new Date().toISOString().slice(0, 7)}-01`);
  const [periodoAte, setPeriodoAte] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const { sortColumn, sortDirection, toggleSort } = useTableSort<TripsSortColumn>();

  const filtradas = useMemo(() => trips.filter((t) => {
    const dia = t.scheduled_at.slice(0, 10);
    return (!periodoDe || dia >= periodoDe) && (!periodoAte || dia <= periodoAte) &&
      (filterUnidade === "all" || t.unidade === filterUnidade) &&
      (filterBsp === "all" || [t.bsp, t.bsp_2, t.bsp_3].includes(filterBsp));
  }), [trips, periodoDe, periodoAte, filterUnidade, filterBsp]);

  const ordenadas = useMemo(() => [...filtradas].sort((a, b) => {
    if (!sortColumn) return b.scheduled_at.localeCompare(a.scheduled_at);
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "data": return dir * a.scheduled_at.localeCompare(b.scheduled_at);
      case "carro": return dir * compareCarNumber(a.car_number, b.car_number);
      case "unidade": return dir * (a.unidade ?? "").localeCompare(b.unidade ?? "");
      case "bsp": return dir * (a.bsp ?? "").localeCompare(b.bsp ?? "");
      case "custo": return dir * ((custoTotal(a) ?? 0) - (custoTotal(b) ?? 0));
      case "status": return dir * a.status.localeCompare(b.status);
      default: return 0;
    }
  }), [filtradas, sortColumn, sortDirection]);

  const unidadeOptions = useMemo(
    () => Array.from(new Set(trips.map((t) => t.unidade).filter((u): u is string => !!u))).sort(),
    [trips],
  );
  const bspOptions = useMemo(
    () => Array.from(new Set(trips.flatMap((t) => [t.bsp, t.bsp_2, t.bsp_3]).filter((b): b is string => !!b))).sort(),
    [trips],
  );

  const consolidado = useMemo(() => {
    const porCliente = new Map<string, Map<string, Map<string, PernaCusto[]>>>();
    buildPernas(filtradas).forEach((p) => {
      if (!porCliente.has(p.cliente)) porCliente.set(p.cliente, new Map());
      const porUnidade = porCliente.get(p.cliente)!;
      const unidade = p.trip.unidade ?? "Sem unidade";
      if (!porUnidade.has(unidade)) porUnidade.set(unidade, new Map());
      const porBsp = porUnidade.get(unidade)!;
      if (!porBsp.has(p.bsp)) porBsp.set(p.bsp, []);
      porBsp.get(p.bsp)!.push(p);
    });
    return Array.from(porCliente.entries())
      .map(([cliente, porUnidade]) => {
        const unidades = Array.from(porUnidade.entries())
          .map(([unidade, porBsp]) => {
            const bsps = Array.from(porBsp.entries())
              .map(([bsp, pernas]) => ({
                bsp, total: pernas.reduce((a, p) => a + p.custo, 0),
                itens: [...pernas].sort((a, b) => b.trip.scheduled_at.localeCompare(a.trip.scheduled_at)),
              }))
              .sort((a, b) => b.total - a.total);
            return { unidade, total: bsps.reduce((a, b) => a + b.total, 0), bsps };
          })
          .sort((a, b) => b.total - a.total);
        return { cliente, total: unidades.reduce((a, u) => a + u.total, 0), unidades };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtradas]);
  const [collapsedClientes, setCollapsedClientes] = useState<Set<string>>(new Set());
  const [collapsedUnidades, setCollapsedUnidades] = useState<Set<string>>(new Set());
  const [expandedBsps, setExpandedBsps] = useState<Set<string>>(new Set());
  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - de</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - até</Label>
            <Input type="date" className="h-8 w-36 text-xs" min={periodoDe || undefined} value={periodoAte} onChange={(e) => setPeriodoAte(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={filterUnidade} onValueChange={setFilterUnidade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <Select value={filterBsp} onValueChange={setFilterBsp}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" />Importar planilha de custos
            </Button>
          </div>
        </div>
      </Card>

      {consolidado.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <Button
              type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                const tudoAberto = collapsedClientes.size === 0 && collapsedUnidades.size === 0;
                if (tudoAberto) {
                  setCollapsedClientes(new Set(consolidado.map((c) => c.cliente)));
                  setCollapsedUnidades(new Set(consolidado.flatMap((c) => c.unidades.map((u) => `${c.cliente}::${u.unidade}`))));
                } else {
                  setCollapsedClientes(new Set()); setCollapsedUnidades(new Set());
                }
              }}
            >
              {collapsedClientes.size === 0 && collapsedUnidades.size === 0 ? (
                <><ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />Recolher tudo</>
              ) : (
                <><ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />Expandir tudo</>
              )}
            </Button>
          </div>
          <Card className="overflow-hidden">
            {consolidado.map((c) => {
              const clienteAberto = !collapsedClientes.has(c.cliente);
              return (
                <div key={c.cliente} className="border-b last:border-b-0">
                  <button
                    type="button" className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left"
                    aria-expanded={clienteAberto} onClick={() => toggleSet(setCollapsedClientes, c.cliente)}
                  >
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      {clienteAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <Building2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{c.cliente}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold">{fmtMoney(c.total)}</span>
                  </button>
                  {clienteAberto && c.unidades.map((u) => {
                    const unidadeKey = `${c.cliente}::${u.unidade}`;
                    const unidadeAberta = !collapsedUnidades.has(unidadeKey);
                    return (
                      <div key={unidadeKey}>
                        <button
                          type="button" className="flex w-full items-center justify-between gap-2 border-t bg-sky-50/60 px-4 py-2.5 pl-9 text-left"
                          aria-expanded={unidadeAberta} onClick={() => toggleSet(setCollapsedUnidades, unidadeKey)}
                        >
                          <span className="flex min-w-0 items-center gap-2 font-medium text-sky-950">
                            {unidadeAberta ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                            <Ship className="h-4 w-4 shrink-0 text-sky-700" /><span className="truncate">{u.unidade}</span>
                            {u.bsps.some((b) => b.bsp !== "Não informado") && (
                              <span className="text-xs font-normal text-muted-foreground">({u.bsps.filter((b) => b.bsp !== "Não informado").length} BSP)</span>
                            )}
                          </span>
                          <span className="shrink-0 text-sm font-medium">{fmtMoney(u.total)}</span>
                        </button>
                        {unidadeAberta && u.bsps.map((b) => {
                          if (b.bsp === "Não informado") {
                            return (
                              <div key={`${unidadeKey}::sem-bsp`} className="divide-y border-t bg-emerald-50/40 pl-16">
                                {b.itens.map((p) => (
                                  <div key={`${p.trip.id}-${p.bsp}`} className="flex flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs">
                                    <div className="min-w-0">
                                      <p className="truncate font-medium">{p.trip.car_number}</p>
                                      <p className="text-muted-foreground">{fmtDate(p.trip.scheduled_at)} · {p.trip.origin} → {p.trip.destination}{p.trip.motivo ? ` · ${p.trip.motivo}` : ""}</p>
                                    </div>
                                    <span className="shrink-0 font-semibold">{fmtMoney(p.custo)}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          const bspKey = `${unidadeKey}::${b.bsp}`;
                          const bspAberto = expandedBsps.has(bspKey);
                          return (
                            <div key={bspKey}>
                              <button
                                type="button" className="flex w-full items-center justify-between gap-2 border-t bg-white px-4 py-2.5 pl-16 text-left"
                                aria-expanded={bspAberto} onClick={() => toggleSet(setExpandedBsps, bspKey)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  {bspAberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                  <Layers3 className="h-4 w-4 shrink-0 text-sky-600" /><span className="truncate">{b.bsp}</span>
                                  <span className="text-xs font-normal text-muted-foreground">({b.itens.length})</span>
                                </span>
                                <span className="shrink-0 text-sm">{fmtMoney(b.total)}</span>
                              </button>
                              {bspAberto && (
                                <div className="divide-y border-t bg-emerald-50/40 pl-20">
                                  {b.itens.map((p) => (
                                    <div key={`${p.trip.id}-${p.bsp}`} className="flex flex-wrap items-center justify-between gap-2 py-2 pr-4 text-xs">
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">{p.trip.car_number}</p>
                                        <p className="text-muted-foreground">{fmtDate(p.trip.scheduled_at)} · {p.trip.origin} → {p.trip.destination}{p.trip.motivo ? ` · ${p.trip.motivo}` : ""}</p>
                                      </div>
                                      <span className="shrink-0 font-semibold">{fmtMoney(p.custo)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Data" column="data" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Carro/Fornecedor" column="carro" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Unidade" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead>NF</TableHead>
              <TableHead>Motivo</TableHead>
              <SortableHead label="Custo" column="custo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenadas.length === 0 ? (
              <EmptyStateRow colSpan={8} icon={Wallet} title="Nenhum custo encontrado no período" />
            ) : ordenadas.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.scheduled_at)}</TableCell>
                <TableCell>{t.car_number}</TableCell>
                <TableCell>{t.unidade ?? "—"}</TableCell>
                <TableCell>{[t.bsp, t.bsp_2, t.bsp_3].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell>{t.nf ?? "—"}</TableCell>
                <TableCell>{t.motivo ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{custoTotal(t) != null ? fmtMoney(custoTotal(t)!) : "—"}</TableCell>
                <TableCell>{STATUS_LABEL[t.status]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ImportCustosTransporteDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transport_columns"] }); setName(""); setOpen(false); notify.success("Coluna criada"); },
    onError: (e: any) => notify.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Nova coluna</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova coluna</DialogTitle></DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da coluna" />
        <DialogFooter><Button onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>Criar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Exportação de viagens em Excel foi centralizada no módulo de Relatórios.

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
  const [instanceKey, setInstanceKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

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

  const openEdit = (t: Trip | null) => { setEditing(t); setInstanceKey((k) => k + 1); setDialogOpen(true); };
  const openDuplicate = (t: Trip) => {
    const clone: Trip = { ...t, id: "" };
    setEditing(clone);
    setInstanceKey((k) => k + 1);
    setDialogOpen(true);
    notify.info("Duplicando viagem — ajuste os campos e salve");
  };

  const allTrips = trips.data ?? [];
  const cols = columns.data ?? [];

  const { role } = useAuth();
  const isVisitante = role === "visitante";

  const tab = isVisitante ? "solicitacoes" : (search.tab ?? "kanban");
  const setTab = (v: string) => navigate({ to: "/admin/transport", search: { ...search, tab: v } });

  if (columns.isLoading || trips.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-32" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-3 space-y-2">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-16 w-full" />)}
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Transporte &amp; Rotas</h1>
          {!isVisitante && <p className="text-sm text-muted-foreground">Kanban de viagens, programação do dia, quadro detalhado e linha do tempo.</p>}
        </div>
        {!isVisitante && tab !== "solicitacoes" && tab !== "custos" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-2 h-4 w-4" />Importar planilha de custos</Button>
            <Button onClick={() => openEdit(null)}><Plus className="mr-2 h-4 w-4" />Nova viagem</Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full flex-wrap gap-1 h-auto sm:w-auto sm:inline-flex sm:flex-nowrap">
          <TabsTrigger value="solicitacoes">Solicitação de Transporte</TabsTrigger>
          {!isVisitante && (
            <>
              <TabsTrigger value="kanban">Kanban</TabsTrigger>
              <TabsTrigger value="day">Programado</TabsTrigger>
              <TabsTrigger value="detail">Quadro Detalhado</TabsTrigger>
              <TabsTrigger value="timeline">Linha do Tempo</TabsTrigger>
              <TabsTrigger value="kpi">Dashboard KPI</TabsTrigger>
              <TabsTrigger value="custos">Custos</TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="solicitacoes" className="mt-4">
          <SolicitacoesTab />
        </TabsContent>
        <TabsContent value="kanban" className="mt-4">
          <KanbanView columns={cols} trips={allTrips} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onEdit={openEdit} onDuplicate={openDuplicate} onStatus={(id: string, status: TripStatus) => setStatus.mutate({ id, status })} />
        </TabsContent>
        <TabsContent value="day" className="mt-4">
          <DayView trips={allTrips} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onEdit={openEdit} onDuplicate={openDuplicate} />
        </TabsContent>
        <TabsContent value="detail" className="mt-4">
          <DetailView trips={allTrips} tags={tags} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onEdit={openEdit} onDuplicate={openDuplicate} initialTag={search.tag} initialStatus={search.status} initialCliente={search.cliente} initialTipo={search.tipo} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <TimelineView trips={allTrips} tagsById={tagsById} />
        </TabsContent>
        <TabsContent value="kpi" className="mt-4">
          <KpiDashboard trips={allTrips} tags={tags} tagsById={tagsById} />
        </TabsContent>
        <TabsContent value="custos" className="mt-4">
          <CustosTab trips={allTrips} />
        </TabsContent>
      </Tabs>

      <TripDialog key={instanceKey} trip={editing} columns={cols} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportCustosTransporteDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

// ── Tipos de transporte ───────────────────────────────────────────────────────

const TIPO_LABELS: Record<string, string> = {
  uber:         "Uber",
  veiculo_step: "Veículo STEP",
  locacao_carro:"Locação de Carro",
  future:       "Future",
};

// ── Solicitações tab ──────────────────────────────────────────────────────────

type Solicitacao = {
  id: string;
  created_at: string;
  solicitante: string;
  setor: string;
  centro_custo: string;
  data_hora: string;
  origem: string | null;
  destino: string | null;
  tipos_transporte: string[];
  status: string;
  notes: string | null;
};

function SolicitacaoCard({ s, onUpdate, pendingStatus, canManage = true }: { s: Solicitacao; onUpdate: (args: { id: string; status: string }) => void; pendingStatus?: string; canManage?: boolean }) {
  const borderColor = s.status === "programado" ? "border-l-green-500" : s.status === "cancelado" ? "border-l-destructive" : "border-l-amber-400";
  return (
    <Card className={`p-4 border-l-4 ${borderColor}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <p className="font-semibold text-sm">{s.solicitante}</p>
          <p className="text-xs text-muted-foreground">
            {s.setor} &bull; CC: {s.centro_custo}
          </p>
          <p className="text-xs text-muted-foreground">{fmtDateTime(s.data_hora)}</p>
          {(s.origem || s.destino) && (
            <p className="text-xs text-muted-foreground">
              {s.origem || "—"} <ArrowRight className="inline h-3 w-3 mx-0.5" /> {s.destino || "—"}
            </p>
          )}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {(s.tipos_transporte ?? []).map((t) => (
              <span key={t} className="text-[11px] rounded px-1.5 py-0.5 bg-blue-100 text-blue-800 font-medium">
                {TIPO_LABELS[t] ?? t}
              </span>
            ))}
          </div>
          {s.notes && <p className="text-xs text-muted-foreground italic">{s.notes}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {s.status === "pendente" && canManage && (
            <>
              <Button size="sm" onClick={() => onUpdate({ id: s.id, status: "programado" })} loading={pendingStatus === "programado"}>Programar</Button>
              <Button size="sm" variant="outline" onClick={() => onUpdate({ id: s.id, status: "cancelado" })} loading={pendingStatus === "cancelado"}>Cancelar</Button>
            </>
          )}
          {s.status === "pendente" && !canManage && (
            <span className="text-xs text-amber-700 font-medium">Aguardando programação</span>
          )}
          {s.status === "programado" && (
            <span className="text-xs text-green-700 font-semibold">&#10003; Programado</span>
          )}
          {s.status === "cancelado" && (
            <span className="text-xs text-destructive">Cancelado</span>
          )}
        </div>
      </div>
    </Card>
  );
}

const TIPOS_TRANSP = [
  { id: "uber",          label: "Uber" },
  { id: "veiculo_step",  label: "Veículo STEP" },
  { id: "locacao_carro", label: "Locação de Carro" },
  { id: "future",        label: "Future" },
] as const;

function CriarSolicitacaoDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [solicitante, setSolicitante] = useState("");
  const [setor, setSetor]             = useState("");
  const [centroCusto, setCentroCusto] = useState("");
  const [dataHora, setDataHora]       = useState("");
  const [origem, setOrigem]           = useState("");
  const [destino, setDestino]         = useState("");
  const [tipos, setTipos]             = useState<string[]>([]);
  const [notes, setNotes]             = useState("");

  const toggle = (id: string) =>
    setTipos((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const create = useMutation({
    mutationFn: async () => {
      if (!solicitante.trim() || !setor.trim() || !centroCusto.trim() || !dataHora)
        throw new Error("Preencha todos os campos obrigatórios.");
      if (tipos.length === 0) throw new Error("Selecione ao menos um tipo de transporte.");
      const { error } = await supabase.from("transport_solicitations").insert({
        user_id: user?.id ?? null,
        solicitante: solicitante.trim(),
        setor: setor.trim(),
        centro_custo: centroCusto.trim(),
        data_hora: dataHora,
        origem: origem.trim() || null,
        destino: destino.trim() || null,
        tipos_transporte: tipos,
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Solicitação criada.");
      qc.invalidateQueries({ queryKey: ["transport-solicitations"] });
      setSolicitante(""); setSetor(""); setCentroCusto(""); setDataHora("");
      setOrigem(""); setDestino(""); setTipos([]); setNotes("");
      onSaved();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao criar."),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova Solicitação de Transporte</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Solicitante *</Label>
            <Input placeholder="Nome do solicitante" value={solicitante} onChange={(e) => setSolicitante(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Setor *</Label>
              <Input placeholder="Ex.: Operações" value={setor} onChange={(e) => setSetor(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Centro de Custo *</Label>
              <Input placeholder="Ex.: CC-001" value={centroCusto} onChange={(e) => setCentroCusto(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Data / Hora de programação *</Label>
            <Input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Origem</Label>
              <Input placeholder="Ex.: Macaé" value={origem} onChange={(e) => setOrigem(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Destino</Label>
              <Input placeholder="Ex.: Rio de Janeiro" value={destino} onChange={(e) => setDestino(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Tipo de transporte *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS_TRANSP.map(({ id, label }) => (
                <label key={id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border accent-primary cursor-pointer"
                    checked={tipos.includes(id)}
                    onChange={() => toggle(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Input placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Criar solicitação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SolicitacoesTab() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const { role } = useAuth();
  // Só operador logístico aprova/programa — o visitante só acompanha o status.
  const canManage = role === "logistics_operator";

  const { data: solicitations = [], isLoading } = useQuery<Solicitacao[]>({
    queryKey: ["transport-solicitations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_solicitations")
        .select("*")
        .order("data_hora");
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
    // Poll curto pra quem só acompanha (ex.: visitante) ver o status mudar (aprovado/
    // programado) sem precisar recarregar a página manualmente.
    refetchInterval: 10000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("transport_solicitations")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transport-solicitations"] });
      notify.success("Status atualizado.");
    },
    onError: () => notify.error("Erro ao atualizar."),
  });

  const pending    = solicitations.filter((s) => s.status === "pendente");
  const programmed = solicitations.filter((s) => s.status === "programado");
  const cancelled  = solicitations.filter((s) => s.status === "cancelado");

  if (isLoading) return <div className="flex justify-center py-12"><Plus className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      {/* Header com botão criar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {solicitations.length === 0
            ? "Nenhuma solicitação recebida ainda."
            : `${pending.length} pendente${pending.length !== 1 ? "s" : ""}`}
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova solicitação
        </Button>
      </div>

      {solicitations.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground text-sm">
          Clique em "Nova solicitação" para registrar manualmente, ou aguarde pedidos dos colaboradores.
        </Card>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-amber-700 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-xs font-bold">{pending.length}</span>
                Pendentes
              </h3>
              <div className="space-y-2">
                {pending.map((s) => (
                  <SolicitacaoCard
                    key={s.id}
                    s={s}
                    canManage={canManage}
                    onUpdate={(args) => updateStatus.mutate(args)}
                    pendingStatus={updateStatus.isPending && updateStatus.variables?.id === s.id ? updateStatus.variables.status : undefined}
                  />
                ))}
              </div>
            </div>
          )}
          {programmed.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-green-700">Programadas ({programmed.length})</h3>
              <div className="space-y-2">
                {programmed.map((s) => (
                  <SolicitacaoCard key={s.id} s={s} onUpdate={(args) => updateStatus.mutate(args)} />
                ))}
              </div>
            </div>
          )}
          {cancelled.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Canceladas ({cancelled.length})</h3>
              <div className="space-y-2">
                {cancelled.map((s) => (
                  <SolicitacaoCard key={s.id} s={s} onUpdate={(args) => updateStatus.mutate(args)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <CriarSolicitacaoDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={() => setShowCreate(false)}
      />
    </div>
  );
}

function KanbanView({ columns, trips, tagsById, collabsById, materialsById, onEdit, onStatus, onDuplicate }: any) {
  const byCol = useMemo(() => {
    const m = new Map<string, Trip[]>();
    for (const c of columns as Column[]) m.set(c.id, []);
    for (const t of trips as Trip[]) if (t.column_id && m.has(t.column_id)) m.get(t.column_id)!.push(t);
    for (const list of m.values()) list.sort((a, b) => compareCarNumber(a.car_number, b.car_number));
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
                <TripCard key={t.id} trip={t} tagsById={tagsById} collabsById={collabsById} materialsById={materialsById} onClick={() => onEdit(t)} onStatus={(s) => onStatus(t.id, s)} onDuplicate={onDuplicate ? () => onDuplicate(t) : undefined} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayView({ trips, tagsById, collabsById, materialsById, onEdit, onDuplicate }: any) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const singleDay = from === to;

  const rangeTrips = useMemo(() => (trips as Trip[]).filter((t) => {
    const d = t.scheduled_at.slice(0, 10);
    return d >= from && d <= to;
  }).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)), [trips, from, to]);

  // Agrupa por data primeiro (só some no modo dia único, onde já é óbvio pela barra de cima) e
  // depois por carro dentro de cada data — mesma organização por carro de sempre, só que repetida
  // por dia quando o período tem mais de uma data.
  const groupedByDate = useMemo(() => {
    const m = new Map<string, Trip[]>();
    for (const t of rangeTrips) {
      const d = t.scheduled_at.slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(t);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => {
      const byCar = new Map<string, Trip[]>();
      for (const t of list) {
        if (!byCar.has(t.car_number)) byCar.set(t.car_number, []);
        byCar.get(t.car_number)!.push(t);
      }
      return { data: d, carros: Array.from(byCar.entries()).sort(([a], [b]) => compareCarNumber(a, b)) };
    });
  }, [rangeTrips]);

  const totalCarros = useMemo(() => new Set(rangeTrips.map((t) => t.car_number)).size, [rangeTrips]);

  // Com "De"/"Até" iguais (dia único, o caso mais comum), as setas continuam andando um dia por
  // vez como sempre — com um período selecionado, deslocam as duas pontas mantendo o mesmo
  // tamanho de janela.
  const shift = (n: number) => {
    const df = new Date(from + "T00:00:00"); df.setDate(df.getDate() + n);
    const dt = new Date(to + "T00:00:00"); dt.setDate(dt.getDate() + n);
    setFrom(df.toISOString().slice(0, 10));
    setTo(dt.toISOString().slice(0, 10));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" size="icon" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">De</Label>
          <Input type="date" value={from} onChange={(e) => { const v = e.target.value; setFrom(v); if (v > to) setTo(v); }} className="h-9 w-40" />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Até</Label>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => { const v = e.target.value; setTo(v); if (v < from) setFrom(v); }} className="h-9 w-40" />
        </div>
        <Button variant="outline" size="icon" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm text-muted-foreground">
          {singleDay ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`} · {rangeTrips.length} viagem(ns) · {totalCarros} carro(s)
        </span>
      </div>
      <div className="space-y-8">
        {groupedByDate.map(({ data, carros }) => (
          <div key={data} className="space-y-6">
            {!singleDay && <h2 className="text-sm font-semibold text-foreground">{fmtDate(data)}</h2>}
            {carros.map(([car, list]) => (
              <div key={car} className="space-y-2">
                <div className="flex items-center gap-2 border-b pb-1">
                  <h3 className="text-sm font-semibold">{car}</h3>
                  <span className="text-xs text-muted-foreground">{list.length} viagem(ns)</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => (
                    <Card key={t.id} className={cn("p-3 cursor-pointer hover:border-primary/40 border-l-4", STATUS_BORDER[t.status])} onClick={() => onEdit(t)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">{t.car_number}</div>
                        </div>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t.scheduled_at))} · {t.tipo === "material" ? "Material" : "Pessoas"}{t.cliente ? ` · ${t.cliente}` : ""}</div>
                      {(t.departure_time || t.arrival_time) && (
                        <div className="text-[11px] text-muted-foreground">
                          {t.departure_time && <span>Partida: {t.departure_time}</span>}
                          {t.departure_time && t.arrival_time && <span> · </span>}
                          {t.arrival_time && <span>Destino: {t.arrival_time}</span>}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.tags.map((x) => { const tag = tagsById.get(x.tag_id); return tag && <span key={x.tag_id} className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>; })}
                      </div>
                      {[t.bsp, t.bsp_2, t.bsp_3].some(Boolean) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[t.bsp, t.bsp_2, t.bsp_3].filter(Boolean).map((b, i) => (
                            <span key={`bsp-${i}`} className="inline-block rounded border border-warning/40 bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-warning-foreground">BSP: {b}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 text-sm">{[t.origin, ...(t.origens_extras ?? [])].filter(Boolean).join(" / ")} <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" /> {[t.destination, ...(t.destinos_extras ?? [])].filter(Boolean).join(" / ")}</div>
                      {t.tipo === "pessoas" && t.collabs.length > 0 && <div className="mt-1 text-xs text-muted-foreground truncate">{t.collabs.map((c: any) => collabsById.get(c.collaborator_id)?.full_name).filter(Boolean).join(", ")}</div>}
                      {t.tipo === "material" && t.materials.length > 0 && <div className="mt-1 text-xs text-muted-foreground truncate">{t.materials.map((m: any) => { const mat = materialsById.get(m.material_id); return mat ? `${materialLabel(mat)} ×${m.quantidade ?? 1}` : null; }).filter(Boolean).join(", ")}</div>}
                      {onDuplicate && (
                        <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onDuplicate(t)} title="Duplicar viagem">
                            <Copy className="mr-1 h-3 w-3" />Duplicar
                          </Button>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        {rangeTrips.length === 0 && <Card className="p-4"><EmptyState icon={CalIcon} title="Nenhuma viagem para este período" /></Card>}
      </div>
    </div>
  );
}

// Busca com autocomplete (digitar e escolher da lista) — mesmo padrão do CollaboratorMultiSelect,
// só que single-select, pro filtro por colaborador do Quadro Detalhado.
function ColaboradorFiltroCombobox({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data: collaborators = [] } = useCollaboratorsQuery();
  const [open, setOpen] = useState(false);
  const selected = collaborators.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-48 justify-between font-normal">
          <span className="truncate">{selected ? selected.full_name : "Todos"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(value, search) => (matchesNameSearch(value, search) ? 1 : 0)}>
          <CommandInput placeholder="Buscar colaborador..." />
          <CommandList>
            <CommandEmpty>Nenhum encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="Todos" onSelect={() => { onChange(""); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                Todos
              </CommandItem>
              {collaborators.map((c) => (
                <CommandItem key={c.id} value={c.full_name} onSelect={() => { onChange(c.id); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  {c.full_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DetailView({ trips, tags, tagsById, collabsById, materialsById, onEdit, onDuplicate, initialTag, initialStatus, initialCliente, initialTipo }: any) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tagId, setTagId] = useState(initialTag ?? "all");
  const [status, setStatus] = useState(initialStatus ?? "all");
  const [cliente, setCliente] = useState(initialCliente ?? "all");
  const [tipo, setTipo] = useState(initialTipo ?? "all");
  const [colaboradorId, setColaboradorId] = useState("");

  const filtered = useMemo(() => {
    return (trips as Trip[]).filter((t) => {
      if (from && t.scheduled_at < from) return false;
      if (to && t.scheduled_at > to + "T23:59:59") return false;
      if (tagId !== "all" && !t.tags.some((x) => x.tag_id === tagId)) return false;
      if (status !== "all" && t.status !== status) return false;
      if (cliente !== "all" && t.cliente !== cliente) return false;
      if (tipo !== "all" && t.tipo !== tipo) return false;
      if (colaboradorId && !t.collabs.some((x) => x.collaborator_id === colaboradorId)) return false;
      return true;
    }).sort((a, b) => compareCarNumber(a.car_number, b.car_number));
  }, [trips, from, to, tagId, status, cliente, tipo, colaboradorId]);

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
              <SelectItem value="faturado">Faturado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Colaborador</Label>
          <ColaboradorFiltroCombobox value={colaboradorId} onChange={setColaboradorId} />
        </div>
      </div>
      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Carro</TableHead>
              <TableHead className="hidden md:table-cell">Tipo</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead className="hidden md:table-cell">BSP</TableHead>
              <TableHead className="hidden xl:table-cell">Etiquetas</TableHead>
              <TableHead className="hidden lg:table-cell">Horário</TableHead>
              <TableHead className="hidden lg:table-cell">Origem</TableHead>
              <TableHead className="hidden lg:table-cell">Destino</TableHead>
              <TableHead className="hidden xl:table-cell">Pessoas/Materiais</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Custo</TableHead>
              <TableHead className="hidden w-[1%] xl:table-cell"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => onEdit(t)}>
                <TableCell>{fmtDate(t.scheduled_at)}</TableCell>
                <TableCell>{toDisplayCase(t.car_number)}</TableCell>
                <TableCell className="hidden md:table-cell">{t.tipo === "material" ? "Material" : "Pessoas"}</TableCell>
                <TableCell>{[t.cliente, t.cliente_2, t.cliente_3].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{[t.bsp, t.bsp_2, t.bsp_3].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell className="hidden xl:table-cell"><div className="flex flex-wrap gap-1">{t.tags.map((x) => { const tag = tagsById.get(x.tag_id); return tag && <span key={x.tag_id} className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>; })}</div></TableCell>
                <TableCell className="hidden lg:table-cell">{t.departure_time ? t.departure_time.slice(0, 5) : "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{[t.origin, ...(t.origens_extras ?? [])].filter(Boolean).map(toDisplayCase).join("; ")}</TableCell>
                <TableCell className="hidden lg:table-cell">{[t.destination, ...(t.destinos_extras ?? [])].filter(Boolean).map(toDisplayCase).join("; ")}</TableCell>
                <TableCell className="hidden max-w-[200px] truncate xl:table-cell">
                  {t.tipo === "pessoas"
                    ? t.collabs.map((c: any) => collabsById.get(c.collaborator_id)?.full_name).filter(Boolean).map(toDisplayCase).join(", ")
                    : t.materials.map((m: any) => { const mat = materialsById.get(m.material_id); return mat ? `${toDisplayCase(materialLabel(mat))} ×${m.quantidade ?? 1}` : null; }).filter(Boolean).join(", ")}
                </TableCell>
                <TableCell><StatusBadge status={t.status} /></TableCell>
                <TableCell>{custoTotal(t) != null ? fmtMoney(custoTotal(t)!) : "—"}</TableCell>
                <TableCell className="hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                  {onDuplicate && (
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => onDuplicate(t)} title="Duplicar viagem">
                      <Copy className="mr-1 h-3 w-3" />Duplicar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <EmptyStateRow colSpan={12} icon={Package} title="Sem viagens" description="Ajuste os filtros ou cadastre uma nova viagem." />}
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
    return Array.from(m.entries()).sort(([a], [b]) => compareCarNumber(a, b));
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
          {byCar.length === 0 && <EmptyState icon={Package} title="Sem viagens neste dia" />}
        </div>
      </Card>
    </div>
  );
}

const STATUS_COLOR: Record<TripStatus, string> = {
  em_andamento: "hsl(var(--primary))",
  realizado: "hsl(var(--success))",
  faturado: "#7c3aed",
  cancelado: "hsl(var(--destructive))",
};

const BLUES = ["#1e3a8a", "#1d4ed8", "#1e40af", "#2563eb", "#475569", "#64748b", "#0369a1", "#334155", "#0284c7", "#94a3b8"];
const STATUS_BLUES: Record<string, string> = { realizado: "#1a5c2a", em_andamento: "#b8860b", faturado: "#5b21b6", cancelado: "#c00000" };

// Fatias/barras com cor por item (Cell) não têm uma chave fixa de série pra mapear num
// ChartConfig — fica vazio e o tooltip/legenda padrão do shadcn lê a cor de cada item direto
// do payload (item.payload.fill), igual ao mesmo padrão já usado no Histograma Offshore.
const dynamicChartConfig = {} satisfies ChartConfig;

const monthlyChartConfig = {
  count: { label: "Viagens", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

const tagComparisonChartConfig = {
  pessoas: { label: "Pessoas", color: "var(--color-chart-2)" },
  material: { label: "Material", color: "var(--color-chart-5)" },
} satisfies ChartConfig;

function KpiDashboard({ trips, tags, tagsById }: { trips: Trip[]; tags: Tag[]; tagsById: Map<string, Tag> }) {
  const firstOfMonth = useMemo(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }, []);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayISO());
  const [tagId, setTagId] = useState<string>("all");
  const [tipo, setTipo] = useState<string>("all");

  const filtered = useMemo(() => {
    const a = new Date(`${from}T00:00:00`).getTime();
    const b = new Date(`${to}T23:59:59`).getTime();
    return trips.filter((t) => {
      const ts = new Date(t.scheduled_at).getTime();
      if (ts < a || ts > b) return false;
      if (tagId !== "all" && !t.tags.some((x) => x.tag_id === tagId)) return false;
      if (tipo !== "all" && t.tipo !== tipo) return false;
      return true;
    });
  }, [trips, from, to, tagId, tipo]);

  const total = filtered.length;
  const realizados = filtered.filter((t) => t.status === "realizado").length;
  const emAndamento = filtered.filter((t) => t.status === "em_andamento").length;
  const faturados = filtered.filter((t) => t.status === "faturado").length;
  const cancelados = filtered.filter((t) => t.status === "cancelado").length;

  const avgCarsPerDay = useMemo(() => {
    const byDay = new Map<string, Set<string>>();
    for (const t of filtered) {
      const day = t.scheduled_at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day)!.add(t.car_number);
    }
    if (byDay.size === 0) return 0;
    let sum = 0;
    for (const s of byDay.values()) sum += s.size;
    return Math.round((sum / byDay.size) * 10) / 10;
  }, [filtered]);

  const statusData = [
    { name: "Realizado", value: realizados, color: STATUS_BLUES.realizado },
    { name: "Em Andamento", value: emAndamento, color: STATUS_BLUES.em_andamento },
    { name: "Faturado", value: faturados, color: STATUS_BLUES.faturado },
    { name: "Cancelado", value: cancelados, color: STATUS_BLUES.cancelado },
  ].filter((d) => d.value > 0);

  const monthlyData = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of filtered) {
      const k = t.scheduled_at.slice(0, 7);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
  }, [filtered]);

  const topRoutes = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of filtered) {
      const k = `${t.origin} → ${t.destination}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([rota, count]) => ({ rota, count }));
  }, [filtered]);

  const tagComparison = useMemo(() => {
    const m = new Map<string, { name: string; pessoas: number; material: number }>();
    for (const t of filtered) {
      for (const x of t.tags) {
        const tag = tagsById.get(x.tag_id);
        if (!tag) continue;
        const entry = m.get(tag.id) ?? { name: tag.name, pessoas: 0, material: 0 };
        if (t.tipo === "material") entry.material++; else entry.pessoas++;
        m.set(tag.id, entry);
      }
    }
    return Array.from(m.values());
  }, [filtered, tagsById]);

  const tripsByClient = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of filtered) {
      const k = t.cliente?.trim() || "Step";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cliente, count]) => ({ cliente, count }));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label className="text-xs">De</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">Até</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <Label className="text-xs">Etiqueta</Label>
            <Select value={tagId} onValueChange={setTagId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pessoas">Pessoas</SelectItem>
                <SelectItem value="material">Material</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FadeInView delay={0}>
        <Card className="p-4 border-l-4" style={{ borderLeftColor: "#1e3a8a", background: "linear-gradient(135deg, rgba(30,58,138,0.08), transparent)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Total de transportes</span>
            <TrendingUp className="h-4 w-4" style={{ color: "#1e3a8a" }} />
          </div>
          <div className="mt-2 text-3xl font-semibold" style={{ backgroundImage: "linear-gradient(135deg, #1e3a8a, #5b7fd4)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{total}</div>
        </Card>
        </FadeInView>
        <FadeInView delay={0.05}>
        <Card className="p-4 border-l-4" style={{ borderLeftColor: "#1a5c2a", background: "linear-gradient(135deg, rgba(26,92,42,0.08), transparent)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Realizados</span>
            <CheckCircle2 className="h-4 w-4" style={{ color: "#1a5c2a" }} />
          </div>
          <div className="mt-2 text-3xl font-semibold" style={{ backgroundImage: "linear-gradient(135deg, #1a5c2a, #4ca35f)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{realizados}</div>
        </Card>
        </FadeInView>
        <FadeInView delay={0.1}>
        <Card className="p-4 border-l-4" style={{ borderLeftColor: "#b8860b", background: "linear-gradient(135deg, rgba(184,134,11,0.08), transparent)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Em andamento</span>
            <Activity className="h-4 w-4" style={{ color: "#b8860b" }} />
          </div>
          <div className="mt-2 text-3xl font-semibold" style={{ backgroundImage: "linear-gradient(135deg, #b8860b, #d9a83c)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{emAndamento}</div>
        </Card>
        </FadeInView>
        <FadeInView delay={0.15}>
        <Card className="p-4 border-l-4" style={{ borderLeftColor: "#475569", background: "linear-gradient(135deg, rgba(71,85,105,0.08), transparent)" }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Média de carros/dia</span>
            <TrendingUp className="h-4 w-4" style={{ color: "#475569" }} />
          </div>
          <div className="mt-2 text-3xl font-semibold" style={{ backgroundImage: "linear-gradient(135deg, #475569, #7c8ba1)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{avgCarsPerDay}</div>
        </Card>
        </FadeInView>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-base font-semibold">Distribuição por status</h2>
          <div className="mt-3 h-64">
            {statusData.length === 0 ? <EmptyState icon={Activity} title="Sem dados" className="h-full" /> : (
              <ChartContainer config={dynamicChartConfig} className="aspect-auto h-full w-full">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={50} label={(e: any) => `${e.name}: ${e.value}`}>
                    {statusData.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} />
                  <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                </PieChart>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Evolução mensal</h2>
          <div className="mt-3 h-64">
            {monthlyData.length === 0 ? <EmptyState icon={TrendingUp} title="Sem dados" className="h-full" /> : (
              <ChartContainer config={monthlyChartConfig} className="aspect-auto h-full w-full">
                <AreaChart data={monthlyData}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="var(--color-count)"
                    fill="var(--color-count)"
                    fillOpacity={0.18}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    dot={{ r: 3, fill: "var(--color-count)", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Top rotas por volume</h2>
          <div className="mt-3 h-72">
            {topRoutes.length === 0 ? <EmptyState icon={TrendingUp} title="Sem dados" className="h-full" /> : (
              <ChartContainer config={dynamicChartConfig} className="aspect-auto h-full w-full">
                <BarChart data={topRoutes} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="rota" tickLine={false} axisLine={false} fontSize={10} width={140} />
                  <ChartTooltip cursor={{ fill: "var(--color-muted)" }} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {topRoutes.map((_, i) => <Cell key={i} fill={BLUES[i % BLUES.length]} />)}
                    <LabelList dataKey="count" position="right" fontSize={11} fill="hsl(var(--foreground))" />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Comparativo por etiqueta</h2>
          <div className="mt-3 h-72">
            {tagComparison.length === 0 ? <EmptyState icon={TrendingUp} title="Sem dados" className="h-full" /> : (
              <ChartContainer config={tagComparisonChartConfig} className="aspect-auto h-full w-full">
                <BarChart data={tagComparison}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                  <ChartTooltip cursor={{ fill: "var(--color-muted)" }} content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="pessoas" fill="var(--color-pessoas)" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="pessoas" position="top" fontSize={11} fill="hsl(var(--foreground))" />
                  </Bar>
                  <Bar dataKey="material" fill="var(--color-material)" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="material" position="top" fontSize={11} fill="hsl(var(--foreground))" />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">Quantidade de viagens por cliente</h2>
          <div className="mt-3 h-72">
            {tripsByClient.length === 0 ? <EmptyState icon={TrendingUp} title="Sem dados" className="h-full" /> : (
              <ChartContainer config={dynamicChartConfig} className="aspect-auto h-full w-full">
                <BarChart data={tripsByClient}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="cliente" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
                  <ChartTooltip cursor={{ fill: "var(--color-muted)" }} content={<ChartTooltipContent hideLabel />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {tripsByClient.map((_, i) => <Cell key={i} fill={BLUES[i % BLUES.length]} />)}
                    <LabelList dataKey="count" position="top" fontSize={11} fill="hsl(var(--foreground))" />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
