import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// "xlsx-js-style" no lugar da "xlsx" normal pra exportar com cor (mesmo padrão do resto do
// módulo Despesas Extras e do Relatório Consolidado).
import * as XLSX from "xlsx-js-style";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// notas_debito/notas_debito_itens ainda não estão nos tipos gerados — cast local, mesmo padrão
// do resto do módulo.
const supabase: any = supabaseTyped;
import { matchesNameSearch } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState, EmptyStateRow } from "@/components/EmptyState";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Plus, Pencil, Trash2, ListChecks, Download } from "lucide-react";
import { notify } from "@/lib/notify";
import { parseValorForm } from "@/lib/format";
import { cn } from "@/lib/utils";
import { selectAllPages } from "@/lib/supabasePaginate";
import { planilhaColoridaComCabecalho } from "@/lib/reportHeaderColorido";
import { SortableHead, useTableSort } from "@/components/SortableTableHead";
import { type NotaDebito, type NotaDebitoItem, SACADO_FIXO } from "@/lib/notasDebito";

function fmt(d: string | null): string {
  return d ? d.split("-").reverse().join("/") : "—";
}

function fmtMoney(n: number): string {
  return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Queries ─────────────────────────────────────────────────────────────────
function useNotasDebitoQuery() {
  return useQuery<NotaDebito[]>({
    queryKey: ["notas-debito"],
    queryFn: () => selectAllPages<NotaDebito>((from, to) =>
      supabase.from("notas_debito").select("*").order("data_lancamento", { ascending: false }).range(from, to),
    ),
  });
}

function useNotaDebitoItensQuery(notaDebitoId: string | null) {
  return useQuery<NotaDebitoItem[]>({
    queryKey: ["nota-debito-itens", notaDebitoId],
    queryFn: () => selectAllPages<NotaDebitoItem>((from, to) =>
      supabase.from("notas_debito_itens").select("*").eq("nota_debito_id", notaDebitoId).order("criado_em").range(from, to),
    ),
    enabled: !!notaDebitoId,
  });
}

// ─── Relatório Excel por período — uma linha por item de despesa ───────────────────────────
export async function buscarLinhasRelatorioNotasDebito(dataInicio?: string, dataFim?: string) {
  const notas = await selectAllPages<NotaDebito>((from, to) => {
    let q = supabase.from("notas_debito").select("*").order("data_lancamento").range(from, to);
    if (dataInicio) q = q.gte("data_lancamento", dataInicio);
    if (dataFim) q = q.lte("data_lancamento", dataFim);
    return q;
  });
  const notaIds = notas.map((n) => n.id);
  const itens = notaIds.length === 0
    ? []
    : await selectAllPages<NotaDebitoItem>((from, to) =>
        supabase.from("notas_debito_itens").select("*").in("nota_debito_id", notaIds).range(from, to),
      );
  const notaPorId = new Map(notas.map((n) => [n.id, n]));
  if (itens.length === 0) {
    // Nota lançada sem nenhum item de despesa ainda — ainda assim entra no relatório, com
    // descrição/valor em branco, pra não sumir do período filtrado.
    return notas.map((n) => ({
      Número: n.numero_fornecedor,
      "Data de lançamento": fmt(n.data_lancamento),
      "Emitente (Razão Social)": n.emitente_razao_social,
      "CNPJ Emitente": n.emitente_cnpj ?? "—",
      BSP: n.bsp,
      "Descrição da despesa": "—",
      Valor: 0,
      "Valor total da nota": n.valor_total,
      Contato: n.contato ?? "—",
      Vencimento: fmt(n.vencimento),
      "Forma de pagamento": n.forma_pagamento ?? "—",
      Observações: n.observacoes ?? "—",
    }));
  }
  return itens.map((it) => {
    const n = notaPorId.get(it.nota_debito_id);
    return {
      Número: n?.numero_fornecedor ?? "—",
      "Data de lançamento": fmt(n?.data_lancamento ?? null),
      "Emitente (Razão Social)": n?.emitente_razao_social ?? "—",
      "CNPJ Emitente": n?.emitente_cnpj ?? "—",
      BSP: n?.bsp ?? "—",
      "Descrição da despesa": it.descricao,
      Valor: it.valor,
      "Valor total da nota": n?.valor_total ?? 0,
      Contato: n?.contato ?? "—",
      Vencimento: fmt(n?.vencimento ?? null),
      "Forma de pagamento": n?.forma_pagamento ?? "—",
      Observações: n?.observacoes ?? "—",
    };
  });
}

export async function generateRelatorioNotasDebito(dataInicio?: string, dataFim?: string): Promise<void> {
  const rows = await buscarLinhasRelatorioNotasDebito(dataInicio, dataFim);
  const ws = planilhaColoridaComCabecalho(rows, "Relatório de Notas de Débito");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Notas de Débito");
  XLSX.writeFile(wb, `notas_debito_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── Dialog: Nova nota / Editar cabeçalho ───────────────────────────────────────────────────
const FORM_VAZIO_NOTA = {
  numeroFornecedor: "", bsp: "", dataLancamento: new Date().toISOString().slice(0, 10),
  emitenteRazaoSocial: "", emitenteCnpj: "", emitenteInscricaoEstadual: "", emitenteInscricaoMunicipal: "",
  emitenteEndereco: "", emitenteCidade: "", emitenteUf: "",
  contato: "", vencimento: "", formaPagamento: "", observacoes: "",
};

function NotaDebitoFormDialog({ open, onOpenChange, editing }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: NotaDebito | null;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(FORM_VAZIO_NOTA);
  const [bound, setBound] = useState<string | null>(null);

  if (open && editing && bound !== editing.id) {
    setF({
      numeroFornecedor: editing.numero_fornecedor, bsp: editing.bsp, dataLancamento: editing.data_lancamento,
      emitenteRazaoSocial: editing.emitente_razao_social, emitenteCnpj: editing.emitente_cnpj ?? "",
      emitenteInscricaoEstadual: editing.emitente_inscricao_estadual ?? "", emitenteInscricaoMunicipal: editing.emitente_inscricao_municipal ?? "",
      emitenteEndereco: editing.emitente_endereco ?? "", emitenteCidade: editing.emitente_cidade ?? "", emitenteUf: editing.emitente_uf ?? "",
      contato: editing.contato ?? "", vencimento: editing.vencimento ?? "", formaPagamento: editing.forma_pagamento ?? "",
      observacoes: editing.observacoes ?? "",
    });
    setBound(editing.id);
  }
  if (open && !editing && bound !== "novo") { setF(FORM_VAZIO_NOTA); setBound("novo"); }
  if (!open && bound !== null) setBound(null);

  const salvar = useMutation({
    mutationFn: async () => {
      if (!f.numeroFornecedor.trim()) throw new Error("Informe o número da nota.");
      if (!f.bsp.trim()) throw new Error("Informe o centro de custo (BSP).");
      if (!f.dataLancamento) throw new Error("Informe a data de lançamento.");
      if (!f.emitenteRazaoSocial.trim()) throw new Error("Informe a razão social do emitente.");
      const payload = {
        numero_fornecedor: f.numeroFornecedor.trim(), bsp: f.bsp.trim(), data_lancamento: f.dataLancamento,
        emitente_razao_social: f.emitenteRazaoSocial.trim(), emitente_cnpj: f.emitenteCnpj.trim() || null,
        emitente_inscricao_estadual: f.emitenteInscricaoEstadual.trim() || null,
        emitente_inscricao_municipal: f.emitenteInscricaoMunicipal.trim() || null,
        emitente_endereco: f.emitenteEndereco.trim() || null, emitente_cidade: f.emitenteCidade.trim() || null,
        emitente_uf: f.emitenteUf.trim() || null,
        sacado_razao_social: SACADO_FIXO.razaoSocial, sacado_cnpj: SACADO_FIXO.cnpj,
        sacado_inscricao_estadual: SACADO_FIXO.inscricaoEstadual, sacado_endereco: SACADO_FIXO.endereco,
        sacado_cidade: SACADO_FIXO.cidade, sacado_uf: SACADO_FIXO.uf,
        contato: f.contato.trim() || null, vencimento: f.vencimento || null,
        forma_pagamento: f.formaPagamento.trim() || null, observacoes: f.observacoes.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("notas_debito").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("notas_debito").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notas-debito"] });
      notify.success(editing ? "Nota atualizada" : "Nota lançada");
      onOpenChange(false);
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento de nota de débito"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Número (do fornecedor)</Label>
              <Input value={f.numeroFornecedor} onChange={(e) => setF({ ...f, numeroFornecedor: e.target.value })} placeholder="Ex.: 022/2026" />
            </div>
            <div>
              <Label className="text-xs">Centro de custo (BSP)</Label>
              <Input value={f.bsp} onChange={(e) => setF({ ...f, bsp: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Data de lançamento</Label>
              <Input type="date" value={f.dataLancamento} onChange={(e) => setF({ ...f, dataLancamento: e.target.value })} />
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificação do Emitente</p>
            <div>
              <Label className="text-xs">Razão Social</Label>
              <Input value={f.emitenteRazaoSocial} onChange={(e) => setF({ ...f, emitenteRazaoSocial: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">CNPJ</Label>
                <Input value={f.emitenteCnpj} onChange={(e) => setF({ ...f, emitenteCnpj: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Inscrição Estadual</Label>
                <Input value={f.emitenteInscricaoEstadual} onChange={(e) => setF({ ...f, emitenteInscricaoEstadual: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Inscrição Municipal</Label>
              <Input value={f.emitenteInscricaoMunicipal} onChange={(e) => setF({ ...f, emitenteInscricaoMunicipal: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Endereço</Label>
              <Input value={f.emitenteEndereco} onChange={(e) => setF({ ...f, emitenteEndereco: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Cidade</Label>
                <Input value={f.emitenteCidade} onChange={(e) => setF({ ...f, emitenteCidade: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">UF</Label>
                <Input value={f.emitenteUf} onChange={(e) => setF({ ...f, emitenteUf: e.target.value })} maxLength={2} />
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Identificação do Sacado (fixo)
            </p>
            <div>
              <Label className="text-xs">Razão Social</Label>
              <Input value={SACADO_FIXO.razaoSocial} disabled />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">CNPJ</Label>
                <Input value={SACADO_FIXO.cnpj} disabled />
              </div>
              <div>
                <Label className="text-xs">Inscrição Estadual</Label>
                <Input value={SACADO_FIXO.inscricaoEstadual} disabled />
              </div>
            </div>
            <div>
              <Label className="text-xs">Endereço</Label>
              <Input value={SACADO_FIXO.endereco} disabled />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Cidade</Label>
                <Input value={SACADO_FIXO.cidade} disabled />
              </div>
              <div>
                <Label className="text-xs">UF</Label>
                <Input value={SACADO_FIXO.uf} disabled />
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informações Gerais</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Contato</Label>
                <Input value={f.contato} onChange={(e) => setF({ ...f, contato: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Vencimento</Label>
                <Input type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Forma de pagamento</Label>
              <Input value={f.formaPagamento} onChange={(e) => setF({ ...f, formaPagamento: e.target.value })} placeholder="Ex.: BANCO ITAU AG: 5006 C/C: 11608-0" />
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

// ─── Dialog: itens de despesa (Discriminação das Despesas) ─────────────────────────────────
const NOVO_ITEM_VAZIO = { descricao: "", valor: "" };

function NotaDebitoItensDialog({ nota, open, onOpenChange, onEditarCabecalho }: {
  nota: NotaDebito | null; open: boolean; onOpenChange: (o: boolean) => void; onEditarCabecalho: () => void;
}) {
  const qc = useQueryClient();
  const notaId = nota?.id ?? null;
  const { data: itens = [] } = useNotaDebitoItensQuery(notaId);

  const [novoItem, setNovoItem] = useState(NOVO_ITEM_VAZIO);
  const [editandoItemId, setEditandoItemId] = useState<string | null>(null);
  const [bound, setBound] = useState<string | null>(null);

  if (open && nota && bound !== nota.id) {
    setNovoItem(NOVO_ITEM_VAZIO);
    setEditandoItemId(null);
    setBound(nota.id);
  }
  if (!open && bound !== null) setBound(null);

  const invalidarItens = () => {
    qc.invalidateQueries({ queryKey: ["nota-debito-itens", notaId] });
    qc.invalidateQueries({ queryKey: ["notas-debito"] }); // valor_total mudou (trigger)
  };

  const salvarItem = useMutation({
    mutationFn: async () => {
      if (!nota) return;
      if (!novoItem.descricao.trim()) throw new Error("Descreva a despesa.");
      const valorItem = parseValorForm(novoItem.valor) ?? 0;
      if (!novoItem.valor || valorItem <= 0) throw new Error("Informe um valor válido.");
      const payload = { nota_debito_id: nota.id, descricao: novoItem.descricao.trim(), valor: valorItem };
      if (editandoItemId) {
        const { error } = await supabase.from("notas_debito_itens").update(payload).eq("id", editandoItemId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("notas_debito_itens").insert(payload);
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
      const { error } = await supabase.from("notas_debito_itens").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidarItens,
    onError: (e: any) => notify.error(e.message),
  });

  if (!nota) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Nota {nota.numero_fornecedor} — {nota.emitente_razao_social}
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Editar cabeçalho" onClick={onEditarCabecalho}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            BSP {nota.bsp} · Lançado em {fmt(nota.data_lancamento)}
            {nota.vencimento && <> · Vencimento {fmt(nota.vencimento)}</>}
          </p>
          {nota.observacoes && <p className="text-xs italic text-muted-foreground">{nota.observacoes}</p>}

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discriminação das Despesas</p>
            {itens.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma despesa lançada ainda.</p>}
            <div className="space-y-2">
              {itens.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
                  <span className="flex-1">{it.descricao}</span>
                  <span className="font-semibold">{fmtMoney(it.valor)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                    setEditandoItemId(it.id);
                    setNovoItem({ descricao: it.descricao, valor: String(it.valor) });
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
              ))}
            </div>

            <div className="flex gap-2 border-t pt-2 sm:items-end">
              <div className="flex-1">
                <Label className="text-[10px]">Descrição</Label>
                <Input className="h-8 text-xs" value={novoItem.descricao} onChange={(e) => setNovoItem({ ...novoItem, descricao: e.target.value })} />
              </div>
              <div className="w-32">
                <Label className="text-[10px]">Valor</Label>
                <Input type="text" inputMode="decimal" className="h-8 text-xs" value={novoItem.valor} onChange={(e) => setNovoItem({ ...novoItem, valor: e.target.value })} />
              </div>
              <Button size="sm" className="h-8 shrink-0" onClick={() => salvarItem.mutate()} disabled={salvarItem.isPending}>
                {editandoItemId ? "Salvar" : <Plus className="h-4 w-4" />}
              </Button>
              {editandoItemId && (
                <Button size="sm" variant="ghost" className="h-8 shrink-0" onClick={() => { setEditandoItemId(null); setNovoItem(NOVO_ITEM_VAZIO); }}>
                  Cancelar
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>Total a Pagar</span><span>{fmtMoney(nota.valor_total)}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card mobile ─────────────────────────────────────────────────────────────
function NotaDebitoCard({ n, onOpen }: { n: NotaDebito; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer space-y-1.5 p-3" onClick={onOpen}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{n.emitente_razao_social}</span>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{n.numero_fornecedor}</span>
      </div>
      <p className="text-xs text-muted-foreground">BSP {n.bsp}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{fmt(n.data_lancamento)}</span>
        <span className="font-semibold">{fmtMoney(n.valor_total)}</span>
      </div>
    </Card>
  );
}

// ─── Aba Nota de Débito (quadro detalhado) ──────────────────────────────────────────────────
type NotasDebitoSortColumn = "numero" | "emitente" | "bsp" | "data" | "vencimento" | "total";

export function NotaDebitoTab() {
  const qc = useQueryClient();
  const { data: notas = [], isLoading } = useNotasDebitoQuery();

  const [filterBsp, setFilterBsp] = useState("");
  const [filterEmitente, setFilterEmitente] = useState("");
  const [filterNumero, setFilterNumero] = useState("");
  const [filterPeriodoDe, setFilterPeriodoDe] = useState("");
  const [filterPeriodoAte, setFilterPeriodoAte] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NotaDebito | null>(null);
  const [gerenciandoId, setGerenciandoId] = useState<string | null>(null);
  const gerenciando = useMemo(() => notas.find((n) => n.id === gerenciandoId) ?? null, [notas, gerenciandoId]);
  const setGerenciando = (n: NotaDebito | null) => setGerenciandoId(n?.id ?? null);
  const [gerenciarOpen, setGerenciarOpen] = useState(false);
  const [exportando, setExportando] = useState(false);

  const { sortColumn, sortDirection, toggleSort } = useTableSort<NotasDebitoSortColumn>();

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notas_debito").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notas-debito"] }); notify.success("Nota excluída"); },
    onError: (e: any) => notify.error(e.message),
  });

  const filtradas = useMemo(() => notas.filter((n) =>
    (!filterBsp || n.bsp.toLowerCase().includes(filterBsp.toLowerCase())) &&
    (!filterEmitente || matchesNameSearch(n.emitente_razao_social, filterEmitente)) &&
    (!filterNumero || n.numero_fornecedor.toLowerCase().includes(filterNumero.toLowerCase())) &&
    (!filterPeriodoDe || n.data_lancamento >= filterPeriodoDe) &&
    (!filterPeriodoAte || n.data_lancamento <= filterPeriodoAte),
  ).sort((a, b) => {
    if (!sortColumn) return 0;
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortColumn) {
      case "numero": return a.numero_fornecedor.localeCompare(b.numero_fornecedor) * dir;
      case "emitente": return a.emitente_razao_social.localeCompare(b.emitente_razao_social) * dir;
      case "bsp": return a.bsp.localeCompare(b.bsp) * dir;
      case "data": return a.data_lancamento.localeCompare(b.data_lancamento) * dir;
      case "vencimento": return (a.vencimento ?? "").localeCompare(b.vencimento ?? "") * dir;
      case "total": return (a.valor_total - b.valor_total) * dir;
      default: return 0;
    }
  }), [notas, filterBsp, filterEmitente, filterNumero, filterPeriodoDe, filterPeriodoAte, sortColumn, sortDirection]);

  const exportar = async () => {
    setExportando(true);
    try {
      await generateRelatorioNotasDebito(filterPeriodoDe || undefined, filterPeriodoAte || undefined);
      notify.success("Relatório exportado.");
    } catch (e: any) {
      notify.error(e.message || "Erro ao exportar.");
    } finally {
      setExportando(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card className="p-3"><div className="flex gap-2"><Skeleton className="h-8 w-44" /><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-48" /></div></Card>
        <Card>
          <Table>
            <TableHeader><TableRow><TableHead>Número</TableHead><TableHead>Emitente</TableHead><TableHead>BSP</TableHead><TableHead>Data</TableHead><TableHead>Vencimento</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
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
          <div className="space-y-0.5 w-40">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">BSP</Label>
            <Input className="h-8 text-xs" placeholder="Buscar BSP..." value={filterBsp} onChange={(e) => setFilterBsp(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-52">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Emitente</Label>
            <Input className="h-8 text-xs" placeholder="Buscar por nome..." value={filterEmitente} onChange={(e) => setFilterEmitente(e.target.value)} />
          </div>
          <div className="space-y-0.5 w-36">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Número</Label>
            <Input className="h-8 text-xs" placeholder="Ex.: 022/2026" value={filterNumero} onChange={(e) => setFilterNumero(e.target.value)} />
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

      <div className="hidden md:block">
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Número" column="numero" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Emitente" column="emitente" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="BSP" column="bsp" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Data" column="data" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Vencimento" column="vencimento" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                <SortableHead label="Total" column="total" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.length === 0 ? (
                <EmptyStateRow colSpan={7} icon={Receipt} title="Nenhuma nota de débito encontrada" />
              ) : filtradas.map((n) => (
                <TableRow key={n.id} className="cursor-pointer" onClick={() => { setGerenciando(n); setGerenciarOpen(true); }}>
                  <TableCell className="font-mono text-xs">{n.numero_fornecedor}</TableCell>
                  <TableCell>{n.emitente_razao_social}</TableCell>
                  <TableCell>{n.bsp}</TableCell>
                  <TableCell>{fmt(n.data_lancamento)}</TableCell>
                  <TableCell>{fmt(n.vencimento)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(n.valor_total)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver despesas" onClick={() => { setGerenciando(n); setGerenciarOpen(true); }}>
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
                            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluir.mutate(n.id)}>
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

      <div className="space-y-2 md:hidden">
        {filtradas.length === 0 ? (
          <EmptyState icon={Receipt} title="Nenhuma nota de débito encontrada" />
        ) : filtradas.map((n) => (
          <NotaDebitoCard key={n.id} n={n} onOpen={() => { setGerenciando(n); setGerenciarOpen(true); }} />
        ))}
      </div>

      <NotaDebitoFormDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      <NotaDebitoItensDialog
        nota={gerenciando} open={gerenciarOpen} onOpenChange={setGerenciarOpen}
        onEditarCabecalho={() => { setEditing(gerenciando); setGerenciarOpen(false); setDialogOpen(true); }}
      />
    </div>
  );
}
