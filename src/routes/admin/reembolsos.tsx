import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// "xlsx-js-style" no lugar da "xlsx" normal pra exportar com cor (pedido dela, 2026-10-19/20,
// mesmo visual do Relatório Consolidado) — é um fork com a mesma API da lib "xlsx" original.
import * as XLSX from "xlsx-js-style";
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
import { NomeUsuarioField, MotivoField } from "@/components/LogisticaFormFields";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wallet, Plus, Pencil, Trash2, Camera, Paperclip, Download, ListChecks,
} from "lucide-react";
import { notify } from "@/lib/notify";
import { parseValorForm } from "@/lib/format";
import { pageTitle } from "@/lib/pageTitle";
import { cn } from "@/lib/utils";
import { selectAllPages } from "@/lib/supabasePaginate";
import { planilhaColoridaComCabecalho } from "@/lib/reportHeaderColorido";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import {
  CATEGORIAS_REEMBOLSO, MOTIVOS_REEMBOLSO,
  type Reembolso, type ReembolsoItem, type ReembolsoAnexo,
  type CategoriaReembolso, type TipoAnexoReembolso,
} from "@/lib/reembolsos";
import { useAuth } from "@/hooks/useAuth";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { NotaDebitoTab } from "@/components/despesasExtras/NotaDebitoTab";

export const Route = createFileRoute("/admin/reembolsos")({ head: () => pageTitle("Despesas Extras"), component: DespesasExtrasPage });

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

function useReembolsoAnexosQuery(reembolsoId: string | null) {
  return useQuery<ReembolsoAnexo[]>({
    queryKey: ["reembolso-anexos", reembolsoId],
    queryFn: () => selectAllPages<ReembolsoAnexo>((from, to) =>
      supabase.from("reembolso_anexos").select("*").eq("reembolso_id", reembolsoId).order("enviado_em").range(from, to),
    ),
    enabled: !!reembolsoId,
  });
}

// ─── Relatório Excel por período (pedido dela, 2026-10-20: não existia antes) — uma linha por
// item de despesa, juntando com o cabeçalho (reembolso) pra trazer Código/Solicitante/Unidade.
export async function buscarLinhasRelatorioReembolsos(dataInicio?: string, dataFim?: string) {
  const itens = await selectAllPages<ReembolsoItem>((from, to) => {
    let q = supabase.from("reembolso_itens").select("*").order("data_despesa").range(from, to);
    if (dataInicio) q = q.gte("data_despesa", dataInicio);
    if (dataFim) q = q.lte("data_despesa", dataFim);
    return q;
  });
  const reembolsoIds = Array.from(new Set(itens.map((it) => it.reembolso_id)));
  const reembolsos = reembolsoIds.length === 0
    ? []
    : await selectAllPages<Reembolso>((from, to) =>
        supabase.from("reembolsos").select("*").in("id", reembolsoIds).range(from, to),
      );
  const reembolsoPorId = new Map(reembolsos.map((r) => [r.id, r]));
  return itens.map((it) => {
    const r = reembolsoPorId.get(it.reembolso_id);
    return {
      Código: r?.codigo ?? "—",
      "Data da despesa": fmt(it.data_despesa),
      Solicitante: r?.solicitante ?? "—",
      "Colaborador beneficiário": r?.colaborador_beneficiario ?? "—",
      Unidade: r?.unidade ?? "—",
      BSP: it.bsp,
      Motivo: it.motivo ?? "—",
      Categoria: it.categoria === "Outros" ? (it.categoria_outro ?? "Outros") : it.categoria,
      Valor: it.valor,
      "Valor total do pedido": r?.valor_total ?? 0,
      Observações: r?.observacoes ?? "—",
    };
  });
}

export async function generateRelatorioReembolsos(dataInicio?: string, dataFim?: string): Promise<void> {
  const rows = await buscarLinhasRelatorioReembolsos(dataInicio, dataFim);
  const ws = planilhaColoridaComCabecalho(rows, "Relatório de Reembolsos");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Reembolsos");
  XLSX.writeFile(wb, `reembolsos_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Anexos (upload/download direto via Supabase Storage — sem server function, mesmo
// padrão do BM Mob/Desmob) ──────────────────────────────────────────────────────────────────
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
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" className="text-muted-foreground hover:text-destructive" title="Remover">
              <Trash2 className="h-3 w-3" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Tem certeza que deseja excluir?</AlertDialogTitle>
              <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onDelete}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
        // Não seta status_fluxo/codigo aqui de propósito — o banco cuida sozinho (DEFAULT
        // 'solicitado' e o trigger assign_reembolso_codigo), já que a tela nova não tem mais
        // fluxo de aprovação (pedido dela, 2026-10-20).
        const { error } = await supabase.from("reembolsos").insert(payload);
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
        <DialogHeader><DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento de reembolso"}</DialogTitle></DialogHeader>
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

// ─── Dialog: itens de despesa + anexos (fluxo de aprovação removido, pedido dela 2026-10-20 —
// itens sempre editáveis, inclusive em solicitações antigas que tinham outro status) ─────────
const NOVO_ITEM_VAZIO = { dataDespesa: "", bsp: "", motivo: "", categoria: "Alimentação" as CategoriaReembolso, categoriaOutro: "", valor: "" };

function ReembolsoItensDialog({ reembolso, open, onOpenChange, periodosE, onEditarCabecalho }: {
  reembolso: Reembolso | null; open: boolean; onOpenChange: (o: boolean) => void;
  periodosE: HistNovoPeriodo[]; onEditarCabecalho: () => void;
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const displayName = profile?.full_name || profile?.email || "Usuário";
  const reembolsoId = reembolso?.id ?? null;

  const { data: itens = [] } = useReembolsoItensQuery(reembolsoId);
  const { data: anexos = [] } = useReembolsoAnexosQuery(reembolsoId);

  const [novoItem, setNovoItem] = useState(NOVO_ITEM_VAZIO);
  const [editandoItemId, setEditandoItemId] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);

  if (open && reembolso && bound !== reembolso.id) {
    setNovoItem({ ...NOVO_ITEM_VAZIO, bsp: reembolso.bsp });
    setEditandoItemId(null);
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
      if (!novoItem.bsp) throw new Error("Selecione o centro de custo (BSP).");
      const valorItem = parseValorForm(novoItem.valor) ?? 0;
      if (!novoItem.valor || valorItem <= 0) throw new Error("Informe um valor válido.");
      if (novoItem.categoria === "Outros" && !novoItem.categoriaOutro.trim()) throw new Error("Descreva a categoria em \"Outros\".");
      const payload = {
        reembolso_id: reembolso.id, data_despesa: novoItem.dataDespesa, bsp: novoItem.bsp,
        motivo: novoItem.motivo.trim() || null,
        categoria: novoItem.categoria, categoria_outro: novoItem.categoria === "Outros" ? novoItem.categoriaOutro.trim() : null,
        valor: valorItem,
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

  const anexosPorItem = useMemo(() => {
    const m = new Map<string, ReembolsoAnexo[]>();
    anexos.filter((a) => a.item_id).forEach((a) => m.set(a.item_id!, [...(m.get(a.item_id!) ?? []), a]));
    return m;
  }, [anexos]);

  if (!reembolso) return null;
  const anexosGerais = anexos.filter((a) => !a.item_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reembolso.codigo} — {reembolso.colaborador_beneficiario}
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Editar cabeçalho" onClick={onEditarCabecalho}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {reembolso.unidade} · BSP {reembolso.bsp} · Solicitante: {reembolso.solicitante} · {fmt(reembolso.periodo_inicio)} – {fmt(reembolso.periodo_fim)}
          </p>
          {reembolso.observacoes && <p className="text-xs italic text-muted-foreground">{reembolso.observacoes}</p>}

          {/* Itens de despesa */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens de despesa</p>
            {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhum item lançado ainda.</p>}
            <div className="space-y-2">
              {itens.map((it) => {
                const anexosItem = anexosPorItem.get(it.id) ?? [];
                return (
                  <div key={it.id} className="space-y-1.5 rounded-md border p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{fmt(it.data_despesa)}</span>
                        <span className="text-muted-foreground">BSP {it.bsp}</span>
                        {it.motivo && <span className="text-muted-foreground">{it.motivo}</span>}
                        <span className="text-muted-foreground">{it.categoria === "Outros" ? it.categoria_outro : it.categoria}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{fmtMoney(it.valor)}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                          setEditandoItemId(it.id);
                          setNovoItem({ dataDespesa: it.data_despesa, bsp: it.bsp, motivo: it.motivo ?? "", categoria: it.categoria, categoriaOutro: it.categoria_outro ?? "", valor: String(it.valor) });
                        }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Tem certeza que deseja excluir?</AlertDialogTitle>
                              <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluirItem.mutate(it.id)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {anexosItem.map((a) => (
                        <AnexoChip key={a.id} anexo={a} onDelete={() => excluirAnexo.mutate(a)} />
                      ))}
                      <BotoesAnexo onSelect={(file) => enviarAnexo.mutate({ itemId: it.id, tipo: "nota_fiscal", file })} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-2 border-t pt-2 sm:grid-cols-6 sm:items-end">
              <div>
                <Label className="text-[10px]">Data</Label>
                <Input type="date" className="h-8 text-xs" value={novoItem.dataDespesa} onChange={(e) => setNovoItem({ ...novoItem, dataDespesa: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Centro de custo (BSP)</Label>
                <Select value={novoItem.bsp} onValueChange={(v) => setNovoItem({ ...novoItem, bsp: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{bspOptions.map((b) => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">Motivo</Label>
                <MotivoField value={novoItem.motivo} onChange={(v) => setNovoItem({ ...novoItem, motivo: v })} options={MOTIVOS_REEMBOLSO} />
              </div>
              <div>
                <Label className="text-[10px]">Com o que foi utilizado</Label>
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
                  <Input type="text" inputMode="decimal" className="h-8 text-xs" value={novoItem.valor} onChange={(e) => setNovoItem({ ...novoItem, valor: e.target.value })} />
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
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{r.codigo}</span>
      </div>
      <p className="text-xs text-muted-foreground">{r.unidade} · BSP {r.bsp}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{fmt(r.periodo_inicio)} – {fmt(r.periodo_fim)}</span>
        <span className="font-semibold">{fmtMoney(r.valor_total)}</span>
      </div>
    </Card>
  );
}

// ─── Aba Reembolsos (quadro detalhado: filtro por período + lançamento + exportar) ──────────
type ReembolsosSortColumn = "codigo" | "unidade" | "bsp" | "nome" | "periodo" | "total";

function ReembolsosTab() {
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
  const [filterNome, setFilterNome] = useState("");
  const [filterPeriodoDe, setFilterPeriodoDe] = useState("");
  const [filterPeriodoAte, setFilterPeriodoAte] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reembolso | null>(null);
  // Guarda só o id — deriva o registro "ao vivo" da lista, pra o total recalculado pelo
  // trigger aparecer na hora dentro do próprio dialog, sem depender de reabrir.
  const [gerenciandoId, setGerenciandoId] = useState<string | null>(null);
  const gerenciando = useMemo(() => reembolsos.find((r) => r.id === gerenciandoId) ?? null, [reembolsos, gerenciandoId]);
  const setGerenciando = (r: Reembolso | null) => setGerenciandoId(r?.id ?? null);
  const [gerenciarOpen, setGerenciarOpen] = useState(false);
  const [exportando, setExportando] = useState(false);

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
    (!filterNome || matchesNameSearch(r.colaborador_beneficiario, filterNome)) &&
    (!filterPeriodoDe || r.periodo_fim >= filterPeriodoDe) &&
    (!filterPeriodoAte || r.periodo_inicio <= filterPeriodoAte),
  ).sort((a, b) => {
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "codigo": return a.codigo.localeCompare(b.codigo) * dir;
      case "unidade": return a.unidade.localeCompare(b.unidade) * dir;
      case "bsp": return a.bsp.localeCompare(b.bsp) * dir;
      case "nome": return a.colaborador_beneficiario.localeCompare(b.colaborador_beneficiario) * dir;
      case "periodo": return a.periodo_inicio.localeCompare(b.periodo_inicio) * dir;
      case "total": return (a.valor_total - b.valor_total) * dir;
      default: return 0;
    }
  }), [reembolsos, filterUnidade, filterBsp, filterNome, filterPeriodoDe, filterPeriodoAte, sortColumn, sortDirection]);

  const exportar = async () => {
    setExportando(true);
    try {
      await generateRelatorioReembolsos(filterPeriodoDe || undefined, filterPeriodoAte || undefined);
      notify.success("Relatório exportado.");
    } catch (e: any) {
      notify.error(e.message || "Erro ao exportar.");
    } finally {
      setExportando(false);
    }
  };

  if (l1 || l2 || l3) {
    return (
      <div className="space-y-4">
        <Card className="p-3"><div className="flex gap-2"><Skeleton className="h-8 w-44" /><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-48" /></div></Card>
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Unidade</TableHead><TableHead>BSP</TableHead><TableHead>Nome</TableHead><TableHead>Período</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
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
            <Button variant="outline" onClick={exportar} disabled={exportando}>
              <Download className="mr-1.5 h-4 w-4" />{exportando ? "Exportando..." : "Exportar"}
            </Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Novo lançamento
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
                <SortableHead label="Código" column="codigo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Unidade" column="unidade" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Nome" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Período" column="periodo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.length === 0 ? (
                <EmptyStateRow colSpan={7} icon={Wallet} title="Nenhuma solicitação encontrada" />
              ) : filtradas.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => { setGerenciando(r); setGerenciarOpen(true); }}>
                  <TableCell className="font-mono text-xs">{r.codigo}</TableCell>
                  <TableCell>{r.unidade}</TableCell>
                  <TableCell>{r.bsp}</TableCell>
                  <TableCell>{r.colaborador_beneficiario}</TableCell>
                  <TableCell>{fmt(r.periodo_inicio)} – {fmt(r.periodo_fim)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(r.valor_total)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver itens" onClick={() => { setGerenciando(r); setGerenciarOpen(true); }}>
                        <ListChecks className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Tem certeza que deseja excluir?</AlertDialogTitle>
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
      <ReembolsoItensDialog
        reembolso={gerenciando} open={gerenciarOpen} onOpenChange={setGerenciarOpen} periodosE={periodosE}
        onEditarCabecalho={() => { setEditing(gerenciando); setGerenciarOpen(false); setDialogOpen(true); }}
      />
    </div>
  );
}

function DespesasExtrasPage() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">Despesas Extras</h1>
      </div>

      <Tabs defaultValue="reembolsos">
        <TabsList>
          <TabsTrigger value="reembolsos">Reembolsos</TabsTrigger>
          <TabsTrigger value="notas-debito">Nota de Débito</TabsTrigger>
        </TabsList>

        <TabsContent value="reembolsos" className="mt-4">
          <ReembolsosTab />
        </TabsContent>

        <TabsContent value="notas-debito" className="mt-4">
          <NotaDebitoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
