import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { matchesNameSearch } from "@/lib/utils";
// hoteis_fornecedores/hospedagens ainda não estão nos tipos gerados (types.ts não é
// regerado automaticamente neste projeto — ver mesmo padrão em nominations.tsx); cast local
// para não bloquear o build.
const supabase: any = supabaseTyped;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyStateRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { NomeUsuarioField, MotivoField } from "@/components/LogisticaFormFields";
import { Check, ChevronsUpDown, Plus, Pencil, Trash2, BedDouble, Hotel } from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import { pageTitle } from "@/lib/pageTitle";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import {
  computeDiarias, computeValorTotal, localizacaoHotel,
  type HotelFornecedor, type Hospedagem,
} from "@/lib/hospedagem";

interface HospedagemSearch {
  prefillUnidade?: string;
  prefillBsp?: string;
  prefillNome?: string;
  prefillMotivo?: string;
}

export const Route = createFileRoute("/admin/hospedagem")({
  head: () => pageTitle("Hospedagem"),
  component: HospedagemPage,
  validateSearch: (s: Record<string, unknown>): HospedagemSearch => ({
    prefillUnidade: typeof s.prefillUnidade === "string" ? s.prefillUnidade : undefined,
    prefillBsp: typeof s.prefillBsp === "string" ? s.prefillBsp : undefined,
    prefillNome: typeof s.prefillNome === "string" ? s.prefillNome : undefined,
    prefillMotivo: typeof s.prefillMotivo === "string" ? s.prefillMotivo : undefined,
  }),
});

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function useHoteisQuery() {
  return useQuery<HotelFornecedor[]>({
    queryKey: ["hoteis-fornecedores"],
    queryFn: () => selectAllPages<HotelFornecedor>((from, to) =>
      supabase.from("hoteis_fornecedores").select("*").order("nome").range(from, to),
    ),
  });
}

function useHospedagensQuery() {
  return useQuery<Hospedagem[]>({
    queryKey: ["hospedagens"],
    queryFn: () => selectAllPages<Hospedagem>((from, to) =>
      supabase.from("hospedagens").select("*").order("check_in", { ascending: false }).order("id").range(from, to),
    ),
  });
}

function usePeriodosEQuery() {
  return useQuery<HistNovoPeriodo[]>({
    queryKey: ["hist-novo-periodos"],
    queryFn: () => selectAllPages<HistNovoPeriodo>((from, to) =>
      supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("id").range(from, to),
    ),
  });
}

function useColaboradoresQuery() {
  return useQuery<{ id: string; nome: string }[]>({
    queryKey: ["hist-novo-colaboradores", "ativos", "nomes"],
    queryFn: () => selectAllPages<{ id: string; nome: string }>((from, to) =>
      supabase.from("hist_novo_colaboradores").select("id, nome").eq("ativo", true)
        .order("nome").range(from, to),
    ),
  });
}

// ─── Combobox: Hotel (com cadastro rápido) ─────────────────────────────────
function HotelCombobox({ hoteis, value, onChange }: {
  hoteis: HotelFornecedor[]; value: string; onChange: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ nome: "", cidade: "", estado: "" });
  const selected = hoteis.find((h) => h.id === value);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("hoteis_fornecedores").insert({
        nome: nf.nome.trim(), cidade: nf.cidade.trim(), estado: nf.estado.trim().toUpperCase(),
      }).select("*").single();
      if (error) throw error;
      return data as HotelFornecedor;
    },
    onSuccess: (h: HotelFornecedor) => {
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success("Hotel cadastrado");
      setNf({ nome: "", cidade: "", estado: "" });
      setNewOpen(false);
      onChange(h.id);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
            <span className="truncate">{selected ? selected.nome : "Selecionar hotel"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar hotel..." />
            <CommandList>
              <CommandEmpty>Nenhum hotel encontrado.</CommandEmpty>
              <CommandGroup>
                {hoteis.map((h) => (
                  <CommandItem key={h.id} value={`${h.nome} ${h.cidade}`} onSelect={() => { onChange(h.id); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value === h.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{h.nome}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{localizacaoHotel(h)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setOpen(false); setNewOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />Cadastrar novo hotel
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo hotel</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs">Nome</Label><Input value={nf.nome} onChange={(e) => setNf({ ...nf, nome: e.target.value })} /></div>
            <div><Label className="text-xs">Cidade</Label><Input value={nf.cidade} onChange={(e) => setNf({ ...nf, cidade: e.target.value })} /></div>
            <div><Label className="text-xs">Estado (UF)</Label><Input maxLength={2} value={nf.estado} onChange={(e) => setNf({ ...nf, estado: e.target.value.toUpperCase() })} /></div>
          </div>
          <DialogFooter>
            <Button disabled={!nf.nome.trim() || !nf.cidade.trim() || !nf.estado.trim()} loading={create.isPending} onClick={() => create.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const FORM_VAZIO = {
  unidade: "", bsp: "", nomeUsuario: "", hotelId: "", checkIn: "", checkOut: "",
  valorDiaria: "", motivo: "", observacoes: "",
};

// ─── Dialog: Nova hospedagem / Editar ───────────────────────────────────────
function HospedagemDialog({ open, onOpenChange, editing, prefill, hoteis, periodosE, colaboradores, unidadeOptions }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: Hospedagem | null;
  prefill?: Partial<typeof FORM_VAZIO> | null;
  hoteis: HotelFornecedor[]; periodosE: HistNovoPeriodo[]; colaboradores: { id: string; nome: string }[];
  unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(FORM_VAZIO);
  const [bound, setBound] = useState<string | null>(null);

  if (open && editing && bound !== editing.id) {
    setF({
      unidade: editing.unidade, bsp: editing.bsp, nomeUsuario: editing.nome_usuario, hotelId: editing.hotel_id,
      checkIn: editing.check_in, checkOut: editing.check_out, valorDiaria: String(editing.valor_diaria),
      motivo: editing.motivo ?? "", observacoes: editing.observacoes ?? "",
    });
    setBound(editing.id);
  }
  // Vem preenchido quando aberto a partir de outro módulo (ex.: Passagens Aéreas, ao marcar
  // uma passagem como Cancelada) — só unidade/bsp/nome/motivo, o resto (hotel/datas/valor)
  // continua em branco pra digitação normal.
  if (open && !editing && bound !== "novo") { setF({ ...FORM_VAZIO, ...prefill }); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, f.unidade || "all"), [periodosE, f.unidade]);
  const hotelSelecionado = hoteis.find((h) => h.id === f.hotelId);
  const diarias = f.checkIn && f.checkOut ? computeDiarias(f.checkIn, f.checkOut) : 0;
  const valorTotal = computeValorTotal(diarias, Number(f.valorDiaria) || 0);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.unidade) throw new Error("Selecione a unidade.");
      if (!f.bsp) throw new Error("Selecione o BSP.");
      if (!f.nomeUsuario.trim()) throw new Error("Informe o nome de quem vai usar a hospedagem.");
      if (!f.hotelId) throw new Error("Selecione o hotel.");
      if (!f.checkIn || !f.checkOut) throw new Error("Informe check-in e check-out.");
      if (diarias <= 0) throw new Error("Check-out precisa ser depois do check-in.");
      const payload = {
        unidade: f.unidade, bsp: f.bsp, nome_usuario: f.nomeUsuario.trim(), hotel_id: f.hotelId,
        check_in: f.checkIn, check_out: f.checkOut, diarias, valor_diaria: Number(f.valorDiaria) || 0,
        valor_total: valorTotal, motivo: f.motivo.trim() || null, observacoes: f.observacoes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("hospedagens").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hospedagens").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hospedagens"] });
      notify.success(editing ? "Hospedagem atualizada" : "Hospedagem lançada");
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar hospedagem" : "Nova hospedagem"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Unidade</Label>
              <Select value={f.unidade} onValueChange={(v) => setF({ ...f, unidade: v, bsp: "" })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BSP</Label>
              <Select value={f.bsp} onValueChange={(v) => setF({ ...f, bsp: v })} disabled={!f.unidade}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Nome do usuário</Label>
            <NomeUsuarioField value={f.nomeUsuario} onChange={(v) => setF({ ...f, nomeUsuario: v })} colaboradores={colaboradores} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Hotel</Label>
              <HotelCombobox hoteis={hoteis} value={f.hotelId} onChange={(id) => setF({ ...f, hotelId: id })} />
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Input disabled value={localizacaoHotel(hotelSelecionado)} className="bg-muted" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Check-in</Label>
              <Input type="date" value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Check-out</Label>
              <Input type="date" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Diárias</Label>
              <Input disabled value={diarias} className="bg-muted" />
            </div>
            <div>
              <Label className="text-xs">Valor da diária</Label>
              <Input type="number" step="0.01" min="0" value={f.valorDiaria} onChange={(e) => setF({ ...f, valorDiaria: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Valor total</Label>
              <Input disabled value={fmtMoney(valorTotal)} className="bg-muted" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Motivo</Label>
            <MotivoField value={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} />
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => salvar.mutate()} loading={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aba Lançamentos ────────────────────────────────────────────────────────
type HospedagensSortColumn =
  | "unidade" | "bsp" | "nome_usuario" | "hotel" | "check_in" | "check_out" | "diarias" | "valor_diaria" | "valor_total" | "motivo";

function LancamentosTab({ hoteis, hospedagens, periodosE, colaboradores, unidadeOptions, prefill, onPrefillConsumed }: {
  hoteis: HotelFornecedor[]; hospedagens: Hospedagem[]; periodosE: HistNovoPeriodo[];
  colaboradores: { id: string; nome: string }[]; unidadeOptions: string[];
  prefill?: Partial<typeof FORM_VAZIO> | null; onPrefillConsumed?: () => void;
}) {
  const qc = useQueryClient();
  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [filterHotel, setFilterHotel] = useState("all");
  const [filterMotivo, setFilterMotivo] = useState("all");
  const [filterNome, setFilterNome] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Hospedagem | null>(null);
  const { sortColumn, sortDirection, toggleSort } = useTableSort<HospedagensSortColumn>();

  useEffect(() => {
    if (prefill) { setEditing(null); setDialogOpen(true); onPrefillConsumed?.(); }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const hotelById = useMemo(() => new Map(hoteis.map((h) => [h.id, h])), [hoteis]);
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, filterUnidade), [periodosE, filterUnidade]);

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hospedagens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hospedagens"] });
      notify.success("Hospedagem excluída");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const filtradas = useMemo(() => hospedagens.filter((h) =>
    (filterUnidade === "all" || h.unidade === filterUnidade) &&
    (filterBsp === "all" || h.bsp === filterBsp) &&
    (filterHotel === "all" || h.hotel_id === filterHotel) &&
    (filterMotivo === "all" || (h.motivo ?? "") === filterMotivo) &&
    (!filterNome || matchesNameSearch(h.nome_usuario, filterNome)),
  ).sort((a, b) => {
    // Sem coluna escolhida, mantém a ordem que já vem da consulta (check-in desc, mais recente
    // primeiro — ver useHospedagensQuery).
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "unidade":
        return dir * a.unidade.localeCompare(b.unidade);
      case "bsp":
        return dir * a.bsp.localeCompare(b.bsp);
      case "nome_usuario":
        return dir * a.nome_usuario.localeCompare(b.nome_usuario);
      case "hotel":
        return dir * (hotelById.get(a.hotel_id)?.nome ?? "").localeCompare(hotelById.get(b.hotel_id)?.nome ?? "");
      case "check_in":
        return dir * a.check_in.localeCompare(b.check_in);
      case "check_out":
        return dir * a.check_out.localeCompare(b.check_out);
      case "diarias":
        return dir * (a.diarias - b.diarias);
      case "valor_diaria":
        return dir * (a.valor_diaria - b.valor_diaria);
      case "valor_total":
        return dir * (a.valor_total - b.valor_total);
      case "motivo":
        return dir * (a.motivo ?? "").localeCompare(b.motivo ?? "");
      default:
        return 0;
    }
  }), [hospedagens, filterUnidade, filterBsp, filterHotel, filterMotivo, filterNome, sortColumn, sortDirection, hotelById]);

  const consolidadoPorBsp = useMemo(() => {
    const m = new Map<string, number>();
    filtradas.forEach((h) => m.set(h.bsp, (m.get(h.bsp) ?? 0) + h.valor_total));
    return Array.from(m.entries()).map(([bsp, total]) => ({ bsp, total })).sort((a, b) => b.total - a.total);
  }, [filtradas]);

  const motivosVistos = useMemo(
    () => Array.from(new Set(hospedagens.map((h) => h.motivo).filter((m): m is string => !!m))).sort(),
    [hospedagens],
  );

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Unidade</Label>
            <Select value={filterUnidade} onValueChange={(v) => { setFilterUnidade(v); setFilterBsp("all"); }}>
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
          <div className="space-y-0.5 w-48">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Hotel</Label>
            <Select value={filterHotel} onValueChange={setFilterHotel}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {hoteis.map((h) => <SelectItem key={h.id} value={h.id} className="text-xs">{h.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Motivo</Label>
            <Select value={filterMotivo} onValueChange={setFilterMotivo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {motivosVistos.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-52">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Nome do usuário</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          <div className="ml-auto">
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Nova hospedagem
            </Button>
          </div>
        </div>
      </Card>

      {consolidadoPorBsp.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {consolidadoPorBsp.map((c) => (
            <Card key={c.bsp} className="p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP {c.bsp}</div>
              <div className="mt-1 text-lg font-semibold">{fmtMoney(c.total)}</div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Unidade" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Nome do usuário" column="nome_usuario" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Hotel" column="hotel" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Check-in" column="check_in" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Check-out" column="check_out" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Diárias" column="diarias" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Valor diária" column="valor_diaria" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Valor total" column="valor_total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Motivo" column="motivo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.length === 0 ? (
              <EmptyStateRow colSpan={11} icon={BedDouble} title="Nenhuma hospedagem encontrada" />
            ) : filtradas.map((h) => {
              const hotel = hotelById.get(h.hotel_id);
              return (
                <TableRow key={h.id}>
                  <TableCell>{h.unidade}</TableCell>
                  <TableCell>{h.bsp}</TableCell>
                  <TableCell>{h.nome_usuario}</TableCell>
                  <TableCell>{hotel ? `${hotel.nome} — ${localizacaoHotel(hotel)}` : "—"}</TableCell>
                  <TableCell>{fmt(h.check_in)}</TableCell>
                  <TableCell>{fmt(h.check_out)}</TableCell>
                  <TableCell className="text-right">{h.diarias}</TableCell>
                  <TableCell className="text-right">{fmtMoney(h.valor_diaria)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(h.valor_total)}</TableCell>
                  <TableCell>{h.motivo ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(h); setDialogOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir hospedagem?</AlertDialogTitle>
                            <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(h.id)}>
                              Excluir
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <HospedagemDialog
        open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} prefill={editing ? null : prefill}
        hoteis={hoteis} periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
      />
    </div>
  );
}

// ─── Aba Hotéis (CRUD) ──────────────────────────────────────────────────────
type HoteisSortColumn = "nome" | "cidade" | "estado";

function HoteisTab({ hoteis }: { hoteis: HotelFornecedor[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<HotelFornecedor | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ nome: "", cidade: "", estado: "" });
  const [bound, setBound] = useState<string | null>(null);
  const { sortColumn, sortDirection, toggleSort } = useTableSort<HoteisSortColumn>();

  if (editing && bound !== editing.id) {
    setF({ nome: editing.nome, cidade: editing.cidade, estado: editing.estado });
    setBound(editing.id);
  }
  if (creating && bound !== "novo") { setF({ nome: "", cidade: "", estado: "" }); setBound("novo"); }

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = { nome: f.nome.trim(), cidade: f.cidade.trim(), estado: f.estado.trim().toUpperCase() };
      if (editing) {
        const { error } = await supabase.from("hoteis_fornecedores").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hoteis_fornecedores").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success(editing ? "Hotel atualizado" : "Hotel cadastrado");
      setEditing(null); setCreating(false); setBound(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hoteis_fornecedores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hoteis-fornecedores"] });
      notify.success("Hotel excluído");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const dialogOpen = editing !== null || creating;
  const closeDialog = () => { setEditing(null); setCreating(false); setBound(null); };

  const ordenados = useMemo(() => [...hoteis].sort((a, b) => {
    // Sem coluna escolhida, mantém a ordem que já vem da consulta (nome asc — ver useHoteisQuery).
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "nome":
        return dir * a.nome.localeCompare(b.nome);
      case "cidade":
        return dir * a.cidade.localeCompare(b.cidade);
      case "estado":
        return dir * a.estado.localeCompare(b.estado);
      default:
        return 0;
    }
  }), [hoteis, sortColumn, sortDirection]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" />Novo hotel
        </Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Nome" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Cidade" column="cidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Estado" column="estado" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenados.length === 0 ? (
              <EmptyStateRow colSpan={4} icon={Hotel} title="Nenhum hotel cadastrado" />
            ) : ordenados.map((h) => (
              <TableRow key={h.id}>
                <TableCell>{h.nome}</TableCell>
                <TableCell>{h.cidade}</TableCell>
                <TableCell>{h.estado}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(h)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir hotel?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Hospedagens já lançadas com esse hotel não podem ser excluídas junto — se houver alguma vinculada, a exclusão vai falhar.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(h.id)}>
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar hotel" : "Novo hotel"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs">Nome</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
            <div><Label className="text-xs">Cidade</Label><Input value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} /></div>
            <div><Label className="text-xs">Estado (UF)</Label><Input maxLength={2} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value.toUpperCase() })} /></div>
          </div>
          <DialogFooter>
            <Button disabled={!f.nome.trim() || !f.cidade.trim() || !f.estado.trim()} loading={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Página principal ───────────────────────────────────────────────────────
function HospedagemPage() {
  const { data: hoteis = [], isLoading: l1 } = useHoteisQuery();
  const { data: hospedagens = [], isLoading: l2 } = useHospedagensQuery();
  const { data: periodos = [], isLoading: l3 } = usePeriodosEQuery();
  const { data: colaboradores = [], isLoading: l4 } = useColaboradoresQuery();

  // Vem preenchido quando outro módulo (ex.: Passagens Aéreas, ao marcar uma passagem como
  // Cancelada) navega pra cá pedindo pra abrir o formulário já com unidade/bsp/nome/motivo.
  const search = useSearch({ from: "/admin/hospedagem" });
  const navigate = useNavigate();
  const prefill = useMemo(() => {
    if (!search.prefillUnidade && !search.prefillBsp && !search.prefillNome && !search.prefillMotivo) return null;
    return {
      unidade: search.prefillUnidade ?? "", bsp: search.prefillBsp ?? "",
      nomeUsuario: search.prefillNome ?? "", motivo: search.prefillMotivo ?? "",
    };
  }, [search]);
  const limparPrefill = () => navigate({ to: "/admin/hospedagem", search: {} });

  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);
  const unidadeOptions = useMemo(
    () => Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort(),
    [periodos],
  );

  if (l1 || l2 || l3 || l4) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Card className="p-3">
          <div className="flex gap-2">
            <Skeleton className="h-8 w-44" /><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-48" />
          </div>
        </Card>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead><TableHead>BSP</TableHead><TableHead>Nome</TableHead>
                <TableHead>Hotel</TableHead><TableHead>Check-in</TableHead><TableHead>Check-out</TableHead>
              </TableRow>
            </TableHeader>
            <TableSkeleton rows={6} cols={6} />
          </Table>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex items-center gap-2">
        <BedDouble className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Hospedagem</h1>
      </div>

      <Tabs defaultValue="lancamentos">
        <TabsList>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="hoteis">Hotéis</TabsTrigger>
        </TabsList>
        <TabsContent value="lancamentos" className="mt-4">
          <LancamentosTab
            hoteis={hoteis} hospedagens={hospedagens} periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
            prefill={prefill} onPrefillConsumed={limparPrefill}
          />
        </TabsContent>
        <TabsContent value="hoteis" className="mt-4">
          <HoteisTab hoteis={hoteis} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
