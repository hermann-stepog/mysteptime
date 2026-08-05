import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas ainda não migradas (transport_solicitations/nominations/weld_type_config); cast local.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import {
  type Nomination, type NominationStatusHistory, type WeldTypeConfig,
  STATUS_LABELS, STATUS_BADGE, ALL_STATUSES,
  fmtDate, fmtDatetime, isSoldador,
} from "@/lib/nominations";
import { selectAllPages } from "@/lib/supabasePaginate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, CalendarDays, ChevronRight, Loader2 } from "lucide-react";
import { notify } from "@/lib/notify";
import { EmptyState } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/pm/")({ head: () => pageTitle("Minhas Solicitações"), component: PmHome });

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Nomination["current_status"] }) {
  const label = STATUS_LABELS[status] ?? status;
  const c = STATUS_BADGE[status] ?? { bg: "#f1f5f9", text: "#334155" };
  return (
    <span
      className="inline-flex items-center rounded-full border border-black/5 px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {label}
    </span>
  );
}

// ── Status timeline (simplified for PM view) ──────────────────────────────────

function NominationDetail({ nom }: { nom: Nomination }) {
  const { data: history = [] } = useQuery<NominationStatusHistory[]>({
    queryKey: ["pm-nomination-history", nom.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("nomination_status_history")
        .select("*")
        .eq("nomination_id", nom.id)
        .order("changed_at");
      return (data ?? []) as NominationStatusHistory[];
    },
  });

  return (
    <Dialog open>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{nom.colaborador_nome} — <span className="text-muted-foreground">{nom.funcao}</span></DialogTitle>
          <StatusBadge status={nom.current_status} />
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            {nom.period_start && nom.period_end && (
              <div><span className="text-muted-foreground">Período:</span> {fmtDate(nom.period_start)} – {fmtDate(nom.period_end)}</div>
            )}
            {nom.client && <div><span className="text-muted-foreground">Cliente:</span> {nom.client}</div>}
            {nom.project && <div><span className="text-muted-foreground">Projeto:</span> {nom.project}</div>}
            {nom.weld_type && <div><span className="text-muted-foreground">Tipo de solda:</span> {nom.weld_type}</div>}
            {nom.notes && <div className="col-span-2 text-muted-foreground italic">{nom.notes}</div>}
          </div>

          {history.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
              <ol className="relative border-l border-slate-200 ml-3 space-y-3">
                {[...history].reverse().map((h) => (
                  <li key={h.id} className="ml-4">
                    <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-slate-400" />
                    <StatusBadge status={h.status} />
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fmtDatetime(h.changed_at)}
                    </p>
                    {h.notes && <p className="text-xs text-muted-foreground italic">"{h.notes}"</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

interface PmColaborador {
  id: string;
  nome: string;
  funcao: string | null;
  funcao_operacao: string | null;
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();

  const [colaboradorId, setColaboradorId] = useState("");
  const [fn, setFn]             = useState("");
  const [weldType, setWeldType] = useState("");
  const [start, setStart]       = useState("");
  const [end, setEnd]           = useState("");
  const [project, setProject]   = useState("");
  const [client, setClient]     = useState("");
  const [notes, setNotes]       = useState("");

  const { data: weldConfig = [] } = useQuery<WeldTypeConfig[]>({
    queryKey: ["weld-type-config"],
    queryFn: async () => {
      const { data } = await supabase.from("weld_type_config").select("*").order("weld_type_name");
      return (data ?? []) as WeldTypeConfig[];
    },
  });

  const { data: colaboradores = [] } = useQuery<PmColaborador[]>({
    queryKey: ["pm-create-nomination-colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hist_novo_colaboradores")
        .select("id, nome, funcao, funcao_operacao")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as PmColaborador[];
    },
  });

  const { data: funcoesHistorico = [] } = useQuery<{ colaborador_id: string; funcao: string }[]>({
    queryKey: ["pm-create-nomination-funcoes-historico"],
    queryFn: () =>
      selectAllPages((from, to) =>
        supabase
          .from("colaborador_funcoes_historico")
          .select("colaborador_id, funcao")
          .order("data_inicio", { ascending: false })
          .range(from, to),
      ),
  });

  const colaborador = colaboradores.find((c) => c.id === colaboradorId);
  const funcaoOptions = useMemo(() => {
    if (!colaboradorId) return [];
    const doColaborador: string[] = [];
    funcoesHistorico.forEach((f) => {
      if (f.colaborador_id === colaboradorId && f.funcao && !doColaborador.includes(f.funcao)) {
        doColaborador.push(f.funcao);
      }
    });
    if (doColaborador.length > 0) return doColaborador;
    const fallback = colaborador?.funcao_operacao || colaborador?.funcao;
    return fallback ? [fallback] : [];
  }, [colaboradorId, funcoesHistorico, colaborador]);

  const handleSelectColaborador = (id: string) => {
    setColaboradorId(id);
    const c = colaboradores.find((x) => x.id === id);
    const doColaborador = funcoesHistorico.find((f) => f.colaborador_id === id)?.funcao;
    setFn(doColaborador || c?.funcao_operacao || c?.funcao || "");
    setWeldType("");
  };

  const showWeld = isSoldador(fn);
  const requiresQuality = showWeld
    ? weldConfig.find((w) => w.weld_type_name === weldType)?.requires_quality_validation ?? false
    : false;

  const create = useMutation({
    mutationFn: async () => {
      if (!colaborador) throw new Error("Selecione o colaborador.");
      if (!fn.trim()) throw new Error("Selecione a função.");
      const pmName = profile?.full_name ?? profile?.email ?? "PM";

      const { data, error } = await supabase
        .from("nominations")
        .insert({
          pm_user_id:                 user!.id,
          pm_name:                    pmName,
          colaborador_id:              colaborador.id,
          colaborador_nome:            colaborador.nome,
          funcao:                      fn.trim(),
          weld_type:                  showWeld ? weldType || null : null,
          period_start:               start || null,
          period_end:                 end || null,
          project:                    project.trim() || null,
          client:                     client.trim() || null,
          notes:                      notes.trim() || null,
          requires_quality_validation: requiresQuality,
          current_status:              "solicitacao",
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from("nomination_status_history").insert({
        nomination_id:   data.id,
        status:          "solicitacao",
        changed_by_name: pmName,
        notes:           "Solicitação criada pelo PM",
      });
    },
    onSuccess: () => {
      notify.success("Solicitação enviada.");
      qc.invalidateQueries({ queryKey: ["pm-nominations"] });
      onClose();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao criar solicitação."),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Solicitação de Nomeação</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Colaborador *</Label>
            <Select value={colaboradorId} onValueChange={handleSelectColaborador}>
              <SelectTrigger><SelectValue placeholder="Selecione o colaborador" /></SelectTrigger>
              <SelectContent>
                {colaboradores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {colaboradorId && (
            <div className="space-y-1">
              <Label>Função *</Label>
              {funcaoOptions.length > 1 ? (
                <Select value={fn} onValueChange={(v) => { setFn(v); setWeldType(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione a função" /></SelectTrigger>
                  <SelectContent>
                    {funcaoOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : funcaoOptions.length === 1 ? (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">{funcaoOptions[0]}</div>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhuma função no histórico deste colaborador.</p>
              )}
            </div>
          )}
          {showWeld && (
            <div className="space-y-1">
              <Label>Tipo de solda</Label>
              {weldConfig.length > 0 ? (
                <Select value={weldType} onValueChange={setWeldType}>
                  <SelectTrigger><SelectValue placeholder="Selecione o tipo de solda" /></SelectTrigger>
                  <SelectContent>
                    {weldConfig.map((w) => (
                      <SelectItem key={w.id} value={w.weld_type_name}>{w.weld_type_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input placeholder="Tipo de solda" value={weldType} onChange={(e) => setWeldType(e.target.value)} />
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Data início *</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data fim *</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Projeto</Label>
              <Input placeholder="Nome do projeto" value={project} onChange={(e) => setProject(e.target.value)} />
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
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Enviar solicitação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── PM home ───────────────────────────────────────────────────────────────────

function PmHome() {
  const { user, profile } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected]     = useState<Nomination | null>(null);
  const [filterStatus, setFilter]   = useState("todos");

  const { data: nominations = [], isLoading } = useQuery<Nomination[]>({
    queryKey: ["pm-nominations", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nominations")
        .select("*")
        .eq("pm_user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Nomination[];
    },
    enabled: !!user,
  });

  const visible = filterStatus === "todos"
    ? nominations
    : nominations.filter((n) => n.current_status === filterStatus);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Minhas Solicitações</h1>
          <p className="text-sm text-muted-foreground">
            Olá, {profile?.full_name?.split(" ")[0] ?? "PM"} — acompanhe o status de cada solicitação abaixo.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova solicitação
        </Button>
      </div>

      <div className="flex gap-2">
        <select
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          value={filterStatus}
          onChange={(e) => setFilter(e.target.value)}
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
      ) : visible.length === 0 ? (
        <Card className="p-4">
          {nominations.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Você ainda não tem solicitações" action={{ label: "Nova solicitação", onClick: () => setShowCreate(true) }} />
          ) : (
            <EmptyState icon={CalendarDays} title="Nenhuma solicitação com este status" />
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((nom) => (
            <Card
              key={nom.id}
              className="p-4 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelected(nom)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <p className="font-semibold text-sm">{nom.colaborador_nome}</p>
                  <p className="text-xs text-muted-foreground">{nom.funcao}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    {nom.period_start && nom.period_end && (
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {fmtDate(nom.period_start)} – {fmtDate(nom.period_end)}
                      </span>
                    )}
                    {nom.client && <span>{nom.client}</span>}
                    {nom.project && <span>{nom.project}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={nom.current_status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateDialog onClose={() => setShowCreate(false)} />}
      {selected && (
        <div onClick={() => setSelected(null)}>
          <NominationDetail nom={selected} />
        </div>
      )}
    </div>
  );
}
