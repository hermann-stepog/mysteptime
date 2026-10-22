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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  Wallet, Plus, Pencil, Trash2, Camera, Paperclip, Download, ListChecks, X, User, Receipt,
} from "lucide-react";
import { notify } from "@/lib/notify";
import { parseValorForm } from "@/lib/format";
import { pageTitle } from "@/lib/pageTitle";
import { cn } from "@/lib/utils";
import { selectAllPages } from "@/lib/supabasePaginate";
import { planilhaColoridaComCabecalho } from "@/lib/reportHeaderColorido";
import { bspOptionsForUnidade, DRAKE_DATA_CUTOFF, type HistNovoPeriodo } from "@/lib/histogramaNovo";
import { UNIDADES_OPERACIONAIS_FIXAS } from "@/lib/timesheetOffshore";
import { clienteDaUnidade, agruparUnidadesPorCliente } from "@/lib/clientes";
import {
  CATEGORIAS_REEMBOLSO, MOTIVOS_REEMBOLSO,
  type Reembolso, type ReembolsoItem, type ReembolsoAnexo,
  type CategoriaReembolso, type TipoAnexoReembolso, type TipoReembolso,
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
      "Colaborador beneficiário": (r?.colaborador_beneficiario ?? []).join(", ") || "—",
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
// Pedido dela, 2026-10-22: tirou "colaborador beneficiário" (sempre é o próprio solicitante
// agora) e tirou BSP do cabeçalho (cada item de despesa tem o seu próprio BSP).
const FORM_VAZIO_REEMBOLSO = {
  tipo: "colaborador" as TipoReembolso, numeroNotaDebito: "",
  solicitante: "", cliente: "", unidade: "", periodoInicio: "", periodoFim: "", observacoes: "",
};

// Sempre disponível como sugestão no campo de solicitante — não é um colaborador do Drake
// (hist_novo_colaboradores), é quem recebe quando o tipo é Nota de Débito (pedido dela,
// 2026-10-22). O campo continua texto livre, então isso é só pra aparecer como opção pronta na
// lista, sem precisar digitar.
const RIO_LAB = { id: "rio-lab", nome: "Rio Lab" };

const NOVO_ITEM_VAZIO = { dataDespesa: "", bsp: "", motivo: "", categoria: "Alimentação" as CategoriaReembolso, categoriaOutro: "", valor: "" };

// ─── Dialog unificado: cabeçalho + itens de despesa + anexos (pedido dela, 2026-10-22 — antes
// eram 2 diálogos separados, "editar cabeçalho" abria um por cima do outro; agora é tudo num só
// lugar, e itens de despesa continuam sempre editáveis, inclusive em solicitações antigas que
// tinham outro status, fluxo de aprovação removido a pedido dela em 2026-10-20).
function ReembolsoDialog({ open, onOpenChange, editing, periodosE, colaboradores, unidadeOptions, reembolsos }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: Reembolso | null;
  periodosE: HistNovoPeriodo[]; colaboradores: { id: string; nome: string }[]; unidadeOptions: string[];
  reembolsos: Reembolso[];
}) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const displayName = profile?.full_name || profile?.email || "Usuário";
  const [f, setF] = useState(FORM_VAZIO_REEMBOLSO);
  const [bound, setBound] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Id de quem acabou de ser criado nesta sessão do diálogo — existe desde a abertura se já era
  // um lançamento existente (editing), ou passa a existir assim que o cabeçalho é salvo pela 1ª
  // vez (lançamento novo), sem fechar o diálogo (isso que "unifica" as duas telas de antes).
  const [criadoId, setCriadoId] = useState<string | null>(null);
  const reembolsoId = editing?.id ?? criadoId;
  // Versão "ao vivo" do registro, pro total recalculado pelo trigger aparecer na hora.
  const reembolsoAtual = useMemo(() => reembolsos.find((r) => r.id === reembolsoId) ?? null, [reembolsos, reembolsoId]);

  if (open && editing && bound !== editing.id) {
    setF({
      tipo: editing.tipo ?? "colaborador", numeroNotaDebito: editing.numero_nota_debito ?? "",
      solicitante: editing.solicitante,
      cliente: clienteDaUnidade(editing.unidade) ?? "Cliente não identificado",
      unidade: editing.unidade,
      periodoInicio: editing.periodo_inicio, periodoFim: editing.periodo_fim,
      observacoes: editing.observacoes ?? "",
    });
    setPendingFile(null);
    setCriadoId(null);
    setBound(editing.id);
  }
  if (open && !editing && bound !== "novo") { setF(FORM_VAZIO_REEMBOLSO); setPendingFile(null); setCriadoId(null); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  // Cascata Cliente → Unidade (pedido dela, 2026-10-20) — Cliente é só um filtro de UI (não
  // persistido), igual já é feito na árvore de custos de Transporte.
  const unidadesPorCliente = useMemo(() => agruparUnidadesPorCliente(unidadeOptions), [unidadeOptions]);
  const unidadesDoCliente = useMemo(
    () => unidadesPorCliente.find((g) => g.cliente === f.cliente)?.unidades ?? [],
    [unidadesPorCliente, f.cliente],
  );
  const colaboradoresComRioLab = useMemo(() => [RIO_LAB, ...colaboradores], [colaboradores]);

  const { data: anexos = [] } = useReembolsoAnexosQuery(reembolsoId);
  const anexosFormulario = useMemo(() => anexos.filter((a) => a.tipo === "formulario"), [anexos]);
  const anexosPorItem = useMemo(() => {
    const m = new Map<string, ReembolsoAnexo[]>();
    anexos.filter((a) => a.item_id).forEach((a) => m.set(a.item_id!, [...(m.get(a.item_id!) ?? []), a]));
    return m;
  }, [anexos]);

  // Pedido dela, 2026-10-22: BSP saiu do cabeçalho — cada item de despesa tem o seu próprio BSP,
  // já que itens diferentes do mesmo lançamento podem ter BSPs diferentes. As opções seguem a
  // Unidade escolhida no cabeçalho.
  const { data: itens = [] } = useReembolsoItensQuery(reembolsoId);
  const bspOptions = useMemo(() => bspOptionsForUnidade(periodosE, f.unidade || "all"), [periodosE, f.unidade]);
  const [novoItem, setNovoItem] = useState(NOVO_ITEM_VAZIO);
  const [editandoItemId, setEditandoItemId] = useState<string | null>(null);
  const [itemBound, setItemBound] = useState<string | null>(null);
  if (reembolsoId && itemBound !== reembolsoId) {
    setNovoItem(NOVO_ITEM_VAZIO);
    setEditandoItemId(null);
    setItemBound(reembolsoId);
  }

  const enviarAnexo = useMutation({
    mutationFn: async (params: { itemId: string | null; tipo: TipoAnexoReembolso; file: File }) => {
      if (!reembolsoId) return;
      await uploadReembolsoAnexo({ reembolsoId, itemId: params.itemId, tipo: params.tipo, file: params.file, enviadoPor: displayName });
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

  const salvarCabecalho = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!f.solicitante.trim()) throw new Error("Informe o solicitante.");
      if (!f.unidade) throw new Error("Selecione a unidade.");
      if (!f.periodoInicio || !f.periodoFim) throw new Error("Informe o período de referência.");
      if (f.periodoFim < f.periodoInicio) throw new Error("O fim do período não pode ser antes do início.");
      if (f.tipo === "nota_debito" && !f.numeroNotaDebito.trim()) throw new Error("Informe o número da Nota de Débito.");
      const payload = {
        tipo: f.tipo, numero_nota_debito: f.tipo === "nota_debito" ? f.numeroNotaDebito.trim() : null,
        solicitante: f.solicitante.trim(),
        colaborador_beneficiario: [f.solicitante.trim()],
        unidade: f.unidade,
        periodo_inicio: f.periodoInicio, periodo_fim: f.periodoFim,
        observacoes: f.observacoes.trim() || null,
      };
      if (reembolsoId) {
        const { error } = await supabase.from("reembolsos").update(payload).eq("id", reembolsoId);
        if (error) throw error;
        return reembolsoId;
      }
      // Não seta status_fluxo/codigo aqui de propósito — o banco cuida sozinho (DEFAULT
      // 'solicitado' e o trigger assign_reembolso_codigo), já que a tela nova não tem mais
      // fluxo de aprovação (pedido dela, 2026-10-20).
      const { data, error } = await supabase.from("reembolsos").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: async (id) => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
      if (!editing) setCriadoId(id);
      // Anexo escolhido antes de existir o registro (lançamento novo) só sobe depois do 1º
      // Salvar, já com o id gerado (pedido dela, 2026-10-20: anexar PDF no formulário mesmo).
      if (pendingFile) {
        await uploadReembolsoAnexo({ reembolsoId: id, itemId: null, tipo: "formulario", file: pendingFile, enviadoPor: displayName });
        setPendingFile(null);
        qc.invalidateQueries({ queryKey: ["reembolso-anexos", id] });
      }
      notify.success(editing ? "Dados atualizados" : "Solicitação criada — já pode lançar os itens de despesa");
    },
    onError: (e: any) => notify.error(e.message),
  });

  const invalidarItens = () => {
    qc.invalidateQueries({ queryKey: ["reembolso-itens", reembolsoId] });
    qc.invalidateQueries({ queryKey: ["reembolsos"] }); // valor_total mudou (trigger)
  };

  const salvarItem = useMutation({
    mutationFn: async () => {
      if (!reembolsoId) return;
      if (!novoItem.dataDespesa) throw new Error("Informe a data da despesa.");
      if (!novoItem.bsp) throw new Error("Selecione o centro de custo (BSP).");
      const valorItem = parseValorForm(novoItem.valor) ?? 0;
      if (!novoItem.valor || valorItem <= 0) throw new Error("Informe um valor válido.");
      if (novoItem.categoria === "Outros" && !novoItem.categoriaOutro.trim()) throw new Error("Descreva a categoria em \"Outros\".");
      const payload = {
        reembolso_id: reembolsoId, data_despesa: novoItem.dataDespesa, bsp: novoItem.bsp,
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
      setNovoItem(NOVO_ITEM_VAZIO);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reembolsoAtual ? reembolsoAtual.codigo : "Novo lançamento de reembolso"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 rounded-md border p-3">
            <div>
              <Label className="text-xs">Tipo de Reembolso</Label>
              <div className="mt-1 inline-flex rounded-md border bg-muted p-0.5">
                <button type="button" onClick={() => setF({ ...f, tipo: "colaborador" })}
                  className={cn("px-3 py-1.5 text-xs rounded transition",
                    f.tipo === "colaborador" ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
                  <User className="inline mr-1 h-3 w-3" />Colaborador
                </button>
                <button type="button" onClick={() => setF({ ...f, tipo: "nota_debito" })}
                  className={cn("px-3 py-1.5 text-xs rounded transition",
                    f.tipo === "nota_debito" ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
                  <Receipt className="inline mr-1 h-3 w-3" />Nota de Débito
                </button>
              </div>
            </div>
            {f.tipo === "nota_debito" && (
              <div>
                <Label className="text-xs">Número da Nota de Débito</Label>
                <Input value={f.numeroNotaDebito} onChange={(e) => setF({ ...f, numeroNotaDebito: e.target.value })} />
              </div>
            )}
            <div>
              <Label className="text-xs">Solicitante</Label>
              <NomeUsuarioField value={f.solicitante} onChange={(v) => setF({ ...f, solicitante: v })} colaboradores={colaboradoresComRioLab} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Cliente</Label>
                <Select value={f.cliente} onValueChange={(v) => setF({ ...f, cliente: v, unidade: "" })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{unidadesPorCliente.map((g) => <SelectItem key={g.cliente} value={g.cliente}>{g.cliente}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Unidade</Label>
                <Select value={f.unidade} onValueChange={(v) => setF({ ...f, unidade: v })} disabled={!f.cliente}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{unidadesDoCliente.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
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
            <div className="space-y-1.5 rounded-md border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anexos da solicitação</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {anexosFormulario.map((a) => (
                  <AnexoChip key={a.id} anexo={a} onDelete={() => excluirAnexo.mutate(a)} />
                ))}
                {pendingFile && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-[11px]">
                    <Paperclip className="h-3 w-3" /><span className="max-w-32 truncate">{pendingFile.name}</span>
                    <button type="button" onClick={() => setPendingFile(null)} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                <BotoesAnexo
                  disabled={enviarAnexo.isPending}
                  onSelect={(file) => { if (reembolsoId) enviarAnexo.mutate({ itemId: null, tipo: "formulario", file }); else setPendingFile(file); }}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => salvarCabecalho.mutate()} disabled={salvarCabecalho.isPending}>
                {reembolsoId ? "Salvar dados" : "Salvar e continuar"}
              </Button>
            </div>
          </div>

          {reembolsoId && (
            <>
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
                      <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setEditandoItemId(null); setNovoItem(NOVO_ITEM_VAZIO); }}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                  <span>Total</span><span>{fmtMoney(reembolsoAtual?.valor_total ?? 0)}</span>
                </div>
              </div>
            </>
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
        <span className="truncate text-sm font-medium">{r.colaborador_beneficiario.join(", ")}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{r.codigo}</span>
      </div>
      {r.tipo === "nota_debito" && (
        <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
          <Receipt className="h-2.5 w-2.5" /> ND nº {r.numero_nota_debito}
        </span>
      )}
      <p className="text-xs text-muted-foreground">{r.unidade}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{fmt(r.periodo_inicio)} – {fmt(r.periodo_fim)}</span>
        <span className="font-semibold">{fmtMoney(r.valor_total)}</span>
      </div>
    </Card>
  );
}

// ─── Aba Reembolsos (quadro detalhado: filtro por período + lançamento + exportar) ──────────
type ReembolsosSortColumn = "codigo" | "unidade" | "nome" | "periodo" | "total";

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
  const [filterNome, setFilterNome] = useState("");
  const [filterPeriodoDe, setFilterPeriodoDe] = useState("");
  const [filterPeriodoAte, setFilterPeriodoAte] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Reembolso | null>(null);
  const [exportando, setExportando] = useState(false);

  const { sortColumn, sortDirection, toggleSort } = useTableSort<ReembolsosSortColumn>();

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
    (!filterNome || r.colaborador_beneficiario.some((nome) => matchesNameSearch(nome, filterNome))) &&
    (!filterPeriodoDe || r.periodo_fim >= filterPeriodoDe) &&
    (!filterPeriodoAte || r.periodo_inicio <= filterPeriodoAte),
  ).sort((a, b) => {
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "codigo": return a.codigo.localeCompare(b.codigo) * dir;
      case "unidade": return a.unidade.localeCompare(b.unidade) * dir;
      case "nome": return a.colaborador_beneficiario.join(", ").localeCompare(b.colaborador_beneficiario.join(", ")) * dir;
      case "periodo": return a.periodo_inicio.localeCompare(b.periodo_inicio) * dir;
      case "total": return (a.valor_total - b.valor_total) * dir;
      default: return 0;
    }
  }), [reembolsos, filterUnidade, filterNome, filterPeriodoDe, filterPeriodoAte, sortColumn, sortDirection]);

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
            <Select value={filterUnidade} onValueChange={setFilterUnidade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas</SelectItem>
                {unidadeOptions.map((u) => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
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
                <SortableHead label="Nome" column="nome" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Período" column="periodo" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.length === 0 ? (
                <EmptyStateRow colSpan={6} icon={Wallet} title="Nenhuma solicitação encontrada" />
              ) : filtradas.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => { setEditing(r); setDialogOpen(true); }}>
                  <TableCell className="font-mono text-xs">{r.codigo}</TableCell>
                  <TableCell>{r.unidade}</TableCell>
                  <TableCell>
                    {r.colaborador_beneficiario.join(", ")}
                    {r.tipo === "nota_debito" && (
                      <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                        <Receipt className="h-2.5 w-2.5" /> ND nº {r.numero_nota_debito}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{fmt(r.periodo_inicio)} – {fmt(r.periodo_fim)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(r.valor_total)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver itens" onClick={() => { setEditing(r); setDialogOpen(true); }}>
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
          <ReembolsoCard key={r.id} r={r} onOpen={() => { setEditing(r); setDialogOpen(true); }} />
        ))}
      </div>

      <ReembolsoDialog
        open={dialogOpen} onOpenChange={setDialogOpen} editing={editing}
        periodosE={periodosE} colaboradores={colaboradores} unidadeOptions={unidadeOptions} reembolsos={reembolsos}
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
