import { useState, useMemo, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas nominations/nomination_nominees/weld_type_config/weld_material_config/
// nomination_status_history/colaborador_funcoes_historico ainda não estão nos tipos gerados;
// cast local para não bloquear o build.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import { useViewAs, VIEW_AS_ROLES } from "@/hooks/useViewAs";
import {
  type Nomination, type NominationNominee, type NominationStatusHistory,
  type WeldTypeConfig, type WeldMaterialConfig, type NominationStatus, type PmDecision, type QualityStatus,
  STATUS_LABELS, STATUS_BADGE, ALL_STATUSES, KANBAN_COLUMNS, STAGE_ROLE, QUALIDADE_ROLE,
  columnIdForStatus, canMoveToColumn, computeRevertClearing, fmtDate, fmtDatetime, isSoldador,
} from "@/lib/nominations";
import { notifyStageAdvance, notifyAptitudeDivergence, notifyCancellation, notifyQualityRejection } from "@/lib/nominationEmails";
import { cn, matchesNameSearch } from "@/lib/utils";
import { SearchableSelect } from "@/components/SearchableSelect";
import { QualificationEligibilityTab } from "@/components/nominations/QualificationEligibilityTab";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  Trash2, AlertTriangle, ArrowRight, Stethoscope, X, UserPlus, Check, MoreVertical,
  ChevronDown, Building2, Layers3, Ship, ChevronsDownUp, ChevronsUpDown, Eye, FileText,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { notify } from "@/lib/notify";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { pageTitle } from "@/lib/pageTitle";
import {
  generateDateRange, todayStr, weekdayAbbr, addDays, computeDayStatus, getComputedColor, getComputedLabel,
  displayAbbr, getContrastText, STATUS_COLOR, STATUS_LABEL, DRAKE_DATA_CUTOFF, bspOptionsForUnidade,
  getColaboradoresComEmbarque, bspDoPeriodo, normalizeUnidadeOperacional,
  type ComputedStatus, type HistNovoPeriodo,
} from "@/lib/histogramaNovo";
import { normalizeBmBspKey } from "@/lib/bmUnitResolver";
import { resolverFuncaoEmbarque, type TimesheetEmbarque } from "@/lib/timesheetOffshore";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { selectAllPages } from "@/lib/supabasePaginate";
import { clienteDaUnidade } from "@/lib/clientes";

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

// Papel logado pode agir na etapa atual da solicitação? `logistics_operator` sempre pode
// (Logística de Pessoal continua com acesso total, fallback/admin); os 4 papéis novos só na
// própria etapa (ver STAGE_ROLE em lib/nominations.ts); Qualidade age dentro de Aprovação
// Técnica (é o gate, não dono da coluna).
function useCanActOnStage(status: NominationStatus): boolean {
  const { role } = useAuth();
  if (role === "logistics_operator") return true;
  if (status === "aprovacao_tecnica" && role === QUALIDADE_ROLE) return true;
  return STAGE_ROLE[status] === role;
}

// Grava a troca de etapa + histórico + dispara e-mail (fire-and-forget, nunca bloqueia nem
// desfaz a troca — ver notifyStageAdvance). Usado tanto pelo drag-and-drop do kanban quanto
// pelos botões de avanço específicos de cada etapa, pra não duplicar essa lógica.
function useAdvanceStage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({
      nomination, target, extraPatch, note,
    }: {
      nomination: Nomination;
      target: NominationStatus;
      extraPatch?: Record<string, unknown>;
      note?: string;
    }) => {
      // Retrocesso (drag-and-drop pra trás ou o botão "Retroceder etapa") desfaz o que já foi
      // marcado nas etapas puladas — senão o card volta mas continua com tudo preenchido como
      // se nada tivesse mudado (colaboradores da Simulação, seleção da Aprovação Técnica,
      // decisão do PM etc.).
      const clearing = computeRevertClearing(nomination.current_status, target);
      const patch: Record<string, unknown> = { current_status: target, ...clearing?.nominationPatch, ...extraPatch };
      const { error } = await supabase.from("nominations").update(patch).eq("id", nomination.id);
      if (error) throw error;
      if (clearing?.deleteNominees) {
        const { error: delErr } = await supabase.from("nomination_nominees").delete().eq("nomination_id", nomination.id);
        if (delErr) throw delErr;
      } else if (clearing?.nomineePatch) {
        const { error: nomErr } = await supabase.from("nomination_nominees").update(clearing.nomineePatch).eq("nomination_id", nomination.id);
        if (nomErr) throw nomErr;
      }
      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id,
        status: target,
        changed_by_name: profile?.full_name ?? profile?.email ?? "Sistema",
        notes: note ?? null,
      });
      await notifyStageAdvance({ ...nomination, current_status: target }, target);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations", vars.nomination.id, "history"] });
      qc.invalidateQueries({ queryKey: ["nominations", vars.nomination.id, "nominees"] });
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao mover nomeação."),
  });
}

function useNominees(nominationId: string | undefined) {
  return useQuery<NominationNominee[]>({
    queryKey: ["nominations", nominationId, "nominees"],
    enabled: !!nominationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nomination_nominees")
        .select("*")
        .eq("nomination_id", nominationId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as NominationNominee[];
    },
  });
}

// ── Manage dialog ─────────────────────────────────────────────────────────────

// A seleção de candidatos em si acontece na aba Simulação (grade completa, com filtros) —
// aqui é só um resumo de quem já foi adicionado + o atalho que leva pra lá em "modo
// recrutamento" pra essa solicitação específica (ver SimulacaoTab/focusNomination).
function EfetivoDisponivelSection({
  nomination, nominees, onGoToSimulacao,
}: {
  nomination: Nomination;
  nominees: NominationNominee[];
  onGoToSimulacao: () => void;
}) {
  const qc = useQueryClient();
  const canAct = useCanActOnStage(nomination.current_status);

  const removeNominee = useMutation({
    mutationFn: async (nomineeId: string) => {
      const { error } = await supabase.from("nomination_nominees").delete().eq("id", nomineeId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] }),
  });

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Efetivo Disponível — {nomination.funcao}</p>
      {canAct && (
        <Button size="sm" onClick={onGoToSimulacao}>
          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Ir para Simulação e selecionar candidatos
        </Button>
      )}
      {nominees.filter((n) => n.is_active).length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Já no efetivo desta solicitação:</p>
          {nominees.filter((n) => n.is_active).map((n) => (
            <div key={n.id} className="flex items-center justify-between rounded bg-blue-50 px-2 py-1 text-sm text-blue-900">
              <span>{n.colaborador_nome}</span>
              {canAct && !n.technical_selected_at && (
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-blue-700" onClick={() => removeNominee.mutate(n.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Mesmo bucket/caminho usado no upload feito pelo Solicitante (ver uploadScopeDocument em
// src/routes/pm/index.tsx) — aqui só baixa, nunca envia.
const SCOPE_BUCKET = "nomeacoes-anexos";
async function baixarEscopoDocumento(path: string, nomeOriginal: string): Promise<void> {
  const { data, error } = await supabase.storage.from(SCOPE_BUCKET).download(path);
  if (error) { notify.error(error.message); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = nomeOriginal;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AprovacaoTecnicaSection({ nomination, nominees }: { nomination: Nomination; nominees: NominationNominee[] }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const canAct = useCanActOnStage(nomination.current_status);
  const advance = useAdvanceStage();
  const ativos = nominees.filter((n) => n.is_active);
  const selecionados = ativos.filter((n) => n.technical_selected_at);

  const toggleSelect = useMutation({
    mutationFn: async ({ nominee, selected }: { nominee: NominationNominee; selected: boolean }) => {
      const { error } = await supabase.from("nomination_nominees").update({
        technical_selected_at: selected ? new Date().toISOString() : null,
        technical_selected_by: selected ? (profile?.full_name ?? profile?.email ?? null) : null,
      }).eq("id", nominee.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] }),
  });

  const confirmar = () => {
    if (selecionados.length === 0) {
      notify.error("Selecione ao menos um candidato antes de avançar.");
      return;
    }
    const gate = canMoveToColumn(nomination, "nomeados", nominees);
    if (!gate.ok) { notify.error(gate.reason ?? "Não é possível avançar."); return; }
    advance.mutate({ nomination, target: "nomeados", note: `${selecionados.length} nomeado(s) selecionado(s)` });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Selecionar nomeados — {nomination.funcao}</p>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
        {ativos.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">Nenhum candidato no efetivo desta solicitação ainda.</p>}
        {ativos.map((n) => (
          <label key={n.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50 cursor-pointer">
            <span>{n.colaborador_nome}</span>
            <Checkbox
              checked={!!n.technical_selected_at}
              disabled={!canAct}
              onCheckedChange={(v) => toggleSelect.mutate({ nominee: n, selected: !!v })}
            />
          </label>
        ))}
      </div>
      {canAct && nomination.current_status === "aprovacao_tecnica" && (
        <Button size="sm" onClick={confirmar} loading={advance.isPending}>
          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Confirmar seleção e avançar para Nomeados
        </Button>
      )}
    </div>
  );
}

function NomeadosSection({ nomination, nominees }: { nomination: Nomination; nominees: NominationNominee[] }) {
  const { role } = useAuth();
  const canAct = role === "logistics_operator";
  const advance = useAdvanceStage();
  const selecionados = nominees.filter((n) => n.is_active && n.technical_selected_at);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Nomeados ({selecionados.length})</p>
      <ul className="space-y-1 text-sm">
        {selecionados.map((n) => <li key={n.id} className="rounded bg-purple-50 px-2 py-1 text-purple-900">{n.colaborador_nome}</li>)}
      </ul>
      {canAct && nomination.current_status === "nomeados" && (
        <Button
          size="sm"
          onClick={() => advance.mutate({ nomination, target: "aprovacao_pm" })}
          loading={advance.isPending}
        >
          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Enviar para Aprovação PM
        </Button>
      )}
    </div>
  );
}

function AprovacaoPmSection({ nomination, nominees }: { nomination: Nomination; nominees: NominationNominee[] }) {
  const { profile, role } = useAuth();
  const qc = useQueryClient();
  const canOperate = role === "logistics_operator";
  const ativos = nominees.filter((n) => n.is_active);
  const label: Record<PmDecision, { text: string; cls: string }> = {
    pendente: { text: "Pendente", cls: "bg-slate-100 text-slate-600" },
    aprovado: { text: "Aprovado", cls: "bg-emerald-100 text-emerald-700" },
    reprovado: { text: "Reprovado", cls: "bg-red-100 text-red-700" },
  };

  // Normalmente é o Solicitante quem decide pelo portal dele (/pm) — mas a Logística também
  // pode decidir aqui direto, sem depender de outra pessoa entrar no sistema (mesma filosofia
  // do "Avançar etapa (sem aguardar os demais)": operador sempre pode agir no lugar de quem
  // for o dono da etapa).
  const [draft, setDraft] = useState<Record<string, PmDecision>>({});
  const decisionFor = (n: NominationNominee): PmDecision => draft[n.id] ?? n.pm_decision;
  const todosDecididos = ativos.length > 0 && ativos.every((n) => decisionFor(n) !== "pendente");

  const confirmar = useMutation({
    mutationFn: async () => {
      await Promise.all(
        ativos.map(async (n) => {
          const decision = decisionFor(n);
          if (decision === n.pm_decision) return;
          const { error } = await supabase.from("nomination_nominees").update({
            pm_decision: decision,
            pm_decided_at: new Date().toISOString(),
            pm_decided_by: profile?.full_name ?? profile?.email ?? null,
          }).eq("id", n.id);
          if (error) throw error;
        }),
      );
      const merged = ativos.map((n) => ({ ...n, pm_decision: decisionFor(n) }));
      const gate = canMoveToColumn(nomination, "validacao_sms_aso", merged);
      if (!gate.ok) throw new Error(gate.reason ?? "Não é possível avançar ainda.");

      const { error } = await supabase.from("nominations").update({ current_status: "validacao_sms_aso" }).eq("id", nomination.id);
      if (error) throw error;
      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id, status: "validacao_sms_aso",
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística", notes: "Decisões de Aprovação PM confirmadas pela Logística",
      });
      await notifyStageAdvance({ ...nomination, current_status: "validacao_sms_aso" }, "validacao_sms_aso");
    },
    onSuccess: () => {
      notify.success("Decisões enviadas.");
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] });
      setDraft({});
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao confirmar decisões."),
  });

  if (!canOperate) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">Decisão do Solicitante</p>
        <p className="text-xs text-muted-foreground">O solicitante decide pelo portal dele (/pm) — aqui é só leitura.</p>
        <ul className="space-y-1 text-sm">
          {ativos.map((n) => (
            <li key={n.id} className="flex items-center justify-between rounded border px-2 py-1">
              <span>{n.colaborador_nome}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${label[n.pm_decision].cls}`}>{label[n.pm_decision].text}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (ativos.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum nomeado nesta solicitação ainda.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Decisão do Solicitante</p>
      <p className="text-xs text-muted-foreground">Normalmente o solicitante decide pelo portal dele (/pm) — a Logística também pode decidir por aqui.</p>
      <div className="space-y-1.5">
        {ativos.map((n) => {
          const d = decisionFor(n);
          return (
            <div key={n.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span>{n.colaborador_nome}</span>
              <div className="flex gap-1.5">
                <Button
                  size="sm" variant={d === "aprovado" ? "default" : "outline"} className="h-7 w-7 p-0"
                  onClick={() => setDraft((p) => ({ ...p, [n.id]: "aprovado" }))}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm" variant={d === "reprovado" ? "destructive" : "outline"} className="h-7 w-7 p-0"
                  onClick={() => setDraft((p) => ({ ...p, [n.id]: "reprovado" }))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <Button size="sm" disabled={!todosDecididos} loading={confirmar.isPending} onClick={() => confirmar.mutate()}>
        <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Confirmar decisões e avançar para Validação SMS (ASO)
      </Button>
    </div>
  );
}

// Validação SMS (ASO) — mesmo papel (sms) que já cuida do Briefing mais à frente. Checklist
// por nomeado aprovado, igual ao antigo formato de Aptidão (que virou parte de Validação RH).
function ValidacaoSmsAsoSection({ nomination, nominees }: { nomination: Nomination; nominees: NominationNominee[] }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const canAct = useCanActOnStage(nomination.current_status);
  const advance = useAdvanceStage();
  const aprovados = nominees.filter((n) => n.is_active && n.pm_decision === "aprovado");

  const toggleCheck = useMutation({
    mutationFn: async ({ nominee, val }: { nominee: NominationNominee; val: boolean }) => {
      const { error } = await supabase.from("nomination_nominees").update({
        sms_aso_checked: val,
        sms_aso_checked_at: val ? new Date().toISOString() : null,
        sms_aso_checked_by: val ? (profile?.full_name ?? profile?.email ?? null) : null,
      }).eq("id", nominee.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] }),
  });

  const todosChecados = aprovados.length > 0 && aprovados.every((n) => n.sms_aso_checked);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium flex items-center gap-1.5"><Stethoscope className="h-4 w-4" /> Validação SMS (ASO)</p>
      <div className="space-y-1 rounded-md border p-2">
        {aprovados.map((n) => (
          <label key={n.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50 cursor-pointer">
            <span>{n.colaborador_nome}</span>
            <Checkbox checked={n.sms_aso_checked} disabled={!canAct} onCheckedChange={(v) => toggleCheck.mutate({ nominee: n, val: !!v })} />
          </label>
        ))}
      </div>
      {canAct && (
        <Button size="sm" disabled={!todosChecados} onClick={() => advance.mutate({ nomination, target: "validacao_rh" })} loading={advance.isPending}>
          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Avançar para Validação RH
        </Button>
      )}
    </div>
  );
}

// Validação RH — desde esta reformulação inclui a checklist de Aptidão (antes era coluna
// própria do kanban) além da validação/divergência de RH que já existia.
function ValidacaoRhSection({ nomination, nominees }: { nomination: Nomination; nominees: NominationNominee[] }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const canAct = useCanActOnStage(nomination.current_status);
  const advance = useAdvanceStage();
  const aprovados = nominees.filter((n) => n.is_active && n.pm_decision === "aprovado");
  const [divergenceDraft, setDivergenceDraft] = useState<Record<string, string>>({});

  const toggleAptidaoCheck = useMutation({
    mutationFn: async ({ nominee, val }: { nominee: NominationNominee; val: boolean }) => {
      const { error } = await supabase.from("nomination_nominees").update({
        aptidao_checked: val,
        aptidao_checked_at: val ? new Date().toISOString() : null,
        aptidao_checked_by: val ? (profile?.full_name ?? profile?.email ?? null) : null,
      }).eq("id", nominee.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] }),
  });

  const validate = useMutation({
    mutationFn: async (nominee: NominationNominee) => {
      const { error } = await supabase.from("nomination_nominees").update({
        rh_validated: true, rh_validated_at: new Date().toISOString(), rh_validated_by: profile?.full_name ?? profile?.email ?? null,
      }).eq("id", nominee.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] }),
  });

  const flagDivergence = useMutation({
    mutationFn: async (nominee: NominationNominee) => {
      const text = divergenceDraft[nominee.id]?.trim();
      if (!text) throw new Error("Descreva a divergência.");
      const { error } = await supabase.from("nomination_nominees").update({
        aptidao_divergence: true, aptidao_divergence_text: text, aptidao_divergence_flagged_at: new Date().toISOString(), rh_validated: false,
      }).eq("id", nominee.id);
      if (error) throw error;
      await notifyAptitudeDivergence(nomination, nominee.colaborador_nome, text, false);
    },
    onSuccess: (_d, nominee) => {
      qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] });
      setDivergenceDraft((prev) => ({ ...prev, [nominee.id]: "" }));
    },
    onError: (err: Error) => notify.error(err.message),
  });

  const resolveDivergence = useMutation({
    mutationFn: async (nominee: NominationNominee) => {
      const { error } = await supabase.from("nomination_nominees").update({
        aptidao_divergence: false, aptidao_divergence_text: null, aptidao_divergence_flagged_at: null,
      }).eq("id", nominee.id);
      if (error) throw error;
      await notifyAptitudeDivergence(nomination, nominee.colaborador_nome, "", true);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "nominees"] }),
  });

  const todosChecados = aprovados.length > 0 && aprovados.every((n) => n.aptidao_checked);
  const podeAvancar = todosChecados && aprovados.every((n) => n.rh_validated && !n.aptidao_divergence);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5"><Stethoscope className="h-4 w-4" /> Aptidão</p>
        <div className="space-y-1 rounded-md border p-2">
          {aprovados.map((n) => (
            <label key={n.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50 cursor-pointer">
              <span>{n.colaborador_nome}</span>
              <Checkbox checked={n.aptidao_checked} disabled={!canAct} onCheckedChange={(v) => toggleAptidaoCheck.mutate({ nominee: n, val: !!v })} />
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Validação RH</p>
        <div className="space-y-2">
          {aprovados.map((n) => (
            <div key={n.id} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{n.colaborador_nome}</span>
                {n.rh_validated ? (
                  <Badge variant="secondary" className="text-emerald-700">Validado</Badge>
                ) : n.aptidao_divergence ? (
                  <Badge variant="destructive">Divergência</Badge>
                ) : (
                  <Badge variant="secondary">Pendente</Badge>
                )}
              </div>
              {n.aptidao_divergence ? (
                <div className="mt-1.5 space-y-1.5 rounded-md border border-red-200 bg-red-50 p-2">
                  <p className="flex items-start gap-1.5 text-xs text-red-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {n.aptidao_divergence_text}
                  </p>
                  {canAct && (
                    <Button size="sm" variant="outline" className="h-6 text-xs" loading={resolveDivergence.isPending} onClick={() => resolveDivergence.mutate(n)}>
                      Marcar como corrigido
                    </Button>
                  )}
                </div>
              ) : !n.rh_validated && canAct ? (
                <div className="mt-1.5 space-y-1.5">
                  <Button size="sm" className="h-6 text-xs" loading={validate.isPending} onClick={() => validate.mutate(n)}>
                    Validar RH
                  </Button>
                  <div className="flex gap-1.5">
                    <Input
                      className="h-6 text-xs" placeholder="Descrever divergência..."
                      value={divergenceDraft[n.id] ?? ""}
                      onChange={(e) => setDivergenceDraft((p) => ({ ...p, [n.id]: e.target.value }))}
                    />
                    <Button size="sm" variant="destructive" className="h-6 shrink-0 text-xs" loading={flagDivergence.isPending} onClick={() => flagDivergence.mutate(n)}>
                      Sinalizar
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {canAct && (
        <Button size="sm" disabled={!podeAvancar} onClick={() => advance.mutate({ nomination, target: "briefing_sms" })} loading={advance.isPending}>
          <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Avançar para Briefing
        </Button>
      )}
    </div>
  );
}

function BriefingSection({ nomination }: { nomination: Nomination }) {
  const { profile } = useAuth();
  const canAct = useCanActOnStage(nomination.current_status);
  const advance = useAdvanceStage();
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 rounded-md bg-teal-50 border border-teal-200 px-3 py-2 text-sm text-teal-900 cursor-pointer">
        <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" /> Briefing realizado</span>
        <Checkbox
          checked={nomination.briefing_sms_realizado}
          disabled={!canAct}
          onCheckedChange={(v) => {
            if (!v) return;
            advance.mutate({
              nomination, target: "equipe_formada",
              extraPatch: {
                briefing_sms_realizado: true,
                briefing_sms_realizado_at: new Date().toISOString(),
                briefing_sms_realizado_by: profile?.full_name ?? profile?.email ?? null,
                outcome: "concluida",
              },
            });
          }}
        />
      </label>
    </div>
  );
}

function ManageDialog({
  nomination: initialNomination,
  onClose,
  onGoToSimulacao,
}: {
  nomination: Nomination;
  onClose: () => void;
  onGoToSimulacao: (nomination: Nomination) => void;
}) {
  const { profile, role } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("detalhes");
  const advance = useAdvanceStage();
  // Nunca usar initialNomination além do fallback/id — ela é só o retrato de quando o card
  // foi clicado. Reler da mesma query cacheada garante que o dialog acompanha em tempo real
  // qualquer avanço de etapa feito por ele mesmo (senão os botões ficavam presos na etapa
  // antiga até fechar e reabrir o card).
  const { data: allNominations } = useAllNominations();
  const nomination = allNominations?.find((n) => n.id === initialNomination.id) ?? initialNomination;
  const { data: nominees = [] } = useNominees(nomination.id);
  const canOperate = role === "logistics_operator";

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

  const setQualityStatus = useMutation({
    mutationFn: async ({ status, reason }: { status: QualityStatus; reason?: string }) => {
      const aprovado = status === "aprovado";
      const { error } = await supabase.from("nominations").update({
        quality_status: status,
        quality_rejection_reason: status === "reprovado" ? (reason?.trim() || null) : null,
        quality_validated: aprovado,
        quality_validated_at: status !== "pendente" ? new Date().toISOString() : null,
        quality_validated_by: status !== "pendente" ? (profile?.full_name ?? profile?.email ?? null) : null,
      }).eq("id", nomination.id);
      if (error) throw error;
      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id,
        status: nomination.current_status,
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes: status === "aprovado"
          ? "Qualidade aprovou"
          : status === "reprovado"
            ? `Qualidade reprovou${reason?.trim() ? `: ${reason.trim()}` : ""}`
            : "Validação de Qualidade desmarcada",
      });
      if (status === "reprovado") await notifyQualityRejection(nomination, reason?.trim() || null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nominations"] });
      qc.invalidateQueries({ queryKey: ["nominations", nomination.id, "history"] });
    },
    onError: () => notify.error("Erro ao atualizar."),
  });

  const marcarRecebido = () => {
    advance.mutate({
      nomination, target: "recebido_logistica",
      extraPatch: { logistics_received_at: new Date().toISOString(), logistics_received_by: profile?.full_name ?? profile?.email ?? null },
    });
  };

  const [showRevert, setShowRevert] = useState(false);
  const [revertTarget, setRevertTarget] = useState<NominationStatus | "">("");
  const currentIdx = ALL_STATUSES.indexOf(nomination.current_status);
  const earlierStages = ALL_STATUSES.slice(0, currentIdx);
  const laterStages = ALL_STATUSES.slice(currentIdx + 1);

  const [showForceAdvance, setShowForceAdvance] = useState(false);
  const [forceAdvanceTarget, setForceAdvanceTarget] = useState<NominationStatus | "">("");
  // Bypass total: a Logística pode empurrar o card pra qualquer etapa futura sem esperar
  // Qualidade/Solicitante/RH/SMS agirem — ignora de propósito os gates de canMoveToColumn e
  // as seleções/validações de cada Section (technical_selected/pm_decision/aptidao/rh_validated),
  // já que quem está confirmando a etapa aqui é a própria Logística, por fora do fluxo normal.
  const forceAdvance = () => {
    if (!forceAdvanceTarget) return;
    const extraPatch: Record<string, unknown> =
      forceAdvanceTarget === "equipe_formada" && !nomination.outcome
        ? {
            outcome: "concluida",
            briefing_sms_realizado: true,
            briefing_sms_realizado_at: new Date().toISOString(),
            briefing_sms_realizado_by: profile?.full_name ?? profile?.email ?? null,
          }
        : {};
    advance.mutate(
      { nomination, target: forceAdvanceTarget, extraPatch, note: `Avançada manualmente pela Logística para ${STATUS_LABELS[forceAdvanceTarget]}` },
      { onSuccess: () => { setShowForceAdvance(false); setForceAdvanceTarget(""); } },
    );
  };

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("nominations").update({
        current_status: "equipe_formada",
        outcome: "cancelada",
        cancel_reason: cancelReason.trim() || null,
        cancelled_at: new Date().toISOString(),
        cancelled_by: profile?.full_name ?? profile?.email ?? null,
      }).eq("id", nomination.id);
      if (error) throw error;
      await supabase.from("nomination_status_history").insert({
        nomination_id: nomination.id, status: "equipe_formada",
        changed_by_name: profile?.full_name ?? profile?.email ?? "Logística",
        notes: cancelReason.trim() ? `Cancelada: ${cancelReason.trim()}` : "Cancelada",
      });
      await notifyCancellation(nomination, cancelReason.trim() || null);
    },
    onSuccess: () => {
      notify.success("Solicitação cancelada.");
      qc.invalidateQueries({ queryKey: ["nominations"] });
      setShowCancel(false);
      onClose();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao cancelar."),
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

  const qualidadeGateOk = !nomination.requires_quality_validation || nomination.quality_status === "aprovado";
  const canQuality = canOperate || role === QUALIDADE_ROLE;
  const [showQualityReject, setShowQualityReject] = useState(false);
  const [qualityReasonDraft, setQualityReasonDraft] = useState("");
  const QUALITY_STATUS_LABEL: Record<QualityStatus, string> = { pendente: "Pendente", aprovado: "Aprovada", reprovado: "Reprovada" };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 pr-6">
            <DialogTitle className="text-base">{nomination.funcao}</DialogTitle>
            {canOperate && (
              <div className="flex items-center gap-0.5 shrink-0">
                {(earlierStages.length > 0 || laterStages.length > 0) && (
                  // Atalhos de teste/apresentação (mover etapa livremente, pra qualquer lado,
                  // sem esperar validação de ninguém) — de propósito escondidos atrás desse
                  // menu, não expostos como botões na tela, pra não aparecer numa demonstração.
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {earlierStages.length > 0 && (
                        <DropdownMenuItem onClick={() => setShowRevert(true)}>Retroceder etapa</DropdownMenuItem>
                      )}
                      {laterStages.length > 0 && (
                        <DropdownMenuItem onClick={() => setShowForceAdvance(true)}>Avançar etapa (sem aguardar os demais)</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
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
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <StatusBadge status={nomination.current_status} />
            {nomination.current_status === "equipe_formada" && (
              <span className={`text-xs font-medium ${nomination.outcome === "cancelada" ? "text-red-700" : "text-green-700"}`}>
                {nomination.sequence_number != null && `#${String(nomination.sequence_number).padStart(3, "0")} — `}
                {nomination.outcome === "cancelada" ? "Cancelada" : "Equipe formada — processo concluído"}
              </span>
            )}
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="etapa">Etapa atual</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          {/* ── Detalhes ── */}
          <TabsContent value="detalhes" className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Função:</span> <span className="font-medium">{nomination.funcao}</span></div>
              {nomination.pm_name && (
                <div><span className="text-muted-foreground">Solicitante:</span> <span className="font-medium">{nomination.pm_name}</span></div>
              )}
              {nomination.unidade && (
                <div><span className="text-muted-foreground">Unidade:</span> <span className="font-medium">{nomination.unidade}</span></div>
              )}
              {nomination.bsp && (
                <div><span className="text-muted-foreground">BSP:</span> <span className="font-medium">{nomination.bsp}</span></div>
              )}
              {nomination.weld_type && (
                <div><span className="text-muted-foreground">Tipo de solda:</span> <span className="font-medium">{nomination.weld_type}</span></div>
              )}
              {nomination.weld_material && (
                <div><span className="text-muted-foreground">Material:</span> <span className="font-medium">{nomination.weld_material}</span></div>
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
              {nomination.outcome === "cancelada" && nomination.cancel_reason && (
                <div className="col-span-2"><span className="text-muted-foreground">Motivo do cancelamento:</span> {nomination.cancel_reason}</div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              {nomination.current_status === "solicitacao" && canOperate && (
                <Button size="sm" onClick={marcarRecebido} loading={advance.isPending}>
                  <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Marcar recebido pela Logística
                </Button>
              )}
              {nomination.current_status === "recebido_logistica" && canOperate && (
                <Button
                  size="sm"
                  onClick={() => advance.mutate(
                    { nomination, target: "simulacao" },
                    { onSuccess: () => { onGoToSimulacao(nomination); onClose(); } },
                  )}
                  loading={advance.isPending}
                >
                  <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Iniciar Simulação
                </Button>
              )}
              {nomination.current_status === "simulacao" && canOperate && (
                <Button
                  size="sm"
                  onClick={() => advance.mutate({ nomination, target: "aprovacao_tecnica" })}
                  loading={advance.isPending}
                >
                  <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Enviar para Aprovação Técnica
                </Button>
              )}
              {nomination.requires_quality_validation && (
                <div className="space-y-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm text-purple-900">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Validação de Qualidade (soldador)
                    </span>
                    {canQuality ? (
                      <div className="flex gap-1.5">
                        <Button
                          type="button" size="sm" className="h-7 w-7 p-0"
                          variant={nomination.quality_status === "aprovado" ? "default" : "outline"}
                          loading={setQualityStatus.isPending && setQualityStatus.variables?.status === "aprovado"}
                          onClick={() => { setShowQualityReject(false); setQualityStatus.mutate({ status: "aprovado" }); }}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button" size="sm" className="h-7 w-7 p-0"
                          variant={nomination.quality_status === "reprovado" ? "destructive" : "outline"}
                          onClick={() => setShowQualityReject(true)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          nomination.quality_status === "aprovado"
                            ? "bg-emerald-100 text-emerald-700"
                            : nomination.quality_status === "reprovado"
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {QUALITY_STATUS_LABEL[nomination.quality_status]}
                      </span>
                    )}
                  </div>
                  {nomination.scope_document_path ? (
                    <button
                      type="button" className="flex items-center gap-1.5 text-xs text-purple-900 hover:underline"
                      onClick={() => baixarEscopoDocumento(nomination.scope_document_path!, nomination.scope_document_name ?? "escopo-do-servico")}
                    >
                      <FileText className="h-3.5 w-3.5" /> {nomination.scope_document_name ?? "Baixar escopo do serviço"}
                    </button>
                  ) : (
                    <p className="text-xs text-purple-900/70">Nenhum escopo do serviço anexado pelo solicitante.</p>
                  )}
                  {nomination.quality_status === "reprovado" && nomination.quality_rejection_reason && (
                    <p className="text-xs text-red-800">Motivo: {nomination.quality_rejection_reason}</p>
                  )}
                  {showQualityReject && (
                    <div className="space-y-1.5">
                      <Textarea
                        rows={2} className="text-xs" placeholder="Motivo da reprovação (opcional)"
                        value={qualityReasonDraft} onChange={(e) => setQualityReasonDraft(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button" size="sm" variant="destructive"
                          loading={setQualityStatus.isPending && setQualityStatus.variables?.status === "reprovado"}
                          onClick={() => {
                            setQualityStatus.mutate(
                              { status: "reprovado", reason: qualityReasonDraft },
                              { onSuccess: () => { setShowQualityReject(false); setQualityReasonDraft(""); } },
                            );
                          }}
                        >
                          Confirmar reprovação
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setShowQualityReject(false)}>Voltar</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!qualidadeGateOk && (
                <p className="text-xs text-amber-700">
                  {nomination.quality_status === "reprovado"
                    ? "A Qualidade reprovou esta solicitação — não é possível avançar de Aprovação Técnica."
                    : "Aguardando aprovação da Qualidade antes de avançar de Aprovação Técnica."}
                </p>
              )}
              {canOperate && showRevert && earlierStages.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2 rounded-md border p-3">
                    <Label className="text-xs">Voltar para qual etapa?</Label>
                    <Select value={revertTarget} onValueChange={(v) => setRevertTarget(v as NominationStatus)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                      <SelectContent>
                        {earlierStages.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!revertTarget}
                        loading={advance.isPending}
                        onClick={() => {
                          if (!revertTarget) return;
                          advance.mutate(
                            { nomination, target: revertTarget, note: `Retrocedida para ${STATUS_LABELS[revertTarget]}` },
                            { onSuccess: () => { setShowRevert(false); setRevertTarget(""); } },
                          );
                        }}
                      >
                        Confirmar retrocesso
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowRevert(false); setRevertTarget(""); }}>Voltar</Button>
                    </div>
                  </div>
                </>
              )}
              {canOperate && showForceAdvance && laterStages.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2 rounded-md border p-3">
                    <Label className="text-xs">Avançar direto para qual etapa?</Label>
                    <p className="text-xs text-muted-foreground">
                      Pula a validação/seleção da etapa atual (Qualidade, Solicitante, RH, SMS etc.) — use quando a
                      Logística já confirmou tudo por fora do sistema.
                    </p>
                    <Select value={forceAdvanceTarget} onValueChange={(v) => setForceAdvanceTarget(v as NominationStatus)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione a etapa" /></SelectTrigger>
                      <SelectContent>
                        {laterStages.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={!forceAdvanceTarget} loading={advance.isPending} onClick={forceAdvance}>
                        Confirmar avanço
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowForceAdvance(false); setForceAdvanceTarget(""); }}>Voltar</Button>
                    </div>
                  </div>
                </>
              )}
              {canOperate && nomination.current_status !== "equipe_formada" && (
                <>
                  <Separator />
                  {!showCancel ? (
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setShowCancel(true)}>
                      Cancelar solicitação
                    </Button>
                  ) : (
                    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                      <Label className="text-xs">Motivo do cancelamento (opcional)</Label>
                      <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                          Confirmar cancelamento
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowCancel(false)}>Voltar</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Etapa atual ── */}
          <TabsContent value="etapa" className="space-y-4 pt-2">
            {nomination.requires_quality_validation
              && ALL_STATUSES.indexOf(nomination.current_status) > ALL_STATUSES.indexOf("aprovacao_tecnica") && (
              <div
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  nomination.quality_status === "aprovado"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : nomination.quality_status === "reprovado"
                      ? "border-red-200 bg-red-50 text-red-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Qualidade: {nomination.quality_status === "aprovado" ? "Aprovada" : nomination.quality_status === "reprovado" ? "Reprovada" : "Pendente"}
                {nomination.quality_status === "reprovado" && nomination.quality_rejection_reason && (
                  <span className="text-xs font-normal opacity-80">— {nomination.quality_rejection_reason}</span>
                )}
              </div>
            )}
            {nomination.current_status === "simulacao" && (
              <EfetivoDisponivelSection
                nomination={nomination}
                nominees={nominees}
                onGoToSimulacao={() => { onGoToSimulacao(nomination); onClose(); }}
              />
            )}
            {nomination.current_status === "aprovacao_tecnica" && <AprovacaoTecnicaSection nomination={nomination} nominees={nominees} />}
            {nomination.current_status === "nomeados" && <NomeadosSection nomination={nomination} nominees={nominees} />}
            {nomination.current_status === "aprovacao_pm" && <AprovacaoPmSection nomination={nomination} nominees={nominees} />}
            {nomination.current_status === "validacao_sms_aso" && <ValidacaoSmsAsoSection nomination={nomination} nominees={nominees} />}
            {nomination.current_status === "validacao_rh" && <ValidacaoRhSection nomination={nomination} nominees={nominees} />}
            {nomination.current_status === "briefing_sms" && <BriefingSection nomination={nomination} />}
            {nomination.current_status === "equipe_formada" && <NomeadosSection nomination={nomination} nominees={nominees} />}
            {(nomination.current_status === "solicitacao" || nomination.current_status === "recebido_logistica") && (
              <p className="text-xs text-muted-foreground">Nada a fazer nesta aba ainda — use os botões em Detalhes para avançar.</p>
            )}
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

function WeldMaterialConfigPanel() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: config = [] } = useQuery<WeldMaterialConfig[]>({
    queryKey: ["weld-material-config"],
    queryFn: async () => {
      const { data } = await supabase.from("weld_material_config").select("*").order("material_name");
      return (data ?? []) as WeldMaterialConfig[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error("Informe o nome do material.");
      const { error } = await supabase.from("weld_material_config").insert({ material_name: newName.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setNewName(""); qc.invalidateQueries({ queryKey: ["weld-material-config"] }); },
    onError: (err: Error) => notify.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("weld_material_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weld-material-config"] }),
    onError: () => notify.error("Erro ao remover."),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Configure os materiais disponíveis para seleção quando a função é Soldador.</p>
      <div className="flex gap-2">
        <Input
          placeholder="Nome do material" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add.mutate()} className="max-w-xs"
        />
        <Button onClick={() => add.mutate()} loading={add.isPending}><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
      </div>
      {config.length === 0 ? (
        <EmptyState icon={Settings} title="Nenhum material configurado" />
      ) : (
        <div className="divide-y rounded-md border">
          {config.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium">{m.material_name}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(m.id)} loading={remove.isPending && remove.variables === m.id}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Kanban de Nomeações ────────────────────────────────────────────────────────
// 10 colunas fixas (ver KANBAN_COLUMNS em src/lib/nominations.ts). Card arrastável via
// dnd-kit; os bloqueios de avanço (Qualidade, Aprovação PM completa, divergência de Aptidão
// pendente) vêm de canMoveToColumn, que agora também recebe os nomeados da solicitação.

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
  const isTerminal = nomination.current_status === "equipe_formada";

  return (
    <div
      id={`kanban-card-${nomination.id}`}
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`cursor-grab animate-in fade-in zoom-in-95 rounded-lg border bg-background p-3.5 shadow-sm duration-300 transition-shadow active:cursor-grabbing hover:shadow-md ${
        isDragging ? "opacity-40" : ""
      } ${highlighted ? "ring-2 ring-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-tight">
          {nomination.funcao}
          {nomination.quantidade > 1 && <span className="ml-1.5 font-normal text-muted-foreground">×{nomination.quantidade}</span>}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {isTerminal && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />}
        </div>
      </div>
      {nomination.bsp && <p className="mt-0.5 text-xs text-muted-foreground">{nomination.unidade} — {nomination.bsp}</p>}
      {nomination.period_start && nomination.period_end && (
        <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(nomination.period_start)} – {fmtDate(nomination.period_end)}</p>
      )}
      {nomination.requires_quality_validation && (
        <span
          className={`mt-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
            nomination.quality_status === "aprovado"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : nomination.quality_status === "reprovado"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {nomination.quality_status === "aprovado" ? "Qualidade validada" : nomination.quality_status === "reprovado" ? "Qualidade reprovada" : "Qualidade pendente"}
        </span>
      )}
    </div>
  );
}

// Lista acumulativa (não um kanban comum) — cada solicitação que chega em "equipe_formada"
// (concluída pelo fluxo normal ou cancelada a qualquer momento) entra aqui e fica pra sempre,
// numerada sequencialmente (sequence_number, atribuído por trigger no banco), mais recente no
// topo — é o histórico/arquivo de tudo que já foi processado, não um estágio de trabalho ativo.
function EquipeFormadaColumn({
  nominations, onOpen, index = 0,
}: {
  nominations: Nomination[];
  onOpen: (n: Nomination) => void;
  index?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "equipe_formada" });
  const ordenadas = [...nominations].sort((a, b) => (b.sequence_number ?? 0) - (a.sequence_number ?? 0));
  return (
    <div
      className="flex min-w-[300px] flex-1 shrink-0 animate-in fade-in slide-in-from-bottom-2 flex-col rounded-lg border bg-muted/20 fill-mode-backwards duration-500 lg:min-w-[320px]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="rounded-t-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide" style={{ backgroundColor: "#DCFCE7", color: "#166534" }}>
        Equipe Formada <span className="font-normal opacity-70">({ordenadas.length})</span>
      </div>
      <div ref={setNodeRef} className={`flex-1 space-y-1.5 overflow-y-auto p-2 h-[calc(100vh-240px)] min-h-[540px] transition-colors ${isOver ? "bg-primary/5" : ""}`}>
        {ordenadas.map((n) => (
          <div
            key={n.id}
            onClick={() => onOpen(n)}
            className="cursor-pointer animate-in fade-in zoom-in-95 rounded-md border bg-background p-2.5 text-xs shadow-sm duration-300 hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">
                {String(n.sequence_number ?? 0).padStart(3, "0")}-{n.bsp || "—"}
              </span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  n.outcome === "cancelada" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {n.outcome === "cancelada" ? "Cancelada" : "Concluída"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-muted-foreground">{n.funcao} · {n.unidade}</p>
          </div>
        ))}
        {ordenadas.length === 0 && <p className="py-4 text-center text-[11px] text-muted-foreground/60">Nenhuma solicitação processada ainda</p>}
      </div>
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
  index = 0,
}: {
  columnId: NominationStatus;
  label: string;
  bg: string;
  text: string;
  nominations: Nomination[];
  highlightedId: string | null;
  onOpen: (n: Nomination) => void;
  index?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  return (
    <div
      className="flex min-w-[300px] flex-1 shrink-0 animate-in fade-in slide-in-from-bottom-2 flex-col rounded-lg border bg-muted/20 fill-mode-backwards duration-500 lg:min-w-[320px]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        className="rounded-t-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide"
        style={{ backgroundColor: bg, color: text }}
      >
        {label} <span className="font-normal opacity-70">({nominations.length})</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-2.5 overflow-y-auto p-2.5 h-[calc(100vh-240px)] min-h-[540px] transition-colors ${isOver ? "bg-primary/5" : ""}`}
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
  nomineesByNomination,
  highlightedId,
  onOpen,
}: {
  nominations: Nomination[];
  nomineesByNomination: Map<string, NominationNominee[]>;
  highlightedId: string | null;
  onOpen: (n: Nomination) => void;
}) {
  const { role } = useAuth();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const advance = useAdvanceStage();

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

    if (role !== "logistics_operator" && STAGE_ROLE[nomination.current_status] !== role) {
      notify.error("Você não tem permissão para mover este card.");
      return;
    }

    const gate = canMoveToColumn(nomination, target, nomineesByNomination.get(nomination.id) ?? []);
    if (!gate.ok) {
      notify.error(gate.reason ?? "Não é possível mover este card.");
      return;
    }
    advance.mutate({ nomination, target });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {/* Board com N colunas de min-w-[300px]+ facilmente passa de 1500px — sem isso a página
          estourava horizontalmente em telas mais estreitas. Kanban com rolagem horizontal é
          um padrão de UX aceito mesmo em tablet (diferente de uma tabela de dados). */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map((c, i) =>
          c.id === "equipe_formada" ? (
            <EquipeFormadaColumn key={c.id} nominations={byColumn.get(c.id) ?? []} onOpen={onOpen} index={i} />
          ) : (
            <KanbanColumn
              key={c.id}
              columnId={c.id}
              label={c.label}
              bg={c.bg}
              text={c.text}
              nominations={byColumn.get(c.id) ?? []}
              highlightedId={highlightedId}
              onOpen={onOpen}
              index={i}
            />
          ),
        )}
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

function SimulacaoTab({
  focusNomination, onExitFocus,
}: {
  focusNomination: Nomination | null;
  onExitFocus: () => void;
}) {
  const hoje = todayStr();
  const [periodoDe, setPeriodoDe] = useState(hoje);
  const [periodoAte, setPeriodoAte] = useState(() => defaultSimEnd(hoje));
  const [filterFuncao, setFilterFuncao] = useState("all");
  const [searchNome, setSearchNome] = useState("");
  // Cascata "Disponíveis por função" — tudo começa aberto (mesmo padrão da aba Equipes
  // Embarcadas); o set guarda só as funções recolhidas.
  const [collapsedFuncoes, setCollapsedFuncoes] = useState<Set<string>>(new Set());
  const toggleFuncaoCollapsed = (funcao: string) => {
    setCollapsedFuncoes((current) => {
      const next = new Set(current);
      if (next.has(funcao)) next.delete(funcao); else next.add(funcao);
      return next;
    });
  };

  const qc = useQueryClient();
  const { data: focusNominees = [] } = useNominees(focusNomination?.id);
  const focusNomineeIds = useMemo(
    () => new Set(focusNominees.filter((n) => n.is_active).map((n) => n.colaborador_id)),
    [focusNominees],
  );

  // Entrando em "modo recrutamento": pré-filtra pela função e período da solicitação, pra
  // já cair direto na lista certa de candidatos.
  useEffect(() => {
    if (!focusNomination) return;
    setFilterFuncao(focusNomination.funcao);
    if (focusNomination.period_start && focusNomination.period_end) {
      setPeriodoDe(focusNomination.period_start);
      setPeriodoAte(focusNomination.period_end);
    }
  }, [focusNomination?.id]);

  const addNominee = useMutation({
    mutationFn: async (c: { id: string; nome: string }) => {
      if (!focusNomination) return;
      const { error } = await supabase.from("nomination_nominees").insert({
        nomination_id: focusNomination.id,
        colaborador_id: c.id,
        colaborador_nome: c.nome,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nominations", focusNomination?.id, "nominees"] });
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao adicionar candidato."),
  });

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

  // Períodos autoritativos da operação (relatórios Drake de Embarque/Disponibilidade e
  // programações). BASE é deliberadamente excluído: esse tipo vem de uma planilha externa de
  // acesso à base e não pode alterar a disponibilidade exibida nesta simulação do Drake.
  // Não dá pra filtrar só pelo período exibido: o cálculo de Desembarque olha o dia seguinte
  // ao fim de um embarque, que pode cair fora da janela filtrada.
  const { data: periodosTodos = [] } = useQuery<HistNovoPeriodo[]>({
    queryKey: ["sim-periodos-drake-sem-base"],
    queryFn: () =>
      selectAllPages<HistNovoPeriodo>((from, to) =>
        supabase
          .from("hist_novo_periodos")
          .select("*")
          .neq("tipo", "BASE")
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
      // Defesa adicional para dados que possam permanecer em cache durante uma atualização.
      if (p.tipo === "BASE") return;
      if (!m.has(p.colaborador_id)) m.set(p.colaborador_id, []);
      m.get(p.colaborador_id)!.push(p);
    });
    return m;
  }, [periodosTodos]);

  // Nomeações é só pra quem embarca (offshore) — mesmo critério já usado pra filtrar o
  // import "Na Base" (tipo="E" confirmado, não só "Programado"), não o "tem qualquer período"
  // do Dashboard (que deixaria passar onshore com férias/atestado lançado).
  const colaboradoresOffshore = useMemo(() => getColaboradoresComEmbarque(periodosTodos), [periodosTodos]);

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

  // Precisa ser a MESMA prioridade usada em linhasBase (c.funcao || c.funcao_operacao ||
  // funcoesAno[0]) — antes vinha só de funcoesHistorico, então uma função podia aparecer na
  // lista sem nunca bater com ninguém (bug relatado: filtrar "Supervisor" não achava
  // ninguém, porque o cadastral de quem tem essa função no histórico é outro valor).
  const funcaoOptions = useMemo(() => {
    const s = new Set<string>();
    colaboradores.forEach((c) => {
      if (!colaboradoresOffshore.has(c.id)) return;
      const funcoesAno = funcoesAnoPorColaborador.get(c.id) ?? [];
      const funcao = c.funcao || c.funcao_operacao || funcoesAno[0] || "—";
      if (funcao !== "—") s.add(funcao);
    });
    return Array.from(s).sort();
  }, [colaboradores, colaboradoresOffshore, funcoesAnoPorColaborador]);

  const dates = useMemo(
    () => (periodoDe && periodoAte && periodoDe <= periodoAte ? generateDateRange(periodoDe, periodoAte) : []),
    [periodoDe, periodoAte],
  );

  const linhasBase = useMemo(() => {
    return colaboradores
      .filter((c) => colaboradoresOffshore.has(c.id))
      .map((c) => {
        const periodos = periodosPorColaborador.get(c.id) ?? [];
        const funcoesAno = funcoesAnoPorColaborador.get(c.id) ?? [];
        // Função fixa (cadastral) agrupa por fora, na árvore — as funções que ele já embarcou
        // (funcoesAno, histórico real por embarque) aparecem por dentro, junto do nome.
        const funcao = c.funcao || c.funcao_operacao || funcoesAno[0] || "—";
        const statusPorDia = dates.map((d) => computeDayStatus(periodos, d));
        const codigos = statusPorDia.map((r) => r.status);
        const temDesembarque = codigos.includes("DES");
        const temEmbarcado = codigos.some((s) => s === "E" || s === "DB");
        const todosDisponivel = codigos.every((s) => s === "STB");
        const bucket: SimBucket = temDesembarque ? "desembarca" : temEmbarcado ? "embarcado" : todosDisponivel ? "disponivel" : "outro";
        return { colaborador: c, funcao, funcoesAno, statusPorDia, bucket };
      })
      .filter((l) => funcaoMatchesFilter(l.funcao, l.funcoesAno, filterFuncao))
      .filter((l) => matchesNameSearch(l.colaborador.nome, searchNome))
      .sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome));
  }, [colaboradores, colaboradoresOffshore, periodosPorColaborador, funcoesAnoPorColaborador, dates, filterFuncao, searchNome]);

  // Cartões por função: quantos disponíveis em cada função, com os nomes — cruza sempre com
  // TODOS os status (não só quem passou no filtro de Status acima). "Disponível" aqui já exclui
  // quem está de férias/folga/atestado/etc. (bucket "outro"), não só quem está embarcado.
  const funcaoCards = useMemo(() => {
    const m = new Map<string, { total: number; disponiveis: typeof linhasBase }>();
    linhasBase.forEach((l) => {
      if (!m.has(l.funcao)) m.set(l.funcao, { total: 0, disponiveis: [] });
      const g = m.get(l.funcao)!;
      g.total++;
      if (l.bucket === "disponivel") g.disponiveis.push(l);
    });
    return Array.from(m.entries())
      .map(([funcao, v]) => ({ funcao, total: v.total, disponiveis: v.disponiveis.sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome)) }))
      .sort((a, b) => b.disponiveis.length - a.disponiveis.length || a.funcao.localeCompare(b.funcao));
  }, [linhasBase]);

  // Quantos por cada status, numa data de referência única (hoje, se estiver dentro do
  // período filtrado; senão o primeiro dia do período) — cruza com TODOS (linhasBase), mesmo
  // critério dos cartões por função acima, pra não zerar com o filtro de Status ativo.
  const statusReferenceDate = dates.length === 0 ? hoje : dates.includes(hoje) ? hoje : dates[0];
  const statusGroups = useMemo(() => {
    const idx = dates.indexOf(statusReferenceDate);
    if (idx < 0) return [];
    const m = new Map<ComputedStatus, typeof linhasBase>();
    linhasBase.forEach((l) => {
      const s = l.statusPorDia[idx]?.status;
      if (!s) return;
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(l);
    });
    const ordem: ComputedStatus[] = ["STB", "E", "DES", "DB", "FI", "F", "FE", "AT", "TE", "HTL", "DDN", "P"];
    return ordem
      .filter((s) => (m.get(s)?.length ?? 0) > 0)
      .map((s) => ({ status: s, pessoas: (m.get(s) ?? []).sort((a, b) => a.colaborador.nome.localeCompare(b.colaborador.nome)) }));
  }, [linhasBase, dates, statusReferenceDate]);
  // "Por status" começa recolhido (ao contrário da cascata de função) — Standby sozinho já
  // passa de 80 pessoas, não faz sentido abrir tudo de cara.
  const [expandedStatuses, setExpandedStatuses] = useState<Set<ComputedStatus>>(new Set());
  const toggleStatusExpanded = (status: ComputedStatus) => {
    setExpandedStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {focusNomination && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <span>
            <UserPlus className="mr-1.5 inline h-3.5 w-3.5" />
            Selecionando candidatos para: <span className="font-semibold">{focusNomination.funcao}</span>
            {focusNomination.unidade && ` — ${focusNomination.unidade}`}
            {focusNomination.bsp && ` ${focusNomination.bsp}`}
          </span>
          <Button size="sm" variant="outline" className="h-7 bg-white" onClick={onExitFocus}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Concluir seleção
          </Button>
        </div>
      )}
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
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Por status {statusReferenceDate === hoje ? "(hoje)" : `(em ${fmtDate(statusReferenceDate)})`}
        </p>
        <div className="flex flex-wrap gap-2">
          {statusGroups.map(({ status, pessoas }) => {
            const aberto = expandedStatuses.has(status);
            return (
              <div key={status} className={cn("rounded-md border text-xs", aberto && "w-full")}>
                <button
                  type="button" className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
                  aria-expanded={aberto} onClick={() => toggleStatusExpanded(status)}
                >
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded-sm px-1 text-[10px] font-bold"
                    style={{ backgroundColor: STATUS_COLOR[status], color: getContrastText(STATUS_COLOR[status]) }}
                  >
                    {displayAbbr(status)}
                  </span>
                  <span className="text-muted-foreground">{STATUS_LABEL[status]}</span>
                  <span className="font-semibold">{pessoas.length}</span>
                  {aberto ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                {aberto && (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 divide-y border-t px-2.5 py-2 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
                    {pessoas.map((l) => (
                      <div key={l.colaborador.id} className="pt-2 first:pt-0 sm:pt-0">
                        <p className="font-medium text-foreground">{l.colaborador.nome}</p>
                        <p className="text-muted-foreground">{l.funcao}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {statusGroups.length === 0 && <p className="text-xs text-muted-foreground">Nenhum status encontrado.</p>}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Disponíveis por função</p>
          <Button
            type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground"
            onClick={() => setCollapsedFuncoes(
              collapsedFuncoes.size < funcaoCards.length ? new Set(funcaoCards.map((f) => f.funcao)) : new Set(),
            )}
          >
            {collapsedFuncoes.size < funcaoCards.length ? (
              <><ChevronsDownUp className="mr-1 h-3.5 w-3.5" />Recolher tudo</>
            ) : (
              <><ChevronsUpDown className="mr-1 h-3.5 w-3.5" />Expandir tudo</>
            )}
          </Button>
        </div>
        <Card className="overflow-hidden">
          {funcaoCards.map((f) => {
            const aberto = !collapsedFuncoes.has(f.funcao);
            return (
              <div key={f.funcao} className="border-b last:border-b-0">
                <button
                  type="button" className="flex w-full items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-left"
                  aria-expanded={aberto} onClick={() => toggleFuncaoCollapsed(f.funcao)}
                >
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <Layers3 className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">{f.funcao}</span>
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-xs">{f.disponiveis.length} / {f.total}</Badge>
                </button>
                {aberto && (
                  f.disponiveis.length > 0 ? (
                    <div className="divide-y">
                      {f.disponiveis.map((l) => (
                        <div key={l.colaborador.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 pl-11 pr-4 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{l.colaborador.nome}</p>
                            {l.funcoesAno.length > 0 && (
                              <p className="text-xs text-muted-foreground">Já embarcou como: {l.funcoesAno.join(", ")}</p>
                            )}
                          </div>
                          {focusNomination && (
                            focusNomineeIds.has(l.colaborador.id) ? (
                              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-green-700">
                                <Check className="h-3 w-3" /> Adicionado
                              </span>
                            ) : (
                              <Button
                                size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs"
                                loading={addNominee.isPending && addNominee.variables?.id === l.colaborador.id}
                                onClick={() => addNominee.mutate({ id: l.colaborador.id, nome: l.colaborador.nome })}
                              >
                                <UserPlus className="mr-1 h-3 w-3" /> Adicionar
                              </Button>
                            )
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-3 pl-11 pr-4 text-xs text-muted-foreground/70">Nenhum disponível</p>
                  )
                )}
              </div>
            );
          })}
          {funcaoCards.length === 0 && <p className="p-4 text-xs text-muted-foreground">Nenhuma função encontrada.</p>}
        </Card>
      </div>
    </div>
  );
}

// Mesma chave/queryFn reaproveitada em vários componentes (NominationsPage, ManageDialog) —
// React Query dedup por chave, então isso não gera requisição extra; o ponto principal é o
// ManageDialog conseguir ler a versão SEMPRE atualizada da nomeação aberta (ao contrário de
// receber só um retrato estático via prop, que ficava desatualizado assim que qualquer
// mutação dentro do próprio dialog avançava a etapa).
function useAllNominations() {
  return useQuery<Nomination[]>({
    queryKey: ["nominations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("nominations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Nomination[];
    },
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

type NominationBspGroup = { name: string; nominations: Nomination[] };
type NominationUnitGroup = { name: string; bsps: NominationBspGroup[]; nominations: Nomination[] };
type NominationClientGroup = { name: string; units: NominationUnitGroup[]; nominations: Nomination[] };
type DrakeEmbarkedWorker = {
  id: string;
  nome: string;
  funcao: string | null;
  empresa: string | null;
};
type BmClientRelation = { client_name: string; vessel: string; project_name: string | null };

function hierarchyKey(value: string | null | undefined): string {
  return value?.trim().toLocaleUpperCase("pt-BR") ?? "";
}

// Normaliza unidade (apelidos conhecidos do Drake, ver normalizeUnidadeOperacional) e BSP
// (mesmo normalizeBmBspKey usado no BM, em bmUnitResolver.ts, que trata prefixo/hífen/espaço
// e apelidos de BSP) antes de comparar — sem isso, uma grafia levemente diferente entre o
// texto salvo na nomeação e o período do Drake ("Bravo" vs "BRAVO", "26-535-02" vs
// "26 - 535 - 02") faz a equipe embarcada nunca "casar" com a nomeação certa e sumir pra
// debaixo de "Cliente não identificado".
function drakeAssignmentKey(unit: string | null | undefined, bsp: string | null | undefined): string {
  return `${hierarchyKey(normalizeUnidadeOperacional(unit))}::${normalizeBmBspKey(bsp)}`;
}

// Dias entre duas datas YYYY-MM-DD (positivo = "data" ainda não chegou; negativo = já passou).
function diasAteData(data: string, referencia: string): number {
  const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(data) - parse(referencia)) / 86400000);
}

function ClientCascadeView({ nominations, nomineesByNomination, onOpen }: {
  nominations: Nomination[];
  nomineesByNomination: Map<string, NominationNominee[]>;
  onOpen: (nomination: Nomination) => void;
}) {
  const [search, setSearch] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  // Tudo começa aberto, como solicitado. Os sets guardam somente os itens recolhidos.
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set());
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());
  const [collapsedBsps, setCollapsedBsps] = useState<Set<string>>(new Set());
  const today = todayStr();
  const teamReferenceDate = periodStart || periodEnd || today;

  const toggleCollapsed = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const { data: currentDrakePeriods = [], isLoading: isLoadingDrake } = useQuery<HistNovoPeriodo[]>({
    queryKey: ["nominations-drake-teams-by-date", teamReferenceDate],
    queryFn: () => selectAllPages<HistNovoPeriodo>((from, to) =>
      supabase.from("hist_novo_periodos").select("*")
        .eq("tipo", "E").lte("data_inicio", teamReferenceDate).gte("data_fim", teamReferenceDate)
        .order("data_inicio").range(from, to),
    ),
  });

  const { data: bmClientRelations = [] } = useQuery<BmClientRelation[]>({
    queryKey: ["nominations-bm-client-relations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bms")
        .select("client_name, vessel, project_name").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BmClientRelation[];
    },
  });

  const currentDrakeWorkerIds = useMemo(() => Array.from(new Set(
    currentDrakePeriods.filter((period) => period.origem !== "programado").map((period) => period.colaborador_id),
  )).sort(), [currentDrakePeriods]);

  const { data: currentDrakeWorkers = [] } = useQuery<DrakeEmbarkedWorker[]>({
    queryKey: ["nominations-current-drake-workers", currentDrakeWorkerIds],
    enabled: currentDrakeWorkerIds.length > 0,
    queryFn: async () => {
      const batches: DrakeEmbarkedWorker[] = [];
      for (let index = 0; index < currentDrakeWorkerIds.length; index += 200) {
        const ids = currentDrakeWorkerIds.slice(index, index + 200);
        const { data, error } = await supabase.from("hist_novo_colaboradores")
          .select("id, nome, funcao, empresa").in("id", ids).order("nome");
        if (error) throw error;
        batches.push(...((data ?? []) as DrakeEmbarkedWorker[]));
      }
      return batches;
    },
  });

  // Função de embarque (Drake, ver resolverFuncaoEmbarque) — não a cadastral de
  // hist_novo_colaboradores acima, que pode não bater com a função real desse embarque.
  const { data: timesheetEmbarques = [] } = useQuery({
    queryKey: ["timesheet-embarques"],
    queryFn: () => selectAllPages<TimesheetEmbarque>((from, to) => supabase.from("timesheet_embarques").select("*").gte("data_fim_embarque", DRAKE_DATA_CUTOFF).order("id").range(from, to)),
  });
  const embarquesByColaboradorId = useMemo(() => {
    const m = new Map<string, TimesheetEmbarque[]>();
    timesheetEmbarques.forEach((e) => {
      if (!m.has(e.colaborador_id)) m.set(e.colaborador_id, []);
      m.get(e.colaborador_id)!.push(e);
    });
    return m;
  }, [timesheetEmbarques]);

  const drakeWorkersByAssignment = useMemo(() => {
    const workerById = new Map(currentDrakeWorkers.map((worker) => [worker.id, worker]));
    const result = new Map<string, { worker: DrakeEmbarkedWorker; period: HistNovoPeriodo }[]>();
    currentDrakePeriods.forEach((period) => {
      if (period.origem === "programado") return;
      const worker = workerById.get(period.colaborador_id);
      if (!worker) return;
      // Sem cair fora da lista quando o período não tem BSP preenchido — antes isso descartava
      // o embarcado por inteiro, silenciosamente, sem nem entrar no grupo de pendência.
      const bsp = bspDoPeriodo(period)?.trim() || "BSP não informado";
      const key = drakeAssignmentKey(period.unidade_operacional, bsp);
      if (!result.has(key)) result.set(key, []);
      if (!result.get(key)!.some((item) => item.worker.id === worker.id)) result.get(key)!.push({ worker, period });
    });
    result.forEach((items) => items.sort((a, b) => a.worker.nome.localeCompare(b.worker.nome, "pt-BR")));
    return result;
  }, [currentDrakePeriods, currentDrakeWorkers]);

  const visibleNominations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return nominations.filter((nomination) => {
      if (periodStart || periodEnd) {
        if (!nomination.period_start || !nomination.period_end) return false;
        // Sobreposição de períodos: basta ao menos um dia da nomeação estar dentro do filtro.
        if (periodStart && nomination.period_end < periodStart) return false;
        if (periodEnd && nomination.period_start > periodEnd) return false;
      }
      if (!query) return true;
      const nominees = nomineesByNomination.get(nomination.id) ?? [];
      return [nomination.client, nomination.bsp, nomination.funcao, nomination.project,
        nomination.pm_name, ...nominees.map((nominee) => nominee.colaborador_nome)]
        .some((value) => value?.toLocaleLowerCase("pt-BR").includes(query));
    });
  }, [nominations, nomineesByNomination, search, periodStart, periodEnd]);

  const groups = useMemo<NominationClientGroup[]>(() => {
    const clients = new Map<string, Map<string, Map<string, Nomination[]>>>();
    const ensureBsp = (client: string, unit: string, bsp: string): Nomination[] => {
      if (!clients.has(client)) clients.set(client, new Map());
      const units = clients.get(client)!;
      if (!units.has(unit)) units.set(unit, new Map());
      const bsps = units.get(unit)!;
      if (!bsps.has(bsp)) bsps.set(bsp, []);
      return bsps.get(bsp)!;
    };
    visibleNominations.forEach((nomination) => {
      const unit = nomination.unidade?.trim() || "Unidade não informada";
      // O vínculo confirmado por unidade é prioritário também para nomeações antigas que
      // tenham sido salvas sem cliente ou com cliente divergente.
      const client = clienteDaUnidade(unit) ?? (nomination.client?.trim() || "Cliente não informado");
      const bsp = nomination.bsp?.trim() || "BSP não informado";
      ensureBsp(client, unit, bsp).push(nomination);
    });
    // O Drake não possui coluna de cliente. A associação é recuperada das nomeações que já
    // relacionam aquele BSP a um cliente. BSPs ainda não conhecidos continuam visíveis num
    // grupo de pendência, em vez de serem descartados silenciosamente.
    const bspRelation = new Map<string, { client: string; bsp: string }>();
    const unitRelation = new Map<string, { client: string; unit: string }>();
    bmClientRelations.forEach((bm) => {
      const client = bm.client_name?.trim();
      const unit = bm.vessel?.trim();
      const bsp = bm.project_name?.trim();
      if (client && unit && !unitRelation.has(hierarchyKey(unit))) unitRelation.set(hierarchyKey(unit), { client, unit });
      if (client && bsp && !bspRelation.has(hierarchyKey(bsp))) bspRelation.set(hierarchyKey(bsp), { client, bsp });
    });
    nominations.forEach((nomination) => {
      const bsp = nomination.bsp?.trim();
      const unit = nomination.unidade?.trim();
      const client = nomination.client?.trim() || "Cliente não informado";
      if (unit) unitRelation.set(hierarchyKey(unit), { client, unit });
      if (bsp) bspRelation.set(hierarchyKey(bsp), {
        client,
        bsp,
      });
    });
    const query = search.trim().toLocaleLowerCase("pt-BR");
    drakeWorkersByAssignment.forEach((drakeTeam) => {
      const rawUnit = drakeTeam[0].period.unidade_operacional?.trim() || "Unidade não informada";
      const rawBsp = bspDoPeriodo(drakeTeam[0].period)?.trim() || "BSP não informado";
      const bspRelationFound = bspRelation.get(hierarchyKey(rawBsp));
      const unitRelationFound = unitRelation.get(hierarchyKey(rawUnit));
      const client = clienteDaUnidade(rawUnit) ?? bspRelationFound?.client ?? unitRelationFound?.client ?? "Cliente não identificado";
      const unit = unitRelationFound?.unit ?? rawUnit;
      const bsp = bspRelationFound?.bsp ?? rawBsp;
      const matchesDrakeSearch = !query || client.toLocaleLowerCase("pt-BR").includes(query)
        || unit.toLocaleLowerCase("pt-BR").includes(query)
        || bsp.toLocaleLowerCase("pt-BR").includes(query)
        || drakeTeam.some(({ worker }) => worker.nome.toLocaleLowerCase("pt-BR").includes(query));
      if (!matchesDrakeSearch) return;
      ensureBsp(client, unit, bsp);
    });
    return [...clients.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([name, units]) => {
      const unitGroups = [...units.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([unitName, bsps]) => {
        const bspGroups = [...bsps.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([bspName, items]) => ({
          name: bspName,
          nominations: [...items].sort((a, b) => (a.period_start ?? a.created_at).localeCompare(b.period_start ?? b.created_at)),
        }));
        return { name: unitName, bsps: bspGroups, nominations: bspGroups.flatMap((bsp) => bsp.nominations) };
      });
      return { name, units: unitGroups, nominations: unitGroups.flatMap((unit) => unit.nominations) };
    });
  }, [visibleNominations, nominations, bmClientRelations, drakeWorkersByAssignment, search]);

  const totalPositions = (items: Nomination[]) => items.reduce((sum, item) => sum + (item.quantidade || 1), 0);

  // Total e por unidade de quem está REALMENTE embarcado (Drake) em teamReferenceDate — hoje por
  // padrão, ou a data filtrada em "De"/"Até" — não confundir com totalPositions acima, que soma
  // vaga de nomeação (quantidade), não gente de fato embarcada agora.
  const embarqueSummary = useMemo(() => {
    let total = 0;
    const porUnidade: { unidade: string; total: number }[] = [];
    groups.forEach((client) => {
      client.units.forEach((unit) => {
        const unidadeTotal = unit.bsps.reduce(
          (sum, bsp) => sum + (drakeWorkersByAssignment.get(drakeAssignmentKey(unit.name, bsp.name))?.length ?? 0),
          0,
        );
        if (unidadeTotal > 0) porUnidade.push({ unidade: unit.name, total: unidadeTotal });
        total += unidadeTotal;
      });
    });
    porUnidade.sort((a, b) => b.total - a.total);
    return { total, porUnidade };
  }, [groups, drakeWorkersByAssignment]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar cliente, BSP, função ou profissional..." value={search}
          onChange={(event) => setSearch(event.target.value)} className="h-8 max-w-sm text-sm" />
        <div className="flex items-center gap-1.5">
          <Label htmlFor="cascade-period-start" className="text-xs text-muted-foreground">De</Label>
          <Input id="cascade-period-start" type="date" value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)} className="h-8 w-auto text-sm" />
        </div>
        <div className="flex items-center gap-1.5">
          <Label htmlFor="cascade-period-end" className="text-xs text-muted-foreground">Até</Label>
          <Input id="cascade-period-end" type="date" min={periodStart || undefined} value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)} className="h-8 w-auto text-sm" />
        </div>
        {(periodStart || periodEnd) && (
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => { setPeriodStart(""); setPeriodEnd(""); }}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Limpar período
          </Button>
        )}
        <Button
          type="button" size="sm" variant="ghost" className="h-8 ml-auto text-muted-foreground"
          onClick={() => {
            const tudoAberto = collapsedClients.size === 0 && collapsedUnits.size === 0 && collapsedBsps.size === 0;
            if (tudoAberto) {
              setCollapsedClients(new Set(groups.map((c) => c.name)));
              setCollapsedUnits(new Set(groups.flatMap((c) => c.units.map((u) => `${c.name}::${u.name}`))));
              setCollapsedBsps(new Set(groups.flatMap((c) => c.units.flatMap((u) => u.bsps.map((b) => `${c.name}::${u.name}::${b.name}`)))));
            } else {
              setCollapsedClients(new Set()); setCollapsedUnits(new Set()); setCollapsedBsps(new Set());
            }
          }}
        >
          {collapsedClients.size === 0 && collapsedUnits.size === 0 && collapsedBsps.size === 0 ? (
            <><ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" />Recolher tudo</>
          ) : (
            <><ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" />Expandir tudo</>
          )}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Card className="min-w-[150px] border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-primary/80">
            Total embarcado {teamReferenceDate === today ? "hoje" : `em ${fmtDate(teamReferenceDate)}`}
          </p>
          <p className="text-xl font-semibold text-primary">{embarqueSummary.total}</p>
        </Card>
        {embarqueSummary.porUnidade.map(({ unidade, total }) => (
          <Card key={unidade} className="min-w-[120px] px-3 py-2">
            <p className="max-w-[160px] truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground" title={unidade}>
              {unidade}
            </p>
            <p className="text-xl font-semibold">{total}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <div className="min-w-[980px]">
        {groups.length === 0 ? (
          <EmptyState icon={Layers3} title="Nenhuma nomeação encontrada" description="Ajuste a busca ou o período selecionado." />
        ) : groups.map((client) => {
          const clientOpen = !collapsedClients.has(client.name);
          return <div key={client.name} className="border-b last:border-b-0">
            <div className="flex w-full items-center bg-slate-50 px-4 py-3 text-left">
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                <button type="button" className="rounded p-0.5 hover:bg-slate-200" aria-label={clientOpen ? `Recolher ${client.name}` : `Abrir ${client.name}`}
                  aria-expanded={clientOpen} onClick={() => toggleCollapsed(setCollapsedClients, client.name)}>
                  {clientOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <Building2 className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{client.name}</span>
              </span>
            </div>
            {clientOpen && client.units.map((unit) => {
              const unitKey = `${client.name}::${unit.name}`;
              const unitOpen = !collapsedUnits.has(unitKey);
              return <div key={unitKey}>
                <div className="grid w-full grid-cols-[minmax(260px,1fr)_90px_180px_minmax(240px,1fr)_140px] items-center border-t bg-sky-50/60 px-4 py-2.5 text-left max-md:flex max-md:justify-between">
                  <span className="flex min-w-0 items-center gap-2 pl-7 font-semibold text-sky-950">
                    <button type="button" className="rounded p-0.5 hover:bg-sky-100" aria-label={unitOpen ? `Recolher ${unit.name}` : `Abrir ${unit.name}`}
                      aria-expanded={unitOpen} onClick={() => toggleCollapsed(setCollapsedUnits, unitKey)}>
                      {unitOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <Ship className="h-4 w-4 shrink-0 text-sky-700" /><span className="truncate">{unit.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">({unit.bsps.length} BSP)</span>
                  </span>
                  <span className="text-center text-sm font-medium max-md:hidden">{totalPositions(unit.nominations)}</span><span className="max-md:hidden">—</span><span className="max-md:hidden">—</span><span className="max-md:hidden">—</span>
                </div>
              {unitOpen && unit.bsps.map((bsp) => {
              const bspKey = `${unitKey}::${bsp.name}`;
              const bspOpen = !collapsedBsps.has(bspKey);
              const drakeTeam = drakeWorkersByAssignment.get(drakeAssignmentKey(unit.name, bsp.name)) ?? [];
              // Próxima troca de turma do BSP = desembarque mais próximo entre os embarcados —
              // é o próximo dia em que ALGUÉM daquele BSP precisa ser rendido.
              const proximaTrocaData = drakeTeam.length
                ? drakeTeam.reduce((min, t) => (t.period.data_fim < min ? t.period.data_fim : min), drakeTeam[0].period.data_fim)
                : null;
              const diasProximaTroca = proximaTrocaData ? diasAteData(proximaTrocaData, today) : null;
              const trocaUrgente = diasProximaTroca != null && diasProximaTroca <= 3;
              return <div key={bspKey}>
                <div className="grid w-full grid-cols-[minmax(260px,1fr)_90px_180px_minmax(240px,1fr)_140px] items-center border-t bg-white px-4 py-2.5 text-left max-md:flex max-md:justify-between">
                  <span className="flex min-w-0 flex-wrap items-center gap-2 pl-14 font-medium">
                    <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={bspOpen ? `Recolher ${bsp.name}` : `Abrir ${bsp.name}`}
                      aria-expanded={bspOpen} onClick={() => toggleCollapsed(setCollapsedBsps, bspKey)}>
                      {bspOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <Layers3 className="h-4 w-4 shrink-0 text-sky-600" /><span className="truncate">{bsp.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">({bsp.nominations.length})</span>
                    {drakeTeam.length > 0 && <Badge className="bg-emerald-100 font-normal text-emerald-800 hover:bg-emerald-100">{drakeTeam.length} embarcado(s) em {fmtDate(teamReferenceDate)}</Badge>}
                    {proximaTrocaData && (
                      <Badge
                        className={cn(
                          "font-normal",
                          trocaUrgente ? "bg-amber-100 text-amber-900 hover:bg-amber-100" : "bg-slate-100 text-slate-700 hover:bg-slate-100",
                        )}
                        title={trocaUrgente ? `Faltam ${diasProximaTroca} dia(s) — troca de turma próxima` : undefined}
                      >
                        {trocaUrgente && <AlertTriangle className="mr-1 h-3 w-3" />}
                        Próxima Troca de Turma: {fmtDate(proximaTrocaData)}
                      </Badge>
                    )}
                  </span>
                  <span className="text-center text-sm font-medium max-md:hidden">{totalPositions(bsp.nominations)}</span><span className="max-md:hidden">—</span><span className="max-md:hidden">—</span><span className="max-md:hidden">—</span>
                </div>
                {bspOpen && <div className="border-t bg-emerald-50/40 px-4 py-3 pl-[4.5rem]">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    <User className="h-3.5 w-3.5" /> Equipe embarcada em {fmtDate(teamReferenceDate)}
                  </div>
                  {isLoadingDrake ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando equipe atual...</div>
                  ) : drakeTeam.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {drakeTeam.map(({ worker, period }) => (
                        <div key={worker.id} className="rounded-md border border-emerald-200 bg-white px-3 py-2">
                          <p className="text-sm font-medium">{worker.nome}</p>
                          <p className="text-xs text-muted-foreground">{resolverFuncaoEmbarque(worker.id, teamReferenceDate, embarquesByColaboradorId, worker.funcao)}</p>
                          <p className="mt-1 text-xs text-emerald-700">Embarcado desde {fmtDate(period.data_inicio)} · previsto até {fmtDate(period.data_fim)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Nenhum profissional consta como embarcado em {fmtDate(teamReferenceDate)} neste BSP.</p>
                  )}
                </div>}
                {bspOpen && bsp.nominations.map((nomination) => {
                  const team = (nomineesByNomination.get(nomination.id) ?? [])
                    .filter((item) => item.is_active && item.technical_selected_at);
                  return <button key={nomination.id} type="button" onClick={() => onOpen(nomination)}
                    className="grid w-full grid-cols-[minmax(260px,1fr)_90px_180px_minmax(240px,1fr)_140px] items-center border-t px-4 py-3 text-left transition-colors hover:bg-primary/5 max-md:block">
                    <span className="min-w-0 pl-[4.5rem] max-md:pl-9">
                      <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{nomination.funcao}</span>
                        {nomination.sequence_number != null && <span className="text-xs font-normal text-muted-foreground">#{String(nomination.sequence_number).padStart(3, "0")}</span>}
                      </span>
                      {(nomination.project || nomination.pm_name) && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{nomination.project || nomination.pm_name}</span>}
                    </span>
                    <span className="text-center text-sm max-md:ml-9 max-md:mt-1 max-md:block max-md:text-left">{nomination.quantidade || 1}</span>
                    <span className="text-xs text-muted-foreground max-md:ml-9 max-md:mt-1 max-md:block">
                      {nomination.period_start && nomination.period_end ? `${fmtDate(nomination.period_start)} – ${fmtDate(nomination.period_end)}` : "Não informado"}
                    </span>
                    <span className="flex flex-wrap gap-1.5 max-md:ml-9 max-md:mt-2">
                      {team.length ? team.map((item) => <Badge key={item.id} variant="secondary" className="font-normal">{item.colaborador_nome}</Badge>)
                        : <span className="text-xs text-muted-foreground">Equipe ainda não definida</span>}
                    </span>
                    <span className="max-md:ml-9 max-md:mt-2 max-md:block"><StatusBadge status={nomination.current_status} /></span>
                  </button>;
                })}
              </div>;
            })}
              </div>;
            })}
          </div>;
        })}
        </div>
      </Card>
    </div>
  );
}

// Exportado pra ser reaproveitado como aba dentro do ambiente do Solicitante (ver
// src/routes/pm/index.tsx) — mesmo componente, mesmos dados, sem duplicar nada.
export function NominationsPage() {
  const [selected, setSelected]       = useState<Nomination | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("todos");
  const [search, setSearch]           = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [simulacaoFocus, setSimulacaoFocus] = useState<Nomination | null>(null);
  const [tab, setTab] = useState("simulacao");
  const { canViewAs, viewAsRole, setViewAsRole } = useViewAs();

  const goToSimulacao = (nomination: Nomination) => {
    setSimulacaoFocus(nomination);
    setTab("simulacao");
  };

  const { data: nominations = [], isLoading } = useAllNominations();

  const { data: allNominees = [] } = useQuery<NominationNominee[]>({
    queryKey: ["nomination-nominees-all"],
    queryFn: () =>
      selectAllPages<NominationNominee>((from, to) =>
        supabase.from("nomination_nominees").select("*").range(from, to),
      ),
  });
  const nomineesByNomination = useMemo(() => {
    const m = new Map<string, NominationNominee[]>();
    allNominees.forEach((n) => {
      if (!m.has(n.nomination_id)) m.set(n.nomination_id, []);
      m.get(n.nomination_id)!.push(n);
    });
    return m;
  }, [allNominees]);

  const filtered = useMemo(() => {
    let list = nominations;
    if (filterStatus !== "todos") list = list.filter((n) => n.current_status === filterStatus);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.funcao.toLowerCase().includes(q) ||
          (n.pm_name ?? "").toLowerCase().includes(q) ||
          (n.project ?? "").toLowerCase().includes(q) ||
          (n.client ?? "").toLowerCase().includes(q) ||
          (n.bsp ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [nominations, filterStatus, search]);

  const pendingCount = nominations.filter((n) => n.current_status !== "equipe_formada").length;

  // Esqueleto no formato final da página (cabeçalho + abas + colunas do kanban) — carrega
  // junto com a página em vez de aparecer tudo de uma vez só quando os dados chegam.
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {KANBAN_COLUMNS.map((c) => (
            <div key={c.id} className="min-w-[220px] flex-1 space-y-2 rounded-lg border p-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Nomeações</h1>
          <p className="text-sm text-muted-foreground">
            {pendingCount > 0 ? `${pendingCount} em andamento` : "Nenhuma nomeação em andamento"}
          </p>
        </div>
        {/* Só a conta master vê isto — troca o menu do topo pra pré-visualizar rápido o que
            cada papel enxerga, sem precisar de um segundo login de teste (ver useViewAs). */}
        {canViewAs && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Ver como outro papel">
                <Eye className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setViewAsRole(null)} className={!viewAsRole ? "font-medium" : undefined}>
                {!viewAsRole && <Check className="mr-2 h-3.5 w-3.5" />}Meu acesso (Operador Logístico)
              </DropdownMenuItem>
              {VIEW_AS_ROLES.map((r) => (
                <DropdownMenuItem key={r.value} onClick={() => setViewAsRole(r.value)} className={viewAsRole === r.value ? "font-medium" : undefined}>
                  {viewAsRole === r.value && <Check className="mr-2 h-3.5 w-3.5" />}{r.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="simulacao">Simulação</TabsTrigger>
          <TabsTrigger value="nomeacoes">Nomeações</TabsTrigger>
          <TabsTrigger value="clientes">
            <Building2 className="mr-1.5 h-3.5 w-3.5" /> Equipes Embarcadas
          </TabsTrigger>
          <TabsTrigger value="aptidao">
            <Stethoscope className="mr-1.5 h-3.5 w-3.5" /> Aptidão
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="mr-1.5 h-3.5 w-3.5" /> Configurações
          </TabsTrigger>
        </TabsList>

        {/* ── Simulação de disponibilidade ── */}
        <TabsContent value="simulacao" className="pt-4">
          <SimulacaoTab focusNomination={simulacaoFocus} onExitFocus={() => setSimulacaoFocus(null)} />
        </TabsContent>

        {/* ── Lista + Kanban lado a lado ── */}
        <TabsContent value="nomeacoes" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Buscar função, solicitante, BSP..."
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
            /* Kanban em tela cheia, como uma timeline horizontal — colunas sempre visíveis,
               mesmo sem nenhum card (a lista lateral foi removida, era redundante). */
            <div className="min-w-0 overflow-x-auto">
              <KanbanBoard
                nominations={filtered}
                nomineesByNomination={nomineesByNomination}
                highlightedId={highlightedId}
                onOpen={setSelected}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="clientes" className="pt-4">
          <ClientCascadeView
            nominations={nominations}
            nomineesByNomination={nomineesByNomination}
            onOpen={setSelected}
          />
        </TabsContent>

        {/* ── Aptidão (Matriz de Qualificação) ── */}
        <TabsContent value="aptidao" className="pt-4">
          <QualificationEligibilityTab />
        </TabsContent>

        {/* ── Configurações ── */}
        <TabsContent value="config" className="space-y-4 pt-4">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Tipos de Solda</h2>
            <WeldConfigPanel />
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Materiais de Solda</h2>
            <WeldMaterialConfigPanel />
          </Card>
        </TabsContent>
      </Tabs>

      {selected && (
        <ManageDialog
          nomination={selected}
          onClose={() => setSelected(null)}
          onGoToSimulacao={goToSimulacao}
        />
      )}
    </div>
  );
}
