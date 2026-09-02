import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// reembolsos/reembolso_itens/etc. ainda não estão nos tipos gerados (mesmo padrão de
// hospedagem.tsx/passagens-aereas.tsx) — cast local pra não bloquear o build.
const supabase: any = supabaseTyped;
import { matchesNameSearch } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { NomeUsuarioField } from "@/components/LogisticaFormFields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wallet, Plus, Pencil, Trash2, Check, Camera, Paperclip, Download, AlertTriangle, ListChecks,
} from "lucide-react";
import { notify } from "@/lib/notify";
import { pageTitle } from "@/lib/pageTitle";
import { cn } from "@/lib/utils";
import { selectAllPages } from "@/lib/supabasePaginate";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import {
  CATEGORIAS_REEMBOLSO,
  STATUS_FLUXO_REEMBOLSO_ORDER, STATUS_FLUXO_REEMBOLSO_LABEL, STATUS_FLUXO_REEMBOLSO_COLOR,
  STATUS_FLUXO_REEMBOLSO_RESPONSAVEL, STATUS_FLUXO_REEMBOLSO_PROXIMA_ACAO,
  type Reembolso, type ReembolsoItem, type ReembolsoStatusHistory, type ReembolsoAnexo,
  type StatusFluxoReembolso, type CategoriaReembolso, type TipoAnexoReembolso,
} from "@/lib/reembolsos";
import { useAuth } from "@/hooks/useAuth";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";

export const Route = createFileRoute("/admin/reembolsos")({ head: () => pageTitle("Reembolsos"), component: ReembolsosPage });

function fmt(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

function fmtMoney(n: number): string {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const BUCKET = "reembolsos-anexos";
const TIPOS_ARQUIVO_ACEITOS = "application/pdf,image/jpeg,image/png,image/webp";
const TAMANHO_MAXIMO = 20 * 1024 * 1024;

// ─── Queries ─────────────────────────────────────────────────────────────────
function useReembolsosQuery() {
  return useQuery<Reembolso[]>({
    queryKey: ["reembolsos"],
    queryFn: () => selectAllPages<Reembolso>((from, to) =>
      supabase.from("reembolsos").select("*").order("created_at", { ascending: false }).range(from, to),
    ),
    // Mesmo padrão de atualização automática do Transporte/Passagens Aéreas — sem Realtime,
    // só uma checagem periódica, pra tela do fluxo de aprovação não ficar parada.
    refetchInterval: 10000,
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

interface ColaboradorBasico { id: string; nome: string; funcao: string | null; funcao_operacao: string | null; }
function useColaboradoresQuery() {
  return useQuery<ColaboradorBasico[]>({
    queryKey: ["hist-novo-colaboradores"],
    queryFn: () => selectAllPages<ColaboradorBasico>((from, to) =>
      supabase.from("hist_novo_colaboradores").select("id, nome, funcao, funcao_operacao").order("nome").range(from, to),
    ),
  });
}

function useReembolsoItensQuery(reembolsoId: string | null) {
  return useQuery<ReembolsoItem[]>({
    queryKey: ["reembolso-itens", reembolsoId],
    queryFn: () => selectAllPages<ReembolsoItem>((from, to) =>
      supabase.from("reembolso_itens").select("*").eq("reembolso_id", reembolsoId).order("data_despesa").range(from, to),
    ),
    enabled: !!reembolsoId,
  });
}

function useReembolsoHistoricoQuery(reembolsoId: string | null) {
  return useQuery<ReembolsoStatusHistory[]>({
    queryKey: ["reembolso-historico", reembolsoId],
    queryFn: () => selectAllPages<ReembolsoStatusHistory>((from, to) =>
      supabase.from("reembolso_status_history").select("*").eq("reembolso_id", reembolsoId).order("changed_at", { ascending: false }).range(from, to),
    ),
    enabled: !!reembolsoId,
  });
}

function useReembolsoAnexosQuery(reembolsoId: string | null) {
  return useQuery<ReembolsoAnexo[]>({
    queryKey: ["reembolso-anexos", reembolsoId],
    queryFn: () => selectAllPages<ReembolsoAnexo>((from, to) =>
      supabase.from("reembolso_anexos").select("*").eq("reembolso_id", reembolsoId).order("enviado_em").range(from, to),
    ),
    enabled: !!reembolsoId,
  });
}

// ─── Anexos (upload/download direto via Supabase Storage — sem server function, mesmo
// padrão do único outro módulo do repositório que já faz isso, o BM Mob/Desmob) ────────────
async function uploadReembolsoAnexo(params: {
  reembolsoId: string; itemId: string | null; tipo: TipoAnexoReembolso; file: File; enviadoPor: string;
}): Promise<void> {
  if (!TIPOS_ARQUIVO_ACEITOS.split(",").includes(params.file.type)) {
    throw new Error("Formato não aceito. Envie PDF, JPEG, PNG ou WEBP.");
  }
  if (params.file.size > TAMANHO_MAXIMO) throw new Error("Arquivo muito grande (máximo 20MB).");
  const anexoId = crypto.randomUUID();
  const nomeSeguro = params.file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = params.itemId
    ? `reembolsos/${params.reembolsoId}/itens/${params.itemId}/${anexoId}-${nomeSeguro}`
    : `reembolsos/${params.reembolsoId}/${anexoId}-${nomeSeguro}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, params.file, { contentType: params.file.type });
  if (upErr) throw upErr;
  const { error: insErr } = await supabase.from("reembolso_anexos").insert({
    id: anexoId, reembolso_id: params.reembolsoId, item_id: params.itemId, tipo: params.tipo,
    storage_path: path, nome_original: params.file.name, enviado_por: params.enviadoPor,
  });
  if (insErr) throw insErr;
}

async function baixarAnexo(anexo: ReembolsoAnexo): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).download(anexo.storage_path);
  if (error) { notify.error(error.message); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = anexo.nome_original;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Botão duplo "Tirar foto" (câmera traseira no celular) / "Anexar arquivo" (galeria/desktop) —
// os dois só diferem pelo atributo capture, que não existe pra escolher da galeria.
function BotoesAnexo({ onSelect, disabled }: { onSelect: (file: File) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1">
      <label className={cn("inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted", disabled && "pointer-events-none opacity-50")}>
        <Camera className="h-3 w-3" />Tirar foto
        <input type="file" accept={TIPOS_ARQUIVO_ACEITOS} capture="environment" className="hidden" disabled={disabled}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); e.target.value = ""; }} />
      </label>
      <label className={cn("inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted", disabled && "pointer-events-none opacity-50")}>
        <Paperclip className="h-3 w-3" />Anexar arquivo
        <input type="file" accept={TIPOS_ARQUIVO_ACEITOS} className="hidden" disabled={disabled}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); e.target.value = ""; }} />
      </label>
    </div>
  );
}

function AnexoChip({ anexo, onDelete }: { anexo: ReembolsoAnexo; onDelete?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]">
      <button type="button" className="flex items-center gap-1 hover:underline" onClick={() => baixarAnexo(anexo)} title="Baixar">
        <Download className="h-3 w-3" /><span className="max-w-32 truncate">{anexo.nome_original}</span>
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="Remover">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

// ─── Dialog: Nova solicitação / Editar cabeçalho ────────────────────────────────────────
const FORM_VAZIO_REEMBOLSO = {
  solicitante: "", colaboradorBeneficiario: "", mesmoBeneficiario: true,
  unidade: "", bsp: "", periodoInicio: "", periodoFim: "", observacoes: "",
};

function ReembolsoFormDialog({ open, onOpenChange, editing, periodosE, colaboradores, unidadeOptions }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: Reembolso | null;
  periodosE: HistNovoPeriodo[]; colaboradores: { id: string; nome: string }[]; unidadeOptions: string[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(FORM_VAZIO_REEMBOLSO);
  const [bound, setBound] = useState<string | null>(null);

  if (open && editing && bound !== editing.id) {
    const mesmo = editing.colaborador_beneficiario === editing.solicitante;
    setF({
      solicitante: editing.solicitante, colaboradorBeneficiario: editing.colaborador_beneficiario,
      mesmoBeneficiario: mesmo, unidade: editing.unidade, bsp: editing.bsp,
      periodoInicio: editing.periodo_inicio, periodoFim: editing.periodo_fim,
      observacoes: editing.observacoes ?? "",
    });
    setBound(editing.id);
  }
  if (open && !editing && bound !== "novo") { setF(FORM_VAZIO_REEMBOLSO); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, f.unidade || "all"), [periodosE, f.unidade]);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.solicitante.trim()) throw new Error("Informe o solicitante.");
      if (!f.unidade) throw new Error("Selecione a unidade.");
      if (!f.bsp) throw new Error("Selecione o BSP.");
      if (!f.periodoInicio || !f.periodoFim) throw new Error("Informe o período de referência.");
      if (f.periodoFim < f.periodoInicio) throw new Error("O fim do período não pode ser antes do início.");
      const payload = {
        solicitante: f.solicitante.trim(),
        colaborador_beneficiario: f.mesmoBeneficiario ? f.solicitante.trim() : (f.colaboradorBeneficiario.trim() || f.solicitante.trim()),
        unidade: f.unidade, bsp: f.bsp,
        periodo_inicio: f.periodoInicio, periodo_fim: f.periodoFim,
        observacoes: f.observacoes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("reembolsos").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("reembolsos").insert({ ...payload, status_fluxo: "solicitado" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
      notify.success(editing ? "Solicitação atualizada" : "Solicitação criada");
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar solicitação" : "Nova solicitação de reembolso"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Solicitante</Label>
            <NomeUsuarioField value={f.solicitante} onChange={(v) => setF({ ...f, solicitante: v })} colaboradores={colaboradores} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.mesmoBeneficiario} onCheckedChange={(v) => setF({ ...f, mesmoBeneficiario: !!v })} />
            O colaborador beneficiário é o mesmo solicitante
          </label>
          {!f.mesmoBeneficiario && (
            <div>
              <Label className="text-xs">Colaborador beneficiário</Label>
              <NomeUsuarioField value={f.colaboradorBeneficiario} onChange={(v) => setF({ ...f, colaboradorBeneficiario: v })} colaboradores={colaboradores} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Unidade</Label>
              <Select value={f.unidade} onValueChange={(v) => setF({ ...f, unidade: v, bsp: "" })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{unidadeOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">BSP / Setor de utilização</Label>
              <Select value={f.bsp} onValueChange={(v) => setF({ ...f, bsp: v })} disabled={!f.unidade}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{bspOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Período de referência — de</Label>
              <Input type="date" value={f.periodoInicio} onChange={(e) => setF({ ...f, periodoInicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Período de referência — até</Label>
              <Input type="date" value={f.periodoFim} onChange={(e) => setF({ ...f, periodoFim: e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: Gerenciar (itens, anexos, fluxo, histórico) ────────────────────────────────
const NOVO_ITEM_VAZIO = { dataDespesa: "", bsp: "", categoria: "Alimentação" as CategoriaReembolso, categoriaOutro: "", valor: "" };

function GerenciarReembolsoDialog({ reembolso, open, onOpenChange, periodosE, onEditarCabecalho }: {
  reembolso: Reembolso | null; open: boolean; onOpenChange: (o: boolean) => void;
  periodosE: HistNovoPeriodo[]; onEditarCabecalho: () => void;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const displayName = profile?.full_name || profile?.email || "Usuário";
  const reembolsoId = reembolso?.id ?? null;

  const { data: itens = [] } = useReembolsoItensQuery(reembolsoId);
  const { data: historico = [] } = useReembolsoHistoricoQuery(reembolsoId);
  const { data: anexos = [] } = useReembolsoAnexosQuery(reembolsoId);

  const [novoItem, setNovoItem] = useState(NOVO_ITEM_VAZIO);
  const [editandoItemId, setEditandoItemId] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [bound, setBound] = useState<string | null>(null);

  if (open && reembolso && bound !== reembolso.id) {
    setNovoItem({ ...NOVO_ITEM_VAZIO, bsp: reembolso.bsp });
    setEditandoItemId(null); setComentario(""); setDataPagamento(reembolso.data_pagamento ?? "");
    setBound(reembolso.id);
  }
  if (!open && bound !== null) setBound(null);

  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, reembolso?.unidade || "all"), [periodosE, reembolso?.unidade]);

  const invalidarItens = () => {
    qc.invalidateQueries({ queryKey: ["reembolso-itens", reembolsoId] });
    qc.invalidateQueries({ queryKey: ["reembolsos"] }); // valor_total mudou (trigger)
  };

  const salvarItem = useMutation({
    mutationFn: async () => {
      if (!reembolso) return;
      if (!novoItem.dataDespesa) throw new Error("Informe a data da despesa.");
      if (!novoItem.bsp) throw new Error("Selecione o BSP.");
      if (!novoItem.valor || Number(novoItem.valor) <= 0) throw new Error("Informe um valor válido.");
      if (novoItem.categoria === "Outros" && !novoItem.categoriaOutro.trim()) throw new Error("Descreva a categoria em \"Outros\".");
      const payload = {
        reembolso_id: reembolso.id, data_despesa: novoItem.dataDespesa, bsp: novoItem.bsp,
        categoria: novoItem.categoria, categoria_outro: novoItem.categoria === "Outros" ? novoItem.categoriaOutro.trim() : null,
        valor: Number(novoItem.valor),
      };
      if (editandoItemId) {
        const { error } = await supabase.from("reembolso_itens").update(payload).eq("id", editandoItemId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("reembolso_itens").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidarItens();
      setNovoItem({ ...NOVO_ITEM_VAZIO, bsp: reembolso?.bsp ?? "" });
      setEditandoItemId(null);
    },
    onError: (e: any) => notify.error(e.message),
  });

  const excluirItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reembolso_itens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidarItens,
    onError: (e: any) => notify.error(e.message),
  });

  const enviarAnexo = useMutation({
    mutationFn: async (params: { itemId: string | null; tipo: TipoAnexoReembolso; file: File }) => {
      if (!reembolso) return;
      await uploadReembolsoAnexo({ reembolsoId: reembolso.id, itemId: params.itemId, tipo: params.tipo, file: params.file, enviadoPor: displayName });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reembolso-anexos", reembolsoId] }),
    onError: (e: any) => notify.error(e.message),
  });

  const excluirAnexo = useMutation({
    mutationFn: async (anexo: ReembolsoAnexo) => {
      await supabase.storage.from(BUCKET).remove([anexo.storage_path]);
      const { error } = await supabase.from("reembolso_anexos").delete().eq("id", anexo.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reembolso-anexos", reembolsoId] }),
    onError: (e: any) => notify.error(e.message),
  });

  const avancar = useMutation({
    mutationFn: async ({ novoStatus, extra, notes }: { novoStatus: StatusFluxoReembolso; extra?: Record<string, unknown>; notes?: string }) => {
      if (!reembolso) return;
      const { error } = await supabase.from("reembolsos").update({ status_fluxo: novoStatus, ...extra }).eq("id", reembolso.id);
      if (error) throw error;
      const { error: he } = await supabase.from("reembolso_status_history").insert({
        reembolso_id: reembolso.id, status: novoStatus, changed_by_name: displayName, notes: notes || null,
      });
      if (he) throw he;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
      qc.invalidateQueries({ queryKey: ["reembolso-historico", reembolsoId] });
      notify.success("Etapa atualizada");
      setComentario("");
    },
    onError: (e: any) => notify.error(e.message),
  });

  // useMemo precisa vir antes de qualquer "return" condicional (regras dos Hooks) — por isso
  // fica aqui em cima, mesmo dependendo só de `anexos` (que já é [] quando reembolso é null,
  // já que useReembolsoAnexosQuery fica `enabled: false` nesse caso).
  const anexosPorItem = useMemo(() => {
    const m = new Map<string, ReembolsoAnexo[]>();
    anexos.filter((a) => a.item_id).forEach((a) => m.set(a.item_id!, [...(m.get(a.item_id!) ?? []), a]));
    return m;
  }, [anexos]);

  if (!reembolso) return null;
  const status = reembolso.status_fluxo;
  const editavel = status === "solicitado";
  const anexosGerais = anexos.filter((a) => !a.item_id);
  const temComprovantePagamento = anexos.some((a) => a.tipo === "comprovante_pagamento");
  const itensSemNota = itens.filter((it) => !(anexosPorItem.get(it.id)?.length));

  const statusParaStepper = status === "rejeitado" ? "em_analise" : status;
  const idxAtual = STATUS_FLUXO_REEMBOLSO_ORDER.indexOf(statusParaStepper);

  const aprovar = () => {
    if (itensSemNota.length > 0 && !window.confirm(`${itensSemNota.length} item(ns) sem nota fiscal anexada. Aprovar mesmo assim?`)) return;
    avancar.mutate({ novoStatus: "aprovado", extra: { aprovado_por: displayName, aprovado_em: new Date().toISOString(), comentario_aprovacao: null } });
  };
  const rejeitar = () => {
    if (!comentario.trim()) { notify.error("Descreva o motivo da rejeição."); return; }
    avancar.mutate({ novoStatus: "rejeitado", extra: { comentario_aprovacao: comentario.trim() }, notes: comentario.trim() });
  };
  const marcarReembolsado = () => {
    if (!dataPagamento) { notify.error("Informe a data do pagamento."); return; }
    if (!temComprovantePagamento && !window.confirm("Nenhum comprovante de pagamento anexado. Confirmar reembolso mesmo assim?")) return;
    avancar.mutate({ novoStatus: "reembolsado", extra: { data_pagamento: dataPagamento } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Reembolso — {reembolso.colaborador_beneficiario}
            {editavel && (
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Editar cabeçalho" onClick={onEditarCabecalho}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {reembolso.unidade} · BSP {reembolso.bsp} · Solicitante: {reembolso.solicitante} · {fmt(reembolso.periodo_inicio)} – {fmt(reembolso.periodo_fim)}
          </p>
          {reembolso.observacoes && <p className="text-xs italic text-muted-foreground">{reembolso.observacoes}</p>}

          {/* Barra de etapas */}
          <div className="flex items-start">
            {STATUS_FLUXO_REEMBOLSO_ORDER.map((s, i) => {
              const atual = i === idxAtual;
              const passada = i < idxAtual;
              return (
                <div key={s} className="flex flex-1 flex-col items-center last:flex-none">
                  <div className="flex w-full items-center">
                    <div className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      atual ? `${STATUS_FLUXO_REEMBOLSO_COLOR[s].bg} ${STATUS_FLUXO_REEMBOLSO_COLOR[s].text} ring-2 ring-offset-1 ring-current`
                        : passada ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground/60",
                    )}>
                      {passada ? <Check className="h-3 w-3" /> : i + 1}
                    </div>
                    {i < STATUS_FLUXO_REEMBOLSO_ORDER.length - 1 && (
                      <div className={cn("mx-1 h-0.5 flex-1", passada ? "bg-emerald-600" : "bg-muted")} />
                    )}
                  </div>
                  <span className={cn("mt-1 max-w-16 text-center text-[10px] leading-tight", atual ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    {STATUS_FLUXO_REEMBOLSO_LABEL[s]}
                  </span>
                </div>
              );
            })}
          </div>

          {status === "rejeitado" ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <p className="font-semibold">Rejeitado</p>
              {reembolso.comentario_aprovacao && <p className="mt-0.5">{reembolso.comentario_aprovacao}</p>}
            </div>
          ) : status !== "concluido" && (
            <p className="text-xs text-muted-foreground">
              Responsável agora: <strong className="text-foreground">{STATUS_FLUXO_REEMBOLSO_RESPONSAVEL[status]}</strong>
              {" · "}Próxima ação: {STATUS_FLUXO_REEMBOLSO_PROXIMA_ACAO[status]}
            </p>
          )}

          {/* Itens de despesa */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens de despesa</p>
            {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item lançado ainda.</p>}
            <div className="space-y-2">
              {itens.map((it) => {
                const anexosItem = anexosPorItem.get(it.id) ?? [];
                const semNota = anexosItem.length === 0;
                return (
                  <div key={it.id} className={cn("space-y-1.5 rounded-md border p-2", semNota && "border-amber-300 bg-amber-50")}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{fmt(it.data_despesa)}</span>
                        <span className="text-muted-foreground">BSP {it.bsp}</span>
                        <span className="text-muted-foreground">{it.categoria === "Outros" ? it.categoria_outro : it.categoria}</span>
                        {semNota && (
                          <span className="flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3 w-3" />Sem nota fiscal
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{fmtMoney(it.valor)}</span>
                        {editavel && (
                          <>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                              setEditandoItemId(it.id);
                              setNovoItem({ dataDespesa: it.data_despesa, bsp: it.bsp, categoria: it.categoria, categoriaOutro: it.categoria_outro ?? "", valor: String(it.valor) });
                            }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => excluirItem.mutate(it.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {anexosItem.map((a) => (
                        <AnexoChip key={a.id} anexo={a} onDelete={editavel ? () => excluirAnexo.mutate(a) : undefined} />
                      ))}
                      {editavel && (
                        <BotoesAnexo onSelect={(file) => enviarAnexo.mutate({ itemId: it.id, tipo: "nota_fiscal", file })} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {editavel && (
              <div className="grid grid-cols-1 gap-2 border-t pt-2 sm:grid-cols-5 sm:items-end">
                <div>
                  <Label className="text-[10px]">Data</Label>
                  <Input type="date" className="h-8 text-xs" value={novoItem.dataDespesa} onChange={(e) => setNovoItem({ ...novoItem, dataDespesa: e.target.value })} />
                </div>
                <div>
                  <Label className="text-[10px]">BSP</Label>
                  <Select value={novoItem.bsp} onValueChange={(v) => setNovoItem({ ...novoItem, bsp: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">Categoria</Label>
                  <Select value={novoItem.categoria} onValueChange={(v) => setNovoItem({ ...novoItem, categoria: v as CategoriaReembolso })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIAS_REEMBOLSO.map((c) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {novoItem.categoria === "Outros" ? (
                  <div>
                    <Label className="text-[10px]">Descrição</Label>
                    <Input className="h-8 text-xs" placeholder="Descreva a despesa" value={novoItem.categoriaOutro} onChange={(e) => setNovoItem({ ...novoItem, categoriaOutro: e.target.value })} />
                  </div>
                ) : <div />}
                <div className="flex gap-1">
                  <div className="flex-1">
                    <Label className="text-[10px]">Valor</Label>
                    <Input type="number" step="0.01" min="0" className="h-8 text-xs" value={novoItem.valor} onChange={(e) => setNovoItem({ ...novoItem, valor: e.target.value })} />
                  </div>
                  <Button
                    size="sm" className="h-8 shrink-0" onClick={() => salvarItem.mutate()} disabled={salvarItem.isPending}
                    aria-label={editandoItemId ? "Salvar item" : "Adicionar item"}
                  >
                    {editandoItemId ? "Salvar" : <Plus className="h-4 w-4" />}
                  </Button>
                  {editandoItemId && (
                    <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setEditandoItemId(null); setNovoItem({ ...NOVO_ITEM_VAZIO, bsp: reembolso.bsp }); }}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>Total</span><span>{fmtMoney(reembolso.valor_total)}</span>
            </div>
          </div>

          {/* Anexos gerais */}
          <div className="space-y-1.5 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anexos da solicitação</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {anexosGerais.filter((a) => a.tipo === "formulario").map((a) => (
                <AnexoChip key={a.id} anexo={a} onDelete={() => excluirAnexo.mutate(a)} />
              ))}
              <BotoesAnexo onSelect={(file) => enviarAnexo.mutate({ itemId: null, tipo: "formulario", file })} />
            </div>
          </div>

          {/* Ações por etapa */}
          <div className="space-y-2 rounded-md border p-3">
            {status === "solicitado" && (
              <Button size="sm" onClick={() => avancar.mutate({ novoStatus: "em_analise" })}>Marcar em análise</Button>
            )}
            {status === "em_analise" && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button size="sm" onClick={aprovar}>Aprovar</Button>
                </div>
                <div className="flex gap-2">
                  <Textarea placeholder="Motivo da rejeição" value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="text-xs" />
                  <Button size="sm" variant="destructive" onClick={rejeitar} className="shrink-0 self-start">Rejeitar</Button>
                </div>
              </div>
            )}
            {status === "aprovado" && (
              <Button size="sm" onClick={() => avancar.mutate({ novoStatus: "aguardando_pagamento" })}>Marcar aguardando pagamento</Button>
            )}
            {status === "rejeitado" && (
              <Button size="sm" onClick={() => avancar.mutate({ novoStatus: "solicitado", notes: "Reaberto para correção" })}>Reabrir para correção</Button>
            )}
            {status === "aguardando_pagamento" && (
              <div className="space-y-2">
                <div>
                  <Label className="text-[10px]">Data do pagamento</Label>
                  <Input type="date" className="h-8 w-40 text-xs" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {anexosGerais.filter((a) => a.tipo === "comprovante_pagamento").map((a) => (
                    <AnexoChip key={a.id} anexo={a} onDelete={() => excluirAnexo.mutate(a)} />
                  ))}
                  <BotoesAnexo onSelect={(file) => enviarAnexo.mutate({ itemId: null, tipo: "comprovante_pagamento", file })} />
                </div>
                <Button size="sm" onClick={marcarReembolsado}>Marcar reembolsado</Button>
              </div>
            )}
            {status === "reembolsado" && (
              <Button size="sm" onClick={() => avancar.mutate({ novoStatus: "concluido" })}>Concluir</Button>
            )}
            {status === "concluido" && <p className="text-xs text-muted-foreground">Solicitação concluída.</p>}
          </div>

          {/* Histórico */}
          {historico.length > 0 && (
            <div className="space-y-1.5 rounded-md border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</p>
              <div className="space-y-1 text-xs">
                {historico.map((h) => (
                  <div key={h.id} className="flex flex-wrap justify-between gap-x-2 text-muted-foreground">
                    <span>{new Date(h.changed_at).toLocaleString("pt-BR")} · {h.changed_by_name} · {STATUS_FLUXO_REEMBOLSO_LABEL[h.status]}</span>
                    {h.notes && <span className="italic">{h.notes}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card mobile ─────────────────────────────────────────────────────────────
function ReembolsoCard({ r, onOpen }: { r: Reembolso; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer space-y-1.5 p-3" onClick={onOpen}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{r.colaborador_beneficiario}</span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_FLUXO_REEMBOLSO_COLOR[r.status_fluxo].bg, STATUS_FLUXO_REEMBOLSO_COLOR[r.status_fluxo].text)}>
          {STATUS_FLUXO_REEMBOLSO_LABEL[r.status_fluxo]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{r.unidade} · BSP {r.bsp}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{fmt(r.periodo_inicio)} – {fmt(r.periodo_fim)}</span>
        <span className="font-semibold">{fmtMoney(r.valor_total)}</span>
      </div>
    </Card>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────
type ReembolsosSortColumn = "unidade" | "bsp" | "nome" | "periodo" | "total" | "status";

function RelatoriosReembolsosTab() {
  const qc = useQueryClient();
  const { data: reembolsos = [], isLoading: l1 } = useReembolsosQuery();
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
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterNome, setFilterNome] = useState("");
  const [filterPeriodoDe, setFilterPeriodoDe] = useState("");
  const [filterPeriodoAte, setFilterPeriodoAte] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reembolso | null>(null);
  // Guarda só o id — deriva o registro "ao vivo" da lista (que já é atualizada por
  // refetchInterval/invalidateQueries), pra o total recalculado pelo trigger aparecer na
  // hora dentro do próprio dialog, sem depender de reabrir.
  const [gerenciandoId, setGerenciandoId] = useState<string | null>(null);
  const gerenciando = useMemo(() => reembolsos.find((r) => r.id === gerenciandoId) ?? null, [reembolsos, gerenciandoId]);
  const setGerenciando = (r: Reembolso | null) => setGerenciandoId(r?.id ?? null);
  const [gerenciarOpen, setGerenciarOpen] = useState(false);

  const { sortColumn, sortDirection, toggleSort } = useTableSort<ReembolsosSortColumn>();
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, filterUnidade), [periodosE, filterUnidade]);

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reembolsos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reembolsos"] }); notify.success("Solicitação excluída"); },
    onError: (e: any) => notify.error(e.message),
  });

  const filtradas = useMemo(() => reembolsos.filter((r) =>
    (filterUnidade === "all" || r.unidade === filterUnidade) &&
    (filterBsp === "all" || r.bsp === filterBsp) &&
    (filterStatus === "all" || r.status_fluxo === filterStatus) &&
    (!filterNome || matchesNameSearch(r.colaborador_beneficiario, filterNome)) &&
    (!filterPeriodoDe || r.periodo_fim >= filterPeriodoDe) &&
    (!filterPeriodoAte || r.periodo_inicio <= filterPeriodoAte),
  ).sort((a, b) => {
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "unidade": return a.unidade.localeCompare(b.unidade) * dir;
      case "bsp": return a.bsp.localeCompare(b.bsp) * dir;
      case "nome": return a.colaborador_beneficiario.localeCompare(b.colaborador_beneficiario) * dir;
      case "periodo": return a.periodo_inicio.localeCompare(b.periodo_inicio) * dir;
      case "total": return (a.valor_total - b.valor_total) * dir;
      case "status": return (
        STATUS_FLUXO_REEMBOLSO_ORDER.indexOf(a.status_fluxo === "rejeitado" ? "em_analise" : a.status_fluxo)
        - STATUS_FLUXO_REEMBOLSO_ORDER.indexOf(b.status_fluxo === "rejeitado" ? "em_analise" : b.status_fluxo)
      ) * dir;
      default: return 0;
    }
  }), [reembolsos, filterUnidade, filterBsp, filterStatus, filterNome, filterPeriodoDe, filterPeriodoAte, sortColumn, sortDirection]);

  if (l1 || l2 || l3) {
    return (
      <div className="space-y-4">
        <Card className="p-3"><div className="flex gap-2"><Skeleton className="h-8 w-44" /><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-48" /></div></Card>
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Unidade</TableHead><TableHead>BSP</TableHead><TableHead>Nome</TableHead><TableHead>Período</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableSkeleton rows={6} cols={6} />
          </Table>
        </Card>
      </div>
    );
  }

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
          <div className="space-y-0.5 w-44">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                {(Object.keys(STATUS_FLUXO_REEMBOLSO_LABEL) as StatusFluxoReembolso[]).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">{STATUS_FLUXO_REEMBOLSO_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5 w-52">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Colaborador</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterNome} onChange={(e) => setFilterNome(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - de</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={filterPeriodoDe} onChange={(e) => setFilterPeriodoDe(e.target.value)} />
          </div>
          <div className="space-y-0.5">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Período - até</Label>
            <Input type="date" className="h-8 w-36 text-xs" value={filterPeriodoAte} onChange={(e) => setFilterPeriodoAte(e.target.value)} />
          </div>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Nova solicitação
            </Button>
          </div>
        </div>
      </Card>

      {/* Desktop: tabela compacta */}
      <div className="hidden md:block">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Unidade" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Nome" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Período" column="periodo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <SortableHead label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.length === 0 ? (
                <EmptyStateRow colSpan={7} icon={Wallet} title="Nenhuma solicitação encontrada" />
              ) : filtradas.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => { setGerenciando(r); setGerenciarOpen(true); }}>
                  <TableCell>{r.unidade}</TableCell>
                  <TableCell>{r.bsp}</TableCell>
                  <TableCell>{r.colaborador_beneficiario}</TableCell>
                  <TableCell>{fmt(r.periodo_inicio)} – {fmt(r.periodo_fim)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(r.valor_total)}</TableCell>
                  <TableCell>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_FLUXO_REEMBOLSO_COLOR[r.status_fluxo].bg, STATUS_FLUXO_REEMBOLSO_COLOR[r.status_fluxo].text)}>
                      {STATUS_FLUXO_REEMBOLSO_LABEL[r.status_fluxo]}
                    </span>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerenciar" onClick={() => { setGerenciando(r); setGerenciarOpen(true); }}>
                        <ListChecks className="h-3.5 w-3.5" />
                      </Button>
                      {r.status_fluxo === "solicitado" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir solicitação?</AlertDialogTitle>
                              <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(r.id)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-2 md:hidden">
        {filtradas.length === 0 ? (
          <EmptyState icon={Wallet} title="Nenhuma solicitação encontrada" />
        ) : filtradas.map((r) => (
          <ReembolsoCard key={r.id} r={r} onOpen={() => { setGerenciando(r); setGerenciarOpen(true); }} />
        ))}
      </div>

      <ReembolsoFormDialog
        open={dialogOpen} onOpenChange={setDialogOpen} editing={editing}
        periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions}
      />
      <GerenciarReembolsoDialog
        reembolso={gerenciando} open={gerenciarOpen} onOpenChange={setGerenciarOpen} periodosE={periodosE}
        onEditarCabecalho={() => { setEditing(gerenciando); setGerenciarOpen(false); setDialogOpen(true); }}
      />
    </div>
  );
}

function ReembolsosPage() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Reembolsos</h1>
      </div>

      <Tabs defaultValue="relatorios">
        <TabsList>
          <TabsTrigger value="relatorios">Relatórios de Reembolsos</TabsTrigger>
          <TabsTrigger value="notas-debito">Notas de Débitos</TabsTrigger>
        </TabsList>

        <TabsContent value="relatorios" className="mt-4">
          <RelatoriosReembolsosTab />
        </TabsContent>

        <TabsContent value="notas-debito" className="mt-4">
          <Card className="p-8">
            <EmptyState icon={Wallet} title="Em breve" description="Notas de Débitos entra na próxima etapa deste módulo." />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
