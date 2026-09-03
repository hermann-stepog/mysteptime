import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// Tabelas ainda não migradas (transport_solicitations/nominations/nomination_nominees/
// weld_type_config/weld_material_config); cast local.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import {
  type Nomination, type NominationNominee, type NominationStatusHistory, type PmDecision,
  STATUS_LABELS, STATUS_BADGE, ALL_STATUSES,
  fmtDate, fmtDatetime, isSoldador, canMoveToColumn,
} from "@/lib/nominations";
import { notifyStageAdvance } from "@/lib/nominationEmails";
import { SearchableSelect } from "@/components/SearchableSelect";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { CLIENTES, clienteDaUnidade } from "@/lib/clientes";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, CalendarDays, ChevronRight, Check, X, Upload, FileText } from "lucide-react";
import { notify } from "@/lib/notify";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { pageTitle } from "@/lib/pageTitle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistogramaOffshoreNovo } from "@/routes/admin/histograma-novo";
import { NominationsPage } from "@/routes/admin/nominations";

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

// ── Checklist de Aprovação PM — único lugar onde o PM pode editar fora da criação ──────
// Precisa decidir (aprovado/reprovado) TODOS os nomeados ativos antes de conseguir avançar
// (regra confirmada com a usuária: sem avanço parcial). Ao confirmar, o próprio PM avança o
// card pra Validação SMS (ASO) (RLS: pm_nominations_advance_from_approval, restrito a essa
// transição).

function AprovacaoPmChecklist({ nomination, onDone }: { nomination: Nomination; onDone: () => void }) {
  const qc = useQueryClient();
  const { profile } = useAuth();

  const { data: nominees = [] } = useQuery<NominationNominee[]>({
    queryKey: ["pm-nomination-nominees", nomination.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("nomination_nominees").select("*").eq("nomination_id", nomination.id);
      if (error) throw error;
      return (data ?? []) as NominationNominee[];
    },
  });
  const ativos = nominees.filter((n) => n.is_active);
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
        changed_by_name: profile?.full_name ?? profile?.email ?? "Solicitante", notes: "Decisões de Aprovação PM confirmadas",
      });
      await notifyStageAdvance({ ...nomination, current_status: "validacao_sms_aso" }, "validacao_sms_aso");
    },
    onSuccess: () => {
      notify.success("Decisões enviadas.");
      qc.invalidateQueries({ queryKey: ["pm-nominations"] });
      qc.invalidateQueries({ queryKey: ["pm-nomination-nominees", nomination.id] });
      onDone();
    },
    onError: (err: Error) => notify.error(err.message || "Erro ao confirmar decisões."),
  });

  if (ativos.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum nomeado nesta solicitação ainda.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aprovação PM</p>
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
      <Button
        size="sm" disabled={!todosDecididos} loading={confirmar.isPending}
        onClick={() => confirmar.mutate()}
      >
        Confirmar decisões
      </Button>
      {!todosDecididos && <p className="text-xs text-muted-foreground">Decida todos os nomeados (✓ ou ✗) para poder confirmar.</p>}
    </div>
  );
}

// ── Status timeline (simplified for PM view) ──────────────────────────────────

function NominationDetail({ nom, onClose }: { nom: Nomination; onClose: () => void }) {
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
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{nom.funcao}</DialogTitle>
          <StatusBadge status={nom.current_status} />
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><span className="text-muted-foreground">Quantidade:</span> {nom.quantidade}</div>
            {nom.unidade && <div><span className="text-muted-foreground">Unidade:</span> {nom.unidade}</div>}
            {nom.bsp && <div><span className="text-muted-foreground">BSP:</span> {nom.bsp}</div>}
            {nom.period_start && nom.period_end && (
              <div><span className="text-muted-foreground">Período:</span> {fmtDate(nom.period_start)} – {fmtDate(nom.period_end)}</div>
            )}
            {nom.client && <div><span className="text-muted-foreground">Cliente:</span> {nom.client}</div>}
            {nom.project && <div><span className="text-muted-foreground">Projeto:</span> {nom.project}</div>}
            {nom.weld_type && <div><span className="text-muted-foreground">Tipo de solda:</span> {nom.weld_type}</div>}
            {nom.weld_material && <div><span className="text-muted-foreground">Material:</span> {nom.weld_material}</div>}
            {nom.scope_document_path && (
              <div className="col-span-2">
                <button
                  type="button" className="inline-flex items-center gap-1.5 text-primary hover:underline"
                  onClick={() => baixarEscopoDocumento(nom.scope_document_path!, nom.scope_document_name ?? "escopo-do-servico")}
                >
                  <FileText className="h-3.5 w-3.5" /> {nom.scope_document_name ?? "Baixar escopo do serviço"}
                </button>
              </div>
            )}
            {nom.notes && <div className="col-span-2 text-muted-foreground italic">{nom.notes}</div>}
          </div>

          {nom.requires_quality_validation
            && ALL_STATUSES.indexOf(nom.current_status) > ALL_STATUSES.indexOf("aprovacao_tecnica") && (
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                nom.quality_status === "aprovado"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : nom.quality_status === "reprovado"
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              Qualidade: {nom.quality_status === "aprovado" ? "Aprovada" : nom.quality_status === "reprovado" ? "Reprovada" : "Pendente"}
              {nom.quality_status === "reprovado" && nom.quality_rejection_reason && (
                <span className="text-xs font-normal opacity-80"> — {nom.quality_rejection_reason}</span>
              )}
            </div>
          )}

          {nom.current_status === "aprovacao_pm" && (
            <AprovacaoPmChecklist nomination={nom} onDone={onClose} />
          )}

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

// Uma solicitação pode pedir várias funções de uma vez (ex.: 2 Soldadores + 1 Caldeireiro) —
// cada função vira uma nomeação própria no banco/kanban (cada uma segue seu próprio fluxo de
// aprovação técnica/nomeação), todas compartilhando unidade/BSP/período/projeto/cliente.
// Soldador não pede mais tipo de solda/material em lista — em vez disso, anexa o escopo do
// serviço (documento) pra Qualidade avaliar e aprovar a qualificação a partir dele.
interface FuncaoLinha { funcao: string; quantidade: string; scopeFile: File | null }
function novaLinhaFuncao(): FuncaoLinha {
  return { funcao: "", quantidade: "1", scopeFile: null };
}

const SCOPE_DOCUMENT_TYPES = "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png";
const SCOPE_DOCUMENT_MAX_SIZE = 20 * 1024 * 1024;
const SCOPE_BUCKET = "nomeacoes-anexos";

async function uploadScopeDocument(file: File): Promise<{ path: string; name: string }> {
  if (!SCOPE_DOCUMENT_TYPES.split(",").includes(file.type)) {
    throw new Error("Formato não aceito. Envie PDF, Word, JPEG ou PNG.");
  }
  if (file.size > SCOPE_DOCUMENT_MAX_SIZE) throw new Error("Arquivo muito grande (máximo 20MB).");
  const nomeSeguro = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${crypto.randomUUID()}-${nomeSeguro}`;
  const { error } = await supabase.storage.from(SCOPE_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return { path, name: file.name };
}

async function baixarEscopoDocumento(path: string, nomeOriginal: string): Promise<void> {
  const { data, error } = await supabase.storage.from(SCOPE_BUCKET).download(path);
  if (error) { notify.error(error.message); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = nomeOriginal;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();

  const [linhas, setLinhas]         = useState<FuncaoLinha[]>([novaLinhaFuncao()]);
  const [unidade, setUnidade]       = useState("");
  const [bsp, setBsp]               = useState("");
  const [start, setStart]           = useState("");
  const [end, setEnd]               = useState("");
  const [client, setClient]         = useState("");
  const [notes, setNotes]           = useState("");

  const updateLinha = (i: number, patch: Partial<FuncaoLinha>) => {
    setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLinha = () => setLinhas((atual) => [...atual, novaLinhaFuncao()]);
  const removeLinha = (i: number) => setLinhas((atual) => (atual.length > 1 ? atual.filter((_, idx) => idx !== i) : atual));

  const { data: funcoesHistorico = [] } = useQuery<{ funcao: string }[]>({
    queryKey: ["pm-create-nomination-funcoes-historico"],
    queryFn: () =>
      selectAllPages((from, to) =>
        supabase.from("colaborador_funcoes_historico").select("funcao").order("data_inicio", { ascending: false }).range(from, to),
      ),
  });
  const { data: colaboradores = [] } = useQuery<{ funcao: string | null; funcao_operacao: string | null }[]>({
    queryKey: ["pm-create-nomination-colaboradores-funcoes"],
    queryFn: async () => (await supabase.from("hist_novo_colaboradores").select("funcao, funcao_operacao")).data ?? [],
  });
  const funcaoOptions = useMemo(() => {
    const s = new Set<string>();
    funcoesHistorico.forEach((f) => f.funcao && s.add(f.funcao));
    colaboradores.forEach((c) => { if (c.funcao_operacao) s.add(c.funcao_operacao); if (c.funcao) s.add(c.funcao); });
    return Array.from(s).sort();
  }, [funcoesHistorico, colaboradores]);

  const { data: periodos = [] } = useQuery<HistNovoPeriodo[]>({
    queryKey: ["pm-create-nomination-periodos"],
    queryFn: () =>
      selectAllPages<HistNovoPeriodo>((from, to) =>
        supabase.from("hist_novo_periodos").select("*").gte("data_fim", DRAKE_DATA_CUTOFF).order("data_inicio").range(from, to),
      ),
  });
  const periodosE = useMemo(() => periodos.filter((p) => p.tipo === "E"), [periodos]);

  // O Drake grava a mesma unidade com grafias diferentes ao longo do tempo (ex.: "BRAVO" num
  // período, "Bravo" ou "bravo" noutro) — agrupa por chave maiúscula pra não duplicar a mesma
  // unidade na lista, e guarda as grafias reais de cada grupo pra filtrar o BSP corretamente
  // (bspOptionsForUnidade precisa das grafias como estão gravadas, não da versão exibida).
  const unidadeGroups = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const key = trimmed.toUpperCase();
      if (!m.has(key)) m.set(key, new Set());
      m.get(key)!.add(trimmed);
    };
    UNIDADES_OPERACIONAIS_FIXAS.forEach(add);
    periodos.forEach((p) => { if (p.unidade_operacional) add(p.unidade_operacional); });
    return m;
  }, [periodos]);

  // Exibição normalizada: só a primeira letra maiúscula (pedido dela) — nunca altera o que
  // está gravado no banco, só como aparece na lista/valor selecionado.
  const unidadeOptions = useMemo(
    () => Array.from(unidadeGroups.keys()).map((k) => k.charAt(0) + k.slice(1).toLowerCase()).sort(),
    [unidadeGroups],
  );
  const bspOptions = useMemo(() => {
    if (!unidade) return bspOptionsForUnidade(periodosE, "all");
    const variantes = Array.from(unidadeGroups.get(unidade.toUpperCase()) ?? [unidade]);
    return bspOptionsForUnidade(periodosE, variantes);
  }, [periodosE, unidade, unidadeGroups]);

  const create = useMutation({
    mutationFn: async () => {
      const validas = linhas.filter((l) => l.funcao.trim());
      if (validas.length === 0) throw new Error("Adicione ao menos uma função.");
      if (!unidade) throw new Error("Selecione a unidade.");
      if (!bsp) throw new Error("Selecione a BSP.");
      const pmName = profile?.full_name ?? profile?.email ?? "Solicitante";

      // Uma nomeação por função — cada uma segue seu próprio fluxo de aprovação/nomeação,
      // por isso não dá pra combinar num só registro (diferente de um lançamento de viagem
      // em grupo, onde todos compartilham exatamente o mesmo evento). Soldador sempre passa
      // pela Qualidade — ela decide olhando o escopo do serviço anexado, não mais um tipo de
      // solda/material escolhido em lista.
      for (const l of validas) {
        const isWelder = isSoldador(l.funcao);
        const scopeDocument = l.scopeFile ? await uploadScopeDocument(l.scopeFile) : null;

        const { data, error } = await supabase
          .from("nominations")
          .insert({
            pm_user_id:                 user!.id,
            pm_name:                    pmName,
            funcao:                     l.funcao.trim(),
            quantidade:                 Math.max(1, Number(l.quantidade) || 1),
            unidade,
            bsp,
            weld_type:                  null,
            weld_material:               null,
            scope_document_path:        scopeDocument?.path ?? null,
            scope_document_name:        scopeDocument?.name ?? null,
            period_start:               start || null,
            period_end:                 end || null,
            project:                    null,
            client:                     client || null,
            notes:                      notes.trim() || null,
            requires_quality_validation: isWelder,
            current_status:              "solicitacao",
          })
          .select()
          .single();
        if (error) throw error;

        await supabase.from("nomination_status_history").insert({
          nomination_id:   data.id,
          status:          "solicitacao",
          changed_by_name: pmName,
          notes:           "Solicitação criada pelo solicitante",
        });
        await notifyStageAdvance(data as Nomination, "solicitacao");
      }
    },
    onSuccess: () => {
      const n = linhas.filter((l) => l.funcao.trim()).length;
      notify.success(n > 1 ? `${n} solicitações enviadas.` : "Solicitação enviada.");
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
          <div className="space-y-3">
            {linhas.map((l, i) => {
              const isWelder = isSoldador(l.funcao);
              return (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="grid grid-cols-[1fr_90px_auto] items-end gap-3">
                    <div className="space-y-1">
                      <Label>Função *</Label>
                      <SearchableSelect
                        value={l.funcao}
                        onValueChange={(v) => updateLinha(i, { funcao: v, scopeFile: null })}
                        options={funcaoOptions}
                        placeholder="Buscar função..."
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Qtd. *</Label>
                      <Input type="number" min={1} value={l.quantidade} onChange={(e) => updateLinha(i, { quantidade: e.target.value })} />
                    </div>
                    {linhas.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => removeLinha(i)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {isWelder && (
                    <div className="space-y-1">
                      <Label className="text-xs">Escopo do serviço (PDF, Word, JPEG ou PNG)</Label>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted">
                        <Upload className="h-3.5 w-3.5 shrink-0" />
                        {l.scopeFile ? l.scopeFile.name : "Selecionar arquivo..."}
                        <input
                          type="file" accept={SCOPE_DOCUMENT_TYPES} className="hidden"
                          onChange={(e) => updateLinha(i, { scopeFile: e.target.files?.[0] ?? null })}
                        />
                      </label>
                      <p className="text-[11px] text-muted-foreground">A Qualidade avalia o tipo de solda a partir deste documento antes de aprovar.</p>
                    </div>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={addLinha}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar função
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Unidade *</Label>
              <Select value={unidade} onValueChange={(v) => { setUnidade(v); setBsp(""); setClient(clienteDaUnidade(v) ?? ""); }}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>BSP *</Label>
              <Select value={bsp} onValueChange={setBsp} disabled={!unidade}>
                <SelectTrigger><SelectValue placeholder={unidade ? "Selecione" : "Escolha a unidade"} /></SelectTrigger>
                <SelectContent>
                  {bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Data início</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data fim</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Cliente</Label>
            <Select value={client} onValueChange={setClient}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {CLIENTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
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

// ── Minhas Solicitações (aba padrão do ambiente do Solicitante) ────────────────

function MinhasSolicitacoesTab() {
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

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-44" />
        </div>
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Minhas Solicitações</h1>
          <p className="text-sm text-muted-foreground">
            Olá, {profile?.full_name?.split(" ")[0] ?? "Solicitante"} — acompanhe o status de cada solicitação abaixo.
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

      {visible.length === 0 ? (
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
                  <p className="font-semibold text-sm">{nom.funcao}</p>
                  <p className="text-xs text-muted-foreground">{nom.unidade} {nom.bsp}</p>
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
                  {nom.current_status === "aprovacao_pm" && (
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Ação necessária</Badge>
                  )}
                  <StatusBadge status={nom.current_status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreate && <CreateDialog onClose={() => setShowCreate(false)} />}
      {selected && <NominationDetail nom={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Ambiente principal do Solicitante ───────────────────────────────────────────
// Histograma Offshore e Nomeações entram como abas aqui dentro (mesmos componentes já usados
// em /admin/*, só reaproveitados) em vez de links que levavam pra outro ambiente/header no
// meio da navegação — pedido dela.
function PmHome() {
  const [tab, setTab] = useState("solicitacoes");
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="solicitacoes">Minhas Solicitações</TabsTrigger>
        <TabsTrigger value="histograma">Histograma Offshore</TabsTrigger>
        <TabsTrigger value="nomeacoes">Nomeações</TabsTrigger>
      </TabsList>
      <TabsContent value="solicitacoes" className="pt-4">
        <MinhasSolicitacoesTab />
      </TabsContent>
      <TabsContent value="histograma" className="pt-4">
        <HistogramaOffshoreNovo />
      </TabsContent>
      <TabsContent value="nomeacoes" className="pt-4">
        <NominationsPage />
      </TabsContent>
    </Tabs>
  );
}
