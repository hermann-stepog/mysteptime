import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
import { matchesNameSearch } from "@/lib/utils";
// passagens_aereas ainda não está nos tipos gerados (mesmo padrão de hospedagem.tsx/
// nominations.tsx) — cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyStateRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { NomeUsuarioField, MotivoField } from "@/components/LogisticaFormFields";
import { Plane, Plus, Pencil, Trash2, BedDouble } from "lucide-react";
import { notify } from "@/lib/notify";
import { pageTitle } from "@/lib/pageTitle";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { TIPOS_PASSAGEM, STATUS_PASSAGEM, type PassagemAerea } from "@/lib/passagensAereas";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";

export const Route = createFileRoute("/admin/passagens-aereas")({ head: () => pageTitle("Passagens Aéreas"), component: PassagensAereasPage });

function fmt(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_BADGE: Record<string, "default" | "destructive" | "secondary"> = {
  Confirmada: "default", Cancelada: "destructive", Remarcada: "secondary",
};

type PassagensSortColumn = "unidade" | "bsp" | "nome" | "companhia" | "origemDestino" | "ida" | "volta" | "tipo" | "valor" | "status" | "motivo";

// Ordem de prioridade lógica do status (não alfabética) — Confirmada (ativa) antes de
// Remarcada, e Cancelada (estado terminal) por último.
const STATUS_PASSAGEM_ORDER: Record<string, number> = { Confirmada: 0, Remarcada: 1, Cancelada: 2 };

function usePassagensQuery() {
  return useQuery<PassagemAerea[]>({
    queryKey: ["passagens-aereas"],
    queryFn: () => selectAllPages<PassagemAerea>((from, to) =>
      supabase.from("passagens_aereas").select("*").order("data_ida", { ascending: false }).order("id").range(from, to),
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

const FORM_VAZIO = {
  unidade: "", bsp: "", nomeUsuario: "", companhiaAerea: "", origem: "", destino: "",
  dataIda: "", dataVolta: "", tipo: "Ida e Volta", valor: "", status: "Confirmada",
  motivo: "", motivoCancelamento: "", observacoes: "",
};

// ─── Dialog: Nova passagem / Editar ─────────────────────────────────────────
function PassagemDialog({ open, onOpenChange, editing, periodosE, colaboradores, unidadeOptions }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: PassagemAerea | null;
  periodosE: HistNovoPeriodo[]; colaboradores: { id: string; nome: string }[]; unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(FORM_VAZIO);
  const [bound, setBound] = useState<string | null>(null);

  if (open && editing && bound !== editing.id) {
    setF({
      unidade: editing.unidade, bsp: editing.bsp, nomeUsuario: editing.nome_usuario,
      companhiaAerea: editing.companhia_aerea ?? "", origem: editing.origem ?? "", destino: editing.destino ?? "",
      dataIda: editing.data_ida, dataVolta: editing.data_volta ?? "", tipo: editing.tipo,
      valor: String(editing.valor), status: editing.status, motivo: editing.motivo ?? "",
      motivoCancelamento: editing.motivo_cancelamento ?? "", observacoes: editing.observacoes ?? "",
    });
    setBound(editing.id);
  }
  if (open && !editing && bound !== "novo") { setF(FORM_VAZIO); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, f.unidade || "all"), [periodosE, f.unidade]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.unidade) throw new Error("Selecione a unidade.");
      if (!f.bsp) throw new Error("Selecione o BSP.");
      if (!f.nomeUsuario.trim()) throw new Error("Informe o nome de quem vai utilizar.");
      if (!f.dataIda) throw new Error("Informe a data de ida.");
      if (!f.valor) throw new Error("Informe o valor.");
      const payload = {
        unidade: f.unidade, bsp: f.bsp, nome_usuario: f.nomeUsuario.trim(),
        companhia_aerea: f.companhiaAerea.trim() || null, origem: f.origem.trim() || null, destino: f.destino.trim() || null,
        data_ida: f.dataIda, data_volta: f.dataVolta || null, tipo: f.tipo, valor: Number(f.valor) || 0,
        status: f.status, motivo: f.motivo.trim() || null,
        motivo_cancelamento: f.status === "Cancelada" ? (f.motivoCancelamento.trim() || null) : null,
        observacoes: f.observacoes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("passagens_aereas").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("passagens_aereas").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagens-aereas"] });
      notify.success(editing ? "Passagem atualizada" : "Passagem lançada");
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar passagem" : "Nova passagem"}</DialogTitle></DialogHeader>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Companhia aérea</Label>
              <Input value={f.companhiaAerea} onChange={(e) => setF({ ...f, companhiaAerea: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Origem</Label>
              <Input value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Destino</Label>
              <Input value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data de ida</Label>
              <Input type="date" value={f.dataIda} onChange={(e) => setF({ ...f, dataIda: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Data de volta (opcional)</Label>
              <Input type="date" value={f.dataVolta} onChange={(e) => setF({ ...f, dataVolta: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={f.tipo} onValueChange={(v) => setF({ ...f, tipo: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS_PASSAGEM.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor</Label>
              <Input type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_PASSAGEM.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Motivo</Label>
            <MotivoField value={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} />
          </div>
          {f.status === "Cancelada" && (
            <div>
              <Label className="text-xs">Motivo do cancelamento</Label>
              <Input value={f.motivoCancelamento} onChange={(e) => setF({ ...f, motivoCancelamento: e.target.value })} />
            </div>
          )}
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

// ─── Página ─────────────────────────────────────────────────────────────────
function PassagensAereasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: passagens = [], isLoading: l1 } = usePassagensQuery();
  const { data: periodos = [], isLoading: l2 } = usePeriodosEQuery();
  const { data: colaboradores = [], isLoading: l3 } = useColaboradoresQuery();

  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);
  const unidadeOptions = useMemo(
    () => Array.from(new Set([
      ...UNIDADES_OPERACIONAIS_FIXAS,
      ...periodos.map((p) => p.unidade_operacional).filter((u): u is string => !!u),
    ])).sort(),
    [periodos],
  );

  const [filterUnidade, setFilterUnidade] = useState("all");
  const [filterBsp, setFilterBsp] = useState("all");
  const [filterMotivo, setFilterMotivo] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterNome, setFilterNome] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PassagemAerea | null>(null);

  // Ordenação clicável no cabeçalho — aplicada só nos dados já filtrados na tela. Sem coluna
  // escolhida, mantém a ordem padrão vinda da consulta (data de ida mais recente primeiro).
  const { sortColumn, sortDirection, toggleSort } = useTableSort<PassagensSortColumn>();

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, filterUnidade), [periodosE, filterUnidade]);
  const motivosVistos = useMemo(
    () => Array.from(new Set(passagens.map((p) => p.motivo).filter((m): m is string => !!m))).sort(),
    [passagens],
  );

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("passagens_aereas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passagens-aereas"] });
      notify.success("Passagem excluída");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const filtradas = useMemo(() => passagens.filter((p) =>
    (filterUnidade === "all" || p.unidade === filterUnidade) &&
    (filterBsp === "all" || p.bsp === filterBsp) &&
    (filterMotivo === "all" || (p.motivo ?? "") === filterMotivo) &&
    (filterStatus === "all" || p.status === filterStatus) &&
    (!filterNome || matchesNameSearch(p.nome_usuario, filterNome)),
  ).sort((a, b) => {
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "unidade":
        return dir * a.unidade.localeCompare(b.unidade);
      case "bsp":
        return dir * a.bsp.localeCompare(b.bsp);
      case "nome":
        return dir * a.nome_usuario.localeCompare(b.nome_usuario);
      case "companhia":
        return dir * (a.companhia_aerea ?? "").localeCompare(b.companhia_aerea ?? "");
      case "origemDestino":
        return dir * `${a.origem ?? ""} ${a.destino ?? ""}`.localeCompare(`${b.origem ?? ""} ${b.destino ?? ""}`);
      case "ida":
        return dir * a.data_ida.localeCompare(b.data_ida);
      case "volta":
        return dir * (a.data_volta ?? "").localeCompare(b.data_volta ?? "");
      case "tipo":
        return dir * a.tipo.localeCompare(b.tipo);
      case "valor":
        return dir * (a.valor - b.valor);
      case "status":
        return dir * (STATUS_PASSAGEM_ORDER[a.status] - STATUS_PASSAGEM_ORDER[b.status]);
      case "motivo":
        return dir * (a.motivo ?? "").localeCompare(b.motivo ?? "");
      default:
        return 0;
    }
  }), [passagens, filterUnidade, filterBsp, filterMotivo, filterStatus, filterNome, sortColumn, sortDirection]);

  const consolidadoPorBsp = useMemo(() => {
    const m = new Map<string, number>();
    filtradas.forEach((p) => m.set(p.bsp, (m.get(p.bsp) ?? 0) + p.valor));
    return Array.from(m.entries()).map(([bsp, total]) => ({ bsp, total })).sort((a, b) => b.total - a.total);
  }, [filtradas]);

  const criarHospedagemVinculada = (p: PassagemAerea) => {
    navigate({
      to: "/admin/hospedagem",
      search: { prefillUnidade: p.unidade, prefillBsp: p.bsp, prefillNome: p.nome_usuario, prefillMotivo: "Voo Cancelado" },
    });
  };

  if (l1 || l2 || l3) {
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
                <TableHead>Origem/Destino</TableHead><TableHead>Ida</TableHead><TableHead>Volta</TableHead>
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
        <Plane className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Passagens Aéreas</h1>
      </div>

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
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {STATUS_PASSAGEM.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-52">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Nome do usuário</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          <div className="ml-auto">
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Nova passagem
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
              <SortableHead label="Nome do usuário" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Companhia" column="companhia" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Origem → Destino" column="origemDestino" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Ida" column="ida" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Volta" column="volta" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Tipo" column="tipo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Valor" column="valor" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
              <SortableHead label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHead label="Motivo" column="motivo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.length === 0 ? (
              <EmptyStateRow colSpan={12} icon={Plane} title="Nenhuma passagem encontrada" />
            ) : filtradas.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.unidade}</TableCell>
                <TableCell>{p.bsp}</TableCell>
                <TableCell>{p.nome_usuario}</TableCell>
                <TableCell>{p.companhia_aerea ?? "—"}</TableCell>
                <TableCell>{p.origem || p.destino ? `${p.origem ?? "—"} → ${p.destino ?? "—"}` : "—"}</TableCell>
                <TableCell>{fmt(p.data_ida)}</TableCell>
                <TableCell>{fmt(p.data_volta)}</TableCell>
                <TableCell>{p.tipo}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(p.valor)}</TableCell>
                <TableCell><Badge variant={STATUS_BADGE[p.status] ?? "secondary"}>{p.status}</Badge></TableCell>
                <TableCell>{p.motivo ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {p.status === "Cancelada" && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7" title="Criar hospedagem vinculada"
                        onClick={() => criarHospedagemVinculada(p)}
                      >
                        <BedDouble className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(p); setDialogOpen(true); }}>
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
                          <AlertDialogTitle>Excluir passagem?</AlertDialogTitle>
                          <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(p.id)}>
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

      <PassagemDialog
        open={dialogOpen} onOpenChange={setDialogOpen} editing={editing}
        periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
      />
    </div>
  );
}
