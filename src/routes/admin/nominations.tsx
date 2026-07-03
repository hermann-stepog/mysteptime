import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas nominations/weld_type_config/nomination_status_history ainda não existem no schema;
// cast local para não bloquear o build enquanto a feature não é migrada.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import { getOffshoreData } from "@/lib/api/smartsheet.functions";
import {
  type Nomination, type NominationStatusHistory, type WeldTypeConfig,
  STATUS_LABELS, STATUS_COLORS, ALL_STATUSES, NEXT_ACTION_LABELS,
  getNextStatus, fmtDate, fmtDatetime, isSoldador,
} from "@/lib/nominations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Settings, ChevronRight, CheckCircle2, Clock, User, CalendarDays, Loader2,
  Trash2, Pencil,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/nominations")({ component: NominationsPage });

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const label = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function HistoryTimeline({ items }: { items: NominationStatusHistory[] }) {
  return (
    <ol className="relative border-l border-slate-200 ml-3 space-y-4">
      {[...items].reverse().map((h) => (
        <li key={h.id} className="ml-4">
          <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-slate-400" />
          <StatusBadge status={h.status} />
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{h.changed_by_name}</span>
            {" — "}{fmtDatetime(h.changed_at)}
          </p>
          {h.notes && <p className="mt-0.5 text-xs text-muted-foreground italic">"{h.notes}"</p>}
        </li>
      ))}
    </ol>
  );
}

// ── Available collaborators from Smartsheet ───────────────────────────────────

function AvailableCollabs({ nomination }: { nomination: Nomination }) {
  const { data: people = [], isLoading } = useQuery({
    queryKey: ["offshore-data"],
    queryFn: () => getOffshoreData(),
    staleTime: 5 * 60 * 1000,
  });

  const matches = useMemo(() => {
    const fn = nomination.function_requested.toLowerCase();
    return people
      .filter((p) => p.function?.toLowerCase().includes(fn))
      .filter((p) => {
        // Available if no conflicting embarkation in the period
        const start = nomination.period_start;
        const end   = nomination.period_end;
        const emb1  = p.embark && p.disembark && p.embark <= end && p.disembark >= start;
        const emb2  = p.embark2 && p.disembark2 && p.embark2 <= end && p.disembark2 >= start;
        return !emb1 && !emb2;
      })
      .slice(0, 15);
  }, [people, nomination]);

  if (isLoading) return <p className="text-xs text-muted-foreground">Carregando...</p>;
  if (matches.length === 0) return <p className="text-xs text-muted-foreground">Nenhum colaborador disponível encontrado para esta função e período.</p>;

  return (
    <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
      {matches.map((p) => (
        <li key={p.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
          <span className="font-medium">{p.name}</span>
          <span className="text-xs text-muted-foreground">{p.unit || "—"}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Manage dialog ─────────────────────────────────────────────────────────────

function ManageDialog({
  nomination,
  onClose,
}: {
  nomination: Nomination;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [approvedCollab, setApprovedCollab] = useState(nomination.approved_collaborator_name ?? "");
  const [reqSuperior, setReqSuperior] = useState(nomination.requires_superior_approval);
  const [tab, setTab] = useState("detalhes");

  const { data: history = [] } = useQuery<NominationStatusHistory[]>({
    queryKey: ["nominations", nomination.id, "history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("nomination_status_history")
        .select("*")
        .eq("nomination_id", nomination.id)
        .order("changed_at");
      return (data ?? []) as NominationStatusHistory[];
    },
  });

  const nextStatus = getNextStatus({ ...nomination, requires_superior_approval: reqSuperior });
  const nextLabel  = nextStatus ? (NEXT_ACTION_LABELS[nextStatus] ?? STATUS_LABELS[nextStatus]) : null;
  // Actually, NEXT_ACTION_LABELS keys are the CURRENT status, not next
  const actionLabel = nomination.current_status in NEXT_ACTION_LABELS
    ? NEXT_ACTION_LABELS[nomination.current_status as keyof typeof NEXT_ACTION_LABELS]
    : null;

  const updateSuperiorApproval = useMutation({
    mutationFn: async (val: boolean) => {
      const { error } = await supabase
        .from("nominations")
        .update({ requires_superior_approval: val })
        .eq("id", nomination.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations"] }),
    onError: () => toast.error("Erro ao atualizar."),
  });

  const advanceStatus = useMutation({
    mutationFn: async () => {
      const nom = { ...nomination, requires_superior_approval: reqSuperior };
      const next = getNextStatus(nom);
      if (!next) return;

      const updates: Partial<Nomination> = { current_status: next };
      if (nomination.current_status === "aprovacao_pm_pendente") {
        if (!approvedCollab.trim()) throw new Error("Informe o nome do colaborador aprovado.");
        updates.approved_collaborator_name = approvedCollab.trim();
      }

      const { error: e1 } = await supabase
        .from("nominations")
        .update(updates)
        .eq("id", nomination.id);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("nomination_status_history")
        .insert({
          nomination_id:   nomination.id,
          status:          next,
          changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
          notes:           notes.trim() || null,
        });
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Status atualizado.");
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "history"] });
      setNotes("");
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao avançar status."),
  });

  const handleSuperiorToggle = (val: boolean) => {
    setReqSuperior(val);
    updateSuperiorApproval.mutate(val);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Nomeação — <span className="text-muted-foreground">{nomination.function_requested}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 pt-1">
            <StatusBadge status={nomination.current_status} />
            {nomination.current_status === "embarcado" && (
              <span className="text-xs text-green-700 font-medium">Concluído</span>
            )}
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="colaboradores">Disponíveis</TabsTrigger>
          </TabsList>

          {/* ── Detalhes ── */}
          <TabsContent value="detalhes" className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">PM:</span> <span className="font-medium">{nomination.pm_name}</span></div>
              <div><span className="text-muted-foreground">Função:</span> <span className="font-medium">{nomination.function_requested}</span></div>
              {nomination.weld_type && (
                <div><span className="text-muted-foreground">Tipo de solda:</span> <span className="font-medium">{nomination.weld_type}</span></div>
              )}
              <div><span className="text-muted-foreground">Período:</span> <span className="font-medium">{fmtDate(nomination.period_start)} – {fmtDate(nomination.period_end)}</span></div>
              {nomination.project && (
                <div><span className="text-muted-foreground">Projeto:</span> <span className="font-medium">{nomination.project}</span></div>
              )}
              {nomination.client && (
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{nomination.client}</span></div>
              )}
              {nomination.approved_collaborator_name && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Colaborador aprovado:</span>{" "}
                  <span className="font-semibold text-green-700">{nomination.approved_collaborator_name}</span>
                </div>
              )}
              {nomination.notes && (
                <div className="col-span-2"><span className="text-muted-foreground">Notas:</span> {nomination.notes}</div>
              )}
            </div>

            <Separator />

            {/* Flags condicionais — só editáveis na triagem */}
            <div className="space-y-3">
              {nomination.requires_quality_validation && (
                <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Requer validação da qualidade (tipo de solda)
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="superior" className="text-sm">Requer aprovação de Henrique/Wainer</Label>
                <Switch
                  id="superior"
                  checked={reqSuperior}
                  onCheckedChange={handleSuperiorToggle}
                  disabled={nomination.current_status === "embarcado"}
                />
              </div>
            </div>

            {nomination.current_status !== "embarcado" && actionLabel && (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Próxima ação</p>

                  {nomination.current_status === "aprovacao_pm_pendente" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="collab" className="text-sm">Colaborador aprovado pelo PM *</Label>
                      <Input
                        id="collab"
                        placeholder="Nome do colaborador"
                        value={approvedCollab}
                        onChange={(e) => setApprovedCollab(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="notes" className="text-sm">Observações (opcional)</Label>
                    <Textarea
                      id="notes"
                      rows={2}
                      placeholder="Adicione uma observação para o histórico..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => advanceStatus.mutate()}
                    disabled={advanceStatus.isPending}
                  >
                    {advanceStatus.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {actionLabel}
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Histórico ── */}
          <TabsContent value="historico" className="pt-2">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum histórico ainda.</p>
            ) : (
              <HistoryTimeline items={history} />
            )}
          </TabsContent>

          {/* ── Disponíveis ── */}
          <TabsContent value="colaboradores" className="pt-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              Colaboradores com função compatível e sem embarque conflitante no período.
            </p>
            <AvailableCollabs nomination={nomination} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateDialog({
  onClose,
  weldConfig,
}: {
  onClose: () => void;
  weldConfig: WeldTypeConfig[];
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const [pmName, setPmName]         = useState("");
  const [fn, setFn]                 = useState("");
  const [weldType, setWeldType]     = useState("");
  const [start, setStart]           = useState("");
  const [end, setEnd]               = useState("");
  const [project, setProject]       = useState("");
  const [client, setClient]         = useState("");
  const [notes, setNotes]           = useState("");

  const showWeld = isSoldador(fn);
  const requiresQuality = showWeld
    ? weldConfig.find((w) => w.weld_type_name === weldType)?.requires_quality_validation ?? false
    : false;

  const create = useMutation({
    mutationFn: async () => {
      if (!pmName.trim() || !fn.trim() || !start || !end) {
        throw new Error("Preencha PM, função e período.");
      }
      const { data, error } = await supabase
        .from("nominations")
        .insert({
          pm_name:                    pmName.trim(),
          function_requested:         fn.trim(),
          weld_type:                  showWeld ? weldType || null : null,
          period_start:               start,
          period_end:                 end,
          project:                    project.trim() || null,
          client:                     client.trim() || null,
          notes:                      notes.trim() || null,
          requires_quality_validation: requiresQuality,
        })
        .select()
        .single();
      if (error) throw error;

      // Initial history entry
      await supabase.from("nomination_status_history").insert({
        nomination_id:   data.id,
        status:          "triagem_pendente",
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes:           "Solicitação criada",
      });
    },
    onSuccess: () => {
      toast.success("Nomeação criada.");
      qc.invalidateQueries({ queryKey: ["nominations"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao criar."),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Nomeação</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>PM solicitante *</Label>
            <Input placeholder="Nome do PM" value={pmName} onChange={(e) => setPmName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Função solicitada *</Label>
            <Input placeholder="Ex.: Soldador, Mecânico, Eletricista" value={fn} onChange={(e) => setFn(e.target.value)} />
          </div>
          {showWeld && (
            <div className="space-y-1">
              <Label>Tipo de solda</Label>
              {weldConfig.length > 0 ? (
                <Select value={weldType} onValueChange={setWeldType}>
                  <SelectTrigger><SelectValue placeholder="Selecione o tipo de solda" /></SelectTrigger>
                  <SelectContent>
                    {weldConfig.map((w) => (
                      <SelectItem key={w.id} value={w.weld_type_name}>
                        {w.weld_type_name}
                        {w.requires_quality_validation && " (requer qualidade)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  placeholder="Tipo de solda (nenhum configurado ainda)"
                  value={weldType}
                  onChange={(e) => setWeldType(e.target.value)}
                />
              )}
              {requiresQuality && (
                <p className="text-xs text-amber-700 font-medium">
                  Este tipo de solda exige validação da qualidade.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Período — início *</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Período — fim *</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Projeto</Label>
              <Input placeholder="Ex.: Proj. X" value={project} onChange={(e) => setProject(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Cliente</Label>
              <Input placeholder="Ex.: SBM" value={client} onChange={(e) => setClient(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Observações</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar nomeação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Weld config settings ──────────────────────────────────────────────────────

function WeldConfigPanel() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: weldConfig = [] } = useQuery<WeldTypeConfig[]>({
    queryKey: ["weld-type-config"],
    queryFn: async () => {
      const { data } = await supabase.from("weld_type_config").select("*").order("weld_type_name");
      return (data ?? []) as WeldTypeConfig[];
    },
  });

  const addWeld = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Informe o nome do tipo de solda.");
      const { error } = await supabase.from("weld_type_config").insert({ weld_type_name: newName.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["weld-type-config"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleQuality = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase
        .from("weld_type_config")
        .update({ requires_quality_validation: val })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weld-type-config"] }),
    onError: () => toast.error("Erro ao atualizar."),
  });

  const removeWeld = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("weld_type_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weld-type-config"] }),
    onError: () => toast.error("Erro ao remover."),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure quais tipos de solda exigem validação do setor de qualidade antes de avançar no fluxo.
      </p>

      <div className="flex gap-2">
        <Input
          placeholder="Nome do tipo de solda (ex.: TIG, MIG)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addWeld.mutate()}
          className="max-w-xs"
        />
        <Button onClick={() => addWeld.mutate()} disabled={addWeld.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>

      {weldConfig.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum tipo de solda configurado.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {weldConfig.map((w) => (
            <div key={w.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium">{w.weld_type_name}</span>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={w.requires_quality_validation}
                    onCheckedChange={(val) =>
                      toggleQuality.mutate({ id: w.id, val: !!val })
                    }
                  />
                  Exige validação da qualidade
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => removeWeld.mutate(w.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function NominationsPage() {
  const [selected, setSelected]       = useState<Nomination | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("todos");
  const [search, setSearch]           = useState("");

  const { data: nominations = [], isLoading } = useQuery<Nomination[]>({
    queryKey: ["nominations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nominations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Nomination[];
    },
  });

  const { data: weldConfig = [] } = useQuery<WeldTypeConfig[]>({
    queryKey: ["weld-type-config"],
    queryFn: async () => {
      const { data } = await supabase.from("weld_type_config").select("*").order("weld_type_name");
      return (data ?? []) as WeldTypeConfig[];
    },
  });

  const filtered = useMemo(() => {
    let list = nominations;
    if (filterStatus !== "todos") list = list.filter((n) => n.current_status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.pm_name.toLowerCase().includes(q) ||
          n.function_requested.toLowerCase().includes(q) ||
          (n.project ?? "").toLowerCase().includes(q) ||
          (n.client ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [nominations, filterStatus, search]);

  // Count pending (not embarcado)
  const pendingCount = nominations.filter((n) => n.current_status !== "embarcado").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Nomeações</h1>
          <p className="text-sm text-muted-foreground">
            {pendingCount > 0 ? `${pendingCount} em andamento` : "Nenhuma nomeação em andamento"}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova Nomeação
        </Button>
      </div>

      <Tabs defaultValue="nomeacoes">
        <TabsList>
          <TabsTrigger value="nomeacoes">Nomeações</TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="mr-1.5 h-3.5 w-3.5" /> Configurações
          </TabsTrigger>
        </TabsList>

        {/* ── Lista de nomeações ── */}
        <TabsContent value="nomeacoes" className="space-y-4 pt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Buscar PM, função, projeto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs h-8 text-sm"
            />
            <select
              className="rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="todos">Todos os status</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground text-sm">
              Nenhuma nomeação encontrada.
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((nom) => (
                <Card
                  key={nom.id}
                  className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelected(nom)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{nom.function_requested}</span>
                        {nom.weld_type && (
                          <span className="text-xs text-muted-foreground">• {nom.weld_type}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {nom.pm_name}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {fmtDate(nom.period_start)} – {fmtDate(nom.period_end)}
                        </span>
                        {nom.client && <span>{nom.client}</span>}
                        {nom.project && <span>{nom.project}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={nom.current_status} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  {nom.approved_collaborator_name && (
                    <div className="mt-2 text-xs text-green-700 font-medium">
                      ✓ Colaborador: {nom.approved_collaborator_name}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Configurações ── */}
        <TabsContent value="config" className="pt-4">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Tipos de Solda</h2>
            <WeldConfigPanel />
          </Card>
        </TabsContent>
      </Tabs>

      {selected && (
        <ManageDialog
          nomination={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {showCreate && (
        <CreateDialog
          weldConfig={weldConfig}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
