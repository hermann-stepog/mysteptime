import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas nominations/weld_type_config/nomination_status_history/colaborador_funcoes_historico
// ainda não estão nos tipos gerados; cast local para não bloquear o build.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import {
  type Nomination, type NominationStatusHistory, type WeldTypeConfig, type NominationStatus,
  STATUS_LABELS, STATUS_BADGE, ALL_STATUSES, KANBAN_COLUMNS,
  columnIdForStatus, canMoveToColumn, fmtDate, fmtDatetime, isSoldador,
} from "@/lib/nominations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Plus, Settings, ChevronRight, CheckCircle2, Clock, User, CalendarDays, Loader2,
  Trash2,
} from "lucide-react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { notify } from "@/lib/notify";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";
import {
  generateDateRange, todayStr, weekdayAbbr, addDays, computeDayStatus, getComputedColor, getComputedLabel,
  displayAbbr, getContrastText, STATUS_COLOR, STATUS_LABEL, DRAKE_DATA_CUTOFF, type ComputedStatus, type HistNovoPeriodo,
} from "@/lib/histogramaNovo";
import { selectAllPages } from "@/lib/supabasePaginate";

export const Route = createFileRoute("/admin/nominations")({ head: () => pageTitle("Nomeações"), component: NominationsPage });

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: NominationStatus }) {
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

  const toggleQualityValidated = useMutation({
    mutationFn: async (val: boolean) => {
      const { error } = await supabase.from("nominations").update({ quality_validated: val }).eq("id", nomination.id);
      if (error) throw error;
      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id,
        status: nomination.current_status,
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes: val ? "Validação de Qualidade marcada" : "Validação de Qualidade desmarcada",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "history"] });
    },
    onError: () => notify.error("Erro ao atualizar."),
  });

  const toggleBriefing = useMutation({
    mutationFn: async (val: boolean) => {
      const { error } = await supabase
        .from("nominations")
        .update({ briefing_sms_realizado: val, current_status: val ? "apto" : "briefing_sms" })
        .eq("id", nomination.id);
      if (error) throw error;
      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id,
        status: val ? "apto" : "briefing_sms",
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes: val ? "Briefing SMS realizado" : "Briefing SMS desmarcado",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "history"] });
      notify.success("Atualizado.");
    },
    onError: () => notify.error("Erro ao atualizar."),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("nominations").delete().eq("id", nomination.id);
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("Nomeação excluída.");
      qc.invalidateQueries({ queryKey: ["nominations"] });
      onClose();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao excluir nomeação."),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 pr-6">
            <DialogTitle className="text-base">
              {nomination.colaborador_nome} — <span className="text-muted-foreground">{nomination.funcao}</span>
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                if (confirm("Excluir definitivamente esta nomeação? Esta ação não pode ser desfeita.")) {
                  remove.mutate();
                }
              }}
              loading={remove.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <StatusBadge status={nomination.current_status} />
            {nomination.current_status === "apto" && (
              <span className="text-xs text-green-700 font-medium">Apto — processo concluído</span>
            )}
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          {/* ── Detalhes ── */}
          <TabsContent value="detalhes" className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Colaborador:</span> <span className="font-medium">{nomination.colaborador_nome}</span></div>
              <div><span className="text-muted-foreground">Função:</span> <span className="font-medium">{nomination.funcao}</span></div>
              {nomination.pm_name && (
                <div><span className="text-muted-foreground">PM:</span> <span className="font-medium">{nomination.pm_name}</span></div>
              )}
              {nomination.weld_type && (
                <div><span className="text-muted-foreground">Tipo de solda:</span> <span className="font-medium">{nomination.weld_type}</span></div>
              )}
              {nomination.period_start && nomination.period_end && (
                <div><span className="text-muted-foreground">Período:</span> <span className="font-medium">{fmtDate(nomination.period_start)} – {fmtDate(nomination.period_end)}</span></div>
              )}
              {nomination.project && (
                <div><span className="text-muted-foreground">Projeto:</span> <span className="font-medium">{nomination.project}</span></div>
              )}
              {nomination.client && (
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{nomination.client}</span></div>
              )}
              {nomination.notes && (
                <div className="col-span-2"><span className="text-muted-foreground">Notas:</span> {nomination.notes}</div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              {nomination.requires_quality_validation && (
                <label className="flex items-center justify-between gap-2 rounded-md bg-purple-50 border border-purple-200 px-3 py-2 text-sm text-purple-900 cursor-pointer">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Validação de Qualidade (tipo de solda exige)
                  </span>
                  <Checkbox
                    checked={nomination.quality_validated}
                    onCheckedChange={(val) => toggleQualityValidated.mutate(!!val)}
                  />
                </label>
              )}
              <label className="flex items-center justify-between gap-2 rounded-md bg-teal-50 border border-teal-200 px-3 py-2 text-sm text-teal-900 cursor-pointer">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Briefing SMS realizado
                </span>
                <Checkbox
                  checked={nomination.briefing_sms_realizado}
                  onCheckedChange={(val) => toggleBriefing.mutate(!!val)}
                />
              </label>
            </div>
          </TabsContent>

          {/* ── Histórico ── */}
          <TabsContent value="historico" className="pt-2">
            {history.length === 0 ? (
              <EmptyState icon={Clock} title="Nenhum histórico ainda" />
            ) : (
              <HistoryTimeline items={history} />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Create dialog ─────────────────────────────────────────────────────────────

interface CreateColaborador {
  id: string;
  nome: string;
  funcao: string | null;
  funcao_operacao: string | null;
}

function CreateDialog({
  onClose,
  weldConfig,
}: {
  onClose: () => void;
  weldConfig: WeldTypeConfig[];
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();

  const { data: pmOptions = [] } = useQuery({
    queryKey: ["projects-pm-list"],
    queryFn: async () =>
      (await supabase.from("projects").select("*, clients(name)").eq("active", true).order("name")).data ?? [],
  });

  const { data: colaboradores = [] } = useQuery<CreateColaborador[]>({
    queryKey: ["create-nomination-colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hist_novo_colaboradores")
        .select("id, nome, funcao, funcao_operacao")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CreateColaborador[];
    },
  });

  // Mesma fonte usada no droplist de função da aba Simulação — histórico real por embarque
  // (importado do Access), mais completo que o valor único hoje em timesheet_embarques.
  const { data: funcoesHistorico = [] } = useQuery<{ colaborador_id: string; funcao: string }[]>({
    queryKey: ["create-nomination-funcoes-historico"],
    queryFn: () =>
      selectAllPages((from, to) =>
        supabase
          .from("colaborador_funcoes_historico")
          .select("colaborador_id, funcao")
          .order("data_inicio", { ascending: false })
          .range(from, to),
      ),
  });

  const [colaboradorId, setColaboradorId] = useState("");
  const [funcao, setFuncao]         = useState("");
  const [weldType, setWeldType]     = useState("");
  const [pmName, setPmName]         = useState("");
  const [start, setStart]           = useState("");
  const [end, setEnd]               = useState("");
  const [project, setProject]       = useState("");
  const [client, setClient]         = useState("");
  const [notes, setNotes]           = useState("");

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
    setFuncao(doColaborador || c?.funcao_operacao || c?.funcao || "");
    setWeldType("");
  };

  const showWeld = isSoldador(funcao);
  const requiresQuality = showWeld
    ? weldConfig.find((w) => w.weld_type_name === weldType)?.requires_quality_validation ?? false
    : false;

  const create = useMutation({
    mutationFn: async () => {
      if (!colaborador) throw new Error("Selecione o colaborador.");
      if (!funcao.trim()) throw new Error("Selecione a função.");

      const { data, error } = await supabase
        .from("nominations")
        .insert({
          colaborador_id:              colaborador.id,
          colaborador_nome:            colaborador.nome,
          funcao:                      funcao.trim(),
          pm_name:                     pmName.trim() || null,
          weld_type:                   showWeld ? weldType || null : null,
          period_start:                start || null,
          period_end:                  end || null,
          project:                     project.trim() || null,
          client:                      client.trim() || null,
          notes:                       notes.trim() || null,
          requires_quality_validation: requiresQuality,
          current_status:              "solicitacao",
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from("nomination_status_history").insert({
        nomination_id:   data.id,
        status:          "solicitacao",
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes:           "Nomeação criada",
      });
    },
    onSuccess: () => {
      notify.success("Nomeação criada.");
      qc.invalidateQueries({ queryKey: ["nominations"] });
      onClose();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao criar."),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Nomeação</DialogTitle>
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
                <Select value={funcao} onValueChange={(v) => { setFuncao(v); setWeldType(""); }}>
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
              <Label className="text-xs">Tipo de solda</Label>
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
                  Este tipo de solda exige validação da qualidade (aparece como etapa em Aprovação Técnica).
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label>PM solicitante</Label>
            {pmOptions.length > 0 ? (
              <Select value={pmName} onValueChange={setPmName}>
                <SelectTrigger><SelectValue placeholder="Selecione o PM/Responsável" /></SelectTrigger>
                <SelectContent>
                  {pmOptions.map((p: any) => (
                    <SelectItem key={p.id} value={p.name}>
                      {p.name}{p.clients?.name ? ` — ${p.clients.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input placeholder="Nome do PM" value={pmName} onChange={(e) => setPmName(e.target.value)} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Período — início</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Período — fim</Label>
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
          <Button onClick={() => create.mutate()} loading={create.isPending}>
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
    onError: (err: Error) => notify.error(err.message),
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
    onError: () => notify.error("Erro ao atualizar."),
  });

  const removeWeld = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("weld_type_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weld-type-config"] }),
    onError: () => notify.error("Erro ao remover."),
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
        <Button onClick={() => addWeld.mutate()} loading={addWeld.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>

      {weldConfig.length === 0 ? (
        <EmptyState icon={Settings} title="Nenhum tipo de solda configurado" description="Adicione um tipo acima pra começar." />
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
                  loading={removeWeld.isPending && removeWeld.variables === w.id}
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

// ── Kanban de Nomeações ────────────────────────────────────────────────────────
// 6 colunas fixas (ver KANBAN_COLUMNS em src/lib/nominations.ts). Card arrastável via
// dnd-kit; o único bloqueio de avanço é sair de "Aprovação Técnica" sem a Validação de
// Qualidade marcada, quando o tipo de solda exige (ver canMoveToColumn). "Apto" não tem
// coluna própria — fica dentro de "Briefing SMS", com um selo de concluído.

function NominationCard({
  nomination,
  highlighted,
  onOpen,
}: {
  nomination: Nomination;
  highlighted: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: nomination.id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  const isApto = nomination.current_status === "apto";

  return (
    <div
      id={`kanban-card-${nomination.id}`}
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`cursor-grab rounded-lg border bg-background p-3 shadow-sm transition-shadow active:cursor-grabbing hover:shadow-md ${
        isDragging ? "opacity-40" : ""
      } ${highlighted ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight">{nomination.colaborador_nome}</p>
        {isApto && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{nomination.funcao}</p>
      {nomination.requires_quality_validation && (
        <span
          className={`mt-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
            nomination.quality_validated
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {nomination.quality_validated ? "Qualidade validada" : "Qualidade pendente"}
        </span>
      )}
    </div>
  );
}

function KanbanColumn({
  columnId,
  label,
  bg,
  text,
  nominations,
  highlightedId,
  onOpen,
}: {
  columnId: NominationStatus;
  label: string;
  bg: string;
  text: string;
  nominations: Nomination[];
  highlightedId: string | null;
  onOpen: (n: Nomination) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  return (
    <div className="flex w-64 shrink-0 flex-col rounded-lg border bg-muted/20">
      <div
        className="rounded-t-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide"
        style={{ backgroundColor: bg, color: text }}
      >
        {label} <span className="font-normal opacity-70">({nominations.length})</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2 p-2 min-h-[120px] transition-colors ${isOver ? "bg-primary/5" : ""}`}
      >
        {nominations.map((n) => (
          <NominationCard
            key={n.id}
            nomination={n}
            highlighted={highlightedId === n.id}
            onOpen={() => onOpen(n)}
          />
        ))}
        {nominations.length === 0 && (
          <p className="py-4 text-center text-[11px] text-muted-foreground/60">Nenhum card</p>
        )}
      </div>
    </div>
  );
}

function KanbanBoard({
  nominations,
  highlightedId,
  onOpen,
}: {
  nominations: Nomination[];
  highlightedId: string | null;
  onOpen: (n: Nomination) => void;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const move = useMutation({
    mutationFn: async ({ nomination, target }: { nomination: Nomination; target: NominationStatus }) => {
      const patch: Partial<Nomination> = { current_status: target };
      if (target !== "briefing_sms" && target !== "apto") patch.briefing_sms_realizado = false;
      const { error } = await supabase.from("nominations").update(patch).eq("id", nomination.id);
      if (error) throw error;
      await supabase.from("nomination_status_history").insert({
        nomination_id:   nomination.id,
        status:          target,
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes:           null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations"] }),
    onError: (err: Error) => notify.error(err.message || "Erro ao mover nomeação."),
  });

  const byColumn = useMemo(() => {
    const m = new Map<NominationStatus, Nomination[]>();
    KANBAN_COLUMNS.forEach((c) => m.set(c.id, []));
    nominations.forEach((n) => {
      const col = columnIdForStatus(n.current_status);
      m.get(col)?.push(n);
    });
    return m;
  }, [nominations]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const nomination = nominations.find((n) => n.id === active.id);
    const target = over.id as NominationStatus;
    if (!nomination || nomination.current_status === target) return;

    const gate = canMoveToColumn(nomination, target);
    if (!gate.ok) {
      notify.error(gate.reason ?? "Não é possível mover este card.");
      return;
    }
    move.mutate({ nomination, target });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map((c) => (
          <KanbanColumn
            key={c.id}
            columnId={c.id}
            label={c.label}
            bg={c.bg}
            text={c.text}
            nominations={byColumn.get(c.id) ?? []}
            highlightedId={highlightedId}
            onOpen={onOpen}
          />
        ))}
      </div>
    </DndContext>
  );
}

// ── Simulação de disponibilidade ───────────────────────────────────────────────
// Status por dia vem do MESMO motor usado no Histograma Offshore (computeDayStatus, sobre
// hist_novo_periodos) — cobre Embarcado/Férias/Folga/Atestado/Trabalho Externo/Hotel/etc.,
// não só embarque. Função por colaborador continua vindo de timesheet_embarques (mesma base
// do Timesheet Offshore) e do cadastro (hist_novo_colaboradores). Não cria nenhuma fonte de
// dado paralela.

// Os 3 status "de negócio" pedidos pela usuária (cartões/filtro) — um colaborador cai aqui só
// quando TODOS os dias do período são de um desses tipos; quem tem qualquer dia de
// Férias/Folga/Atestado/Trabalho Externo/Hotel/Programado no meio cai em "outro" e por isso
// deixa de ser contado como disponível (era o bug relatado: afastado aparecia como disponível).
type SimBucket = "disponivel" | "embarcado" | "desembarca" | "outro";
type SimStatus = "disponivel" | "embarcado" | "desembarca";

const SIM_STATUS_LABEL: Record<SimStatus, string> = {
  disponivel: "Disponível",
  embarcado: "Embarcado",
  desembarca: "Desembarca",
};

// Histórico real de função por embarque (importado do relatório Access — ver migração
// colaborador_funcoes_historico) — só alimenta o droplist/filtro de função aqui, não altera
// nem substitui timesheet_embarques.funcao_embarque (que continua alimentando o BM).
interface FuncaoHistoricoRow {
  colaborador_id: string;
  funcao: string;
  data_inicio: string;
}

interface SimColaborador {
  id: string;
  nome: string;
  funcao: string | null;
  funcao_operacao: string | null;
}

function defaultSimEnd(start: string): string {
  return addDays(start, 6);
}

function SimulacaoTab() {
  const hoje = todayStr();
  const [periodoDe, setPeriodoDe] = useState(hoje);
  const [periodoAte, setPeriodoAte] = useState(() => defaultSimEnd(hoje));
  const [filterFuncao, setFilterFuncao] = useState("all");
  const [filterStatus, setFilterStatus] = useState<SimStatus | "all">("all");
  const [searchNome, setSearchNome] = useState("");
  // Só pra visualização/simulação nessa tela — nunca grava em nenhuma tabela.
  const [funcaoOverride, setFuncaoOverride] = useState<Record<string, string>>({});

  const { data: colaboradores = [] } = useQuery<SimColaborador[]>({
    queryKey: ["sim-colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hist_novo_colaboradores")
        .select("id, nome, funcao, funcao_operacao")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as SimColaborador[];
    },
  });

  // Todos os períodos (Embarque, Férias, Folga, Atestado, etc.) de todos os colaboradores —
  // mesma tabela/critério de corte (DRAKE_DATA_CUTOFF) já usados no Histograma Offshore.
  // Não dá pra filtrar só pelo período exibido: o cálculo de Desembarque olha o dia seguinte
  // ao fim de um embarque, que pode cair fora da janela filtrada.
  const { data: periodosTodos = [] } = useQuery<HistNovoPeriodo[]>({
    queryKey: ["sim-periodos-todos"],
    queryFn: () =>
      selectAllPages<HistNovoPeriodo>((from, to) =>
        supabase
          .from("hist_novo_periodos")
          .select("*")
          .gte("data_fim", DRAKE_DATA_CUTOFF)
          .order("data_inicio")
          .range(from, to),
      ),
  });

  // Histórico de função do ano vigente (todo o ano, não só o período filtrado) — alimenta o
  // droplist de função por colaborador e as opções do filtro de Função no topo. Vem do Access
  // (mais completo que timesheet_embarques.funcao_embarque, que foi achatado por um backfill
  // anterior pra um valor único por colaborador).
  const { data: funcoesHistorico = [] } = useQuery<FuncaoHistoricoRow[]>({
    queryKey: ["sim-funcoes-historico-ano-vigente"],
    queryFn: () => {
      const ano = new Date().getFullYear();
      return selectAllPages<FuncaoHistoricoRow>((from, to) =>
        supabase
          .from("colaborador_funcoes_historico")
          .select("colaborador_id, funcao, data_inicio")
          .gte("data_inicio", `${ano}-01-01`)
          .lte("data_inicio", `${ano}-12-31`)
          .order("data_inicio", { ascending: false })
          .range(from, to),
      );
    },
  });

  const periodosPorColaborador = useMemo(() => {
    const m = new Map<string, HistNovoPeriodo[]>();
    periodosTodos.forEach((p) => {
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodosTodos]);

  // Já vem ordenado por data_inicio desc (mais recente primeiro) pela query.
  const funcoesAnoPorColaborador = useMemo(() => {
    const m = new Map<string, string[]>();
    funcoesHistorico.forEach((e) => {
      if (!e.funcao) return;
      if (!m.has(e.colaborador_id)) m.set(e.colaborador_id, []);
      const arr = m.get(e.colaborador_id)!;
      if (!arr.includes(e.funcao)) arr.push(e.funcao);
    });
    return m;
  }, [funcoesHistorico]);

  const funcaoOptions = useMemo(
    () => Array.from(new Set(funcoesHistorico.map((e) => e.funcao).filter((f): f is string => !!f))).sort(),
    [funcoesHistorico],
  );

  const dates = useMemo(
    () => (periodoDe && periodoAte && periodoDe <= periodoAte ? generateDateRange(periodoDe, periodoAte) : []),
    [periodoDe, periodoAte],
  );

  const linhasBase = useMemo(() => {
    return colaboradores
      .map((c) => {
        const periodos = periodosPorColaborador.get(c.id) ?? [];
        const funcoesAno = funcoesAnoPorColaborador.get(c.id) ?? [];
        const funcaoPadrao = funcoesAno[0] || c.funcao_operacao || c.funcao || "—";
        const funcao = funcaoOverride[c.id] ?? funcaoPadrao;
        const statusPorDia = dates.map((d) => computeDayStatus(periodos, d));
        const codigos = statusPorDia.map((r) => r.status);
        const temDesembarque = codigos.includes("DES");
        const temEmbarcado = codigos.some((s) => s === "E" || s === "DB");
        const todosDisponivel = codigos.every((s) => s === "STB");
        const bucket: SimBucket = temDesembarque ? "desembarca" : temEmbarcado ? "embarcado" : todosDisponivel ? "disponivel" : "outro";
        return { colaborador: c, funcao, funcoesAno, statusPorDia, bucket };
      })
      .filter((l) => filterFuncao === "all" || l.funcao === filterFuncao)
      .filter((l) => !searchNome.trim() || l.colaborador.nome.toLowerCase().includes(searchNome.trim().toLowerCase()))
      .sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome));
  }, [colaboradores, periodosPorColaborador, funcoesAnoPorColaborador, dates, funcaoOverride, filterFuncao, searchNome]);

  // Grid principal ainda respeita o filtro de Status; os cartões por função abaixo, não —
  // eles precisam mostrar a disponibilidade de TODO mundo daquela função, senão filtrar por
  // "Embarcado" zeraria a lista de disponíveis em todos os cartões.
  const linhas = useMemo(
    () => linhasBase.filter((l) => filterStatus === "all" || l.bucket === filterStatus),
    [linhasBase, filterStatus],
  );

  const cardCounts = useMemo(() => ({
    disponiveis: linhas.filter((l) => l.bucket === "disponivel").length,
    embarcados: linhas.filter((l) => l.bucket === "embarcado").length,
    desembarcam: linhas.filter((l) => l.bucket === "desembarca").length,
  }), [linhas]);

  // Cartões por função: quantos disponíveis em cada função, com os nomes — cruza sempre com
  // TODOS os status (não só quem passou no filtro de Status acima). "Disponível" aqui já exclui
  // quem está de férias/folga/atestado/etc. (bucket "outro"), não só quem está embarcado.
  const funcaoCards = useMemo(() => {
    const m = new Map<string, { total: number; disponiveis: string[] }>();
    linhasBase.forEach((l) => {
      if (!m.has(l.funcao)) m.set(l.funcao, { total: 0, disponiveis: [] });
      const g = m.get(l.funcao)!;
      g.total++;
      if (l.bucket === "disponivel") g.disponiveis.push(l.colaborador.nome);
    });
    return Array.from(m.entries())
      .map(([funcao, v]) => ({ funcao, total: v.total, disponiveis: v.disponiveis.sort() }))
      .sort((a, b) => b.disponiveis.length - a.disponiveis.length || a.funcao.localeCompare(b.funcao));
  }, [linhasBase]);

  // Legenda dinâmica — só os status que realmente aparecem na grade filtrada, na ordem em que
  // o motor do Histograma já prioriza (STB/E/DES primeiro, cobre os 3 status "de negócio").
  const legendaStatus = useMemo(() => {
    const presentes = new Set<ComputedStatus>();
    linhas.forEach((l) => l.statusPorDia.forEach((r) => presentes.add(r.status)));
    const ordem: ComputedStatus[] = ["STB", "E", "DES", "DB", "FI", "F", "FE", "AT", "TE", "HTL", "DDN", "P"];
    return ordem.filter((s) => presentes.has(s));
  }, [linhas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - de</Label>
          <Input type="date" className="h-8 w-40 text-xs" value={periodoDe} onChange={(e) => setPeriodoDe(e.target.value)} />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - até</Label>
          <Input type="date" className="h-8 w-40 text-xs" value={periodoAte} onChange={(e) => setPeriodoAte(e.target.value)} />
        </div>
        <div className="space-y-0.5 w-56">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
          <Input
            placeholder="Buscar por nome..."
            className="h-8 text-xs"
            value={searchNome}
            onChange={(e) => setSearchNome(e.target.value)}
          />
        </div>
        <div className="space-y-0.5 w-56">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Função</Label>
          <Select value={filterFuncao} onValueChange={setFilterFuncao}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todas</SelectItem>
              {funcaoOptions.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-0.5 w-44">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as SimStatus | "all")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos</SelectItem>
              <SelectItem value="disponivel" className="text-xs">Disponível</SelectItem>
              <SelectItem value="embarcado" className="text-xs">Embarcado</SelectItem>
              <SelectItem value="desembarca" className="text-xs">Desembarca</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Disponíveis no período</p>
          <p className="mt-1 text-2xl font-semibold">{cardCounts.disponiveis}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Embarcados no período</p>
          <p className="mt-1 text-2xl font-semibold">{cardCounts.embarcados}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Desembarcam no período</p>
          <p className="mt-1 text-2xl font-semibold">{cardCounts.desembarcam}</p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {legendaStatus.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-sm border px-1 text-[10px] font-bold"
              style={{ backgroundColor: STATUS_COLOR[s], color: getContrastText(STATUS_COLOR[s]) }}
            >
              {displayAbbr(s)}
            </span>
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 top-0 z-20 w-56 bg-background">Colaborador</TableHead>
              {dates.map((d) => (
                <TableHead key={d} className="sticky top-0 z-10 bg-background text-center text-[10px] whitespace-nowrap">
                  {weekdayAbbr(d)} {d.slice(8, 10)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.colaborador.id}>
                <TableCell className="sticky left-0 z-10 bg-background align-top">
                  <p className="text-sm font-medium">{l.colaborador.nome}</p>
                  {l.funcoesAno.length > 1 ? (
                    <Select
                      value={l.funcao}
                      onValueChange={(v) => setFuncaoOverride((prev) => ({ ...prev, [l.colaborador.id]: v }))}
                    >
                      <SelectTrigger className="mt-1 h-6 w-48 text-[10px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {l.funcoesAno.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">{l.funcao}</p>
                  )}
                </TableCell>
                {l.statusPorDia.map((r, i) => {
                  const bg = getComputedColor(r);
                  return (
                    <TableCell key={dates[i]} className="p-0 text-center" style={{ backgroundColor: bg }} title={getComputedLabel(r)}>
                      <div className="flex h-10 items-center justify-center text-xs font-bold" style={{ color: getContrastText(bg) }}>
                        {displayAbbr(r.status)}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {linhas.length === 0 && <EmptyStateRow colSpan={dates.length + 1} icon={User} title="Nenhum colaborador encontrado" />}
          </TableBody>
        </Table>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Disponíveis por função</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {funcaoCards.map((f) => (
            <Card key={f.funcao} className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{f.funcao}</p>
                <Badge variant="secondary" className="text-xs">{f.disponiveis.length} / {f.total}</Badge>
              </div>
              {f.disponiveis.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {f.disponiveis.map((nome) => <li key={nome}>{nome}</li>)}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground/70">Nenhum disponível</p>
              )}
            </Card>
          ))}
          {funcaoCards.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma função encontrada.</p>}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function NominationsPage() {
  const [selected, setSelected]       = useState<Nomination | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("todos");
  const [search, setSearch]           = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

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
          n.colaborador_nome.toLowerCase().includes(q) ||
          n.funcao.toLowerCase().includes(q) ||
          (n.pm_name ?? "").toLowerCase().includes(q) ||
          (n.project ?? "").toLowerCase().includes(q) ||
          (n.client ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [nominations, filterStatus, search]);

  const pendingCount = nominations.filter((n) => n.current_status !== "apto").length;

  const handleListClick = (nom: Nomination) => {
    setHighlightedId(nom.id);
    document
      .getElementById(`kanban-card-${nom.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    window.setTimeout(() => setHighlightedId((cur) => (cur === nom.id ? null : cur)), 2000);
  };

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

      <Tabs defaultValue="simulacao">
        <TabsList>
          <TabsTrigger value="simulacao">Simulação</TabsTrigger>
          <TabsTrigger value="nomeacoes">Nomeações</TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="mr-1.5 h-3.5 w-3.5" /> Configurações
          </TabsTrigger>
        </TabsList>

        {/* ── Simulação de disponibilidade ── */}
        <TabsContent value="simulacao" className="pt-4">
          <SimulacaoTab />
        </TabsContent>

        {/* ── Lista + Kanban lado a lado ── */}
        <TabsContent value="nomeacoes" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Buscar colaborador, função, PM..."
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
          ) : (
            <div className="flex gap-4 items-start">
              {/* Lista */}
              <div className="w-80 shrink-0 space-y-1.5 max-h-[75vh] overflow-y-auto pr-1">
                {nominations.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">Nenhuma nomeação encontrada. Crie uma nova nomeação acima.</p>
                ) : filtered.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">Nenhuma nomeação com esse filtro.</p>
                ) : (
                  filtered.map((nom) => (
                    <Card
                      key={nom.id}
                      className={`p-3 cursor-pointer transition-shadow hover:shadow-md ${
                        highlightedId === nom.id ? "ring-2 ring-primary" : ""
                      }`}
                      onClick={() => handleListClick(nom)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{nom.colaborador_nome}</p>
                          <p className="truncate text-xs text-muted-foreground">{nom.funcao}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                      <div className="mt-1.5">
                        <StatusBadge status={nom.current_status} />
                      </div>
                    </Card>
                  ))
                )}
              </div>

              {/* Kanban — colunas sempre visíveis, mesmo sem nenhum card */}
              <div className="min-w-0 flex-1 overflow-x-auto">
                <KanbanBoard
                  nominations={filtered}
                  highlightedId={highlightedId}
                  onOpen={setSelected}
                />
              </div>
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
