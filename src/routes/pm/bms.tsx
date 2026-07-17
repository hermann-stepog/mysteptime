import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bms/bm_lines_* ainda não existem no schema gerado (types.ts) — mesmo cast local já usado
// em admin/bm.tsx, admin/rates.tsx e admin/nominations.tsx.
const supabase: any = supabaseTyped;
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/notify";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Check, X, FileSpreadsheet, ChevronRight } from "lucide-react";
import { type Bm, type BmLineMo, type BmLineLogistica, type BmLineMateriais, STATUS_LABELS, STATUS_TONE } from "@/lib/bm";
import { pageTitle } from "@/lib/pageTitle";

export const Route = createFileRoute("/pm/bms")({ head: () => pageTitle("BMs para Aprovar"), component: PmBmsPage });

function fmt(d: string): string {
  return d.split("-").reverse().join("/");
}
function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function PmBmsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Bm | null>(null);
  const [comment, setComment] = useState("");

  const { data: bms = [], isLoading } = useQuery({
    queryKey: ["pm-bms-pendentes"],
    queryFn: async () => {
      // A RLS já restringe isso ao PM responsável pelo projeto de cada BM.
      const { data, error } = await supabase.from("bms").select("*").eq("current_status", "pending_pm").order("created_at");
      if (error) throw error;
      return (data ?? []) as Bm[];
    },
  });

  const { data: linhas } = useQuery({
    queryKey: ["pm-bm-linhas", selected?.id],
    enabled: !!selected,
    queryFn: async () => {
      const [mo, logistica, materiais] = await Promise.all([
        supabase.from("bm_lines_mo").select("*").eq("bm_id", selected!.id),
        supabase.from("bm_lines_logistica").select("*").eq("bm_id", selected!.id),
        supabase.from("bm_lines_materiais").select("*").eq("bm_id", selected!.id),
      ]);
      if (mo.error) throw mo.error;
      if (logistica.error) throw logistica.error;
      if (materiais.error) throw materiais.error;
      return {
        mo: (mo.data ?? []) as BmLineMo[],
        logistica: (logistica.data ?? []) as BmLineLogistica[],
        materiais: (materiais.data ?? []) as BmLineMateriais[],
      };
    },
  });

  const decidir = useMutation({
    mutationFn: async (decision: "approve" | "reject") => {
      if (!selected) return;
      if (decision === "reject" && !comment.trim()) throw new Error("Informe o motivo da rejeição.");
      const nextStatus = decision === "approve" ? "approved" : "rejected";
      const { error: e1 } = await supabase.from("bms").update({
        current_status: nextStatus,
        rejection_reason: decision === "reject" ? comment.trim() : null,
      }).eq("id", selected.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("bm_status_history").insert({
        bm_id: selected.id, status: nextStatus,
        changed_by_name: profile?.full_name ?? profile?.email ?? "PM",
        notes: comment.trim() || null,
      });
      if (e2) throw e2;
    },
    onSuccess: (_r, decision) => {
      qc.invalidateQueries({ queryKey: ["pm-bms-pendentes"] });
      notify.success(decision === "approve" ? "BM aprovado." : "BM rejeitado.");
      setSelected(null);
      setComment("");
    },
    onError: (e: any) => notify.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">BMs para Aprovar</h1>
        <p className="text-sm text-muted-foreground">Boletins de Medição aguardando sua aprovação.</p>
      </div>

      {isLoading ? null : bms.length === 0 ? (
        <Card className="p-4"><EmptyState icon={FileSpreadsheet} title="Nenhum BM pendente de aprovação" /></Card>
      ) : (
        <div className="space-y-3">
          {bms.map((bm) => (
            <Card key={bm.id} className="cursor-pointer p-4 transition-shadow hover:shadow-md" onClick={() => setSelected(bm)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">{bm.client_name} — {bm.vessel}</p>
                  <p className="text-xs text-muted-foreground">{fmt(bm.period_start)} – {fmt(bm.period_end)} · {fmtMoney(bm.total_geral)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={STATUS_TONE[bm.current_status]}>{STATUS_LABELS[bm.current_status]}</StatusBadge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) { setSelected(null); setComment(""); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.client_name} — {selected?.vessel}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">{fmt(selected.period_start)} – {fmt(selected.period_end)}</p>

              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>Mão de Obra</span><span>{fmtMoney(selected.total_mo)}</span></div>
                <div className="flex justify-between"><span>Logística</span><span>{fmtMoney(selected.total_logistica)}</span></div>
                <div className="flex justify-between"><span>Materiais</span><span>{fmtMoney(selected.total_materiais)}</span></div>
                <div className="flex justify-between border-t pt-1 font-semibold"><span>Total geral</span><span>{fmtMoney(selected.total_geral)}</span></div>
              </div>

              {linhas && linhas.mo.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Mão de Obra</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Colaborador</TableHead><TableHead>Função</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {linhas.mo.map((l) => (
                        <TableRow key={l.id}><TableCell>{l.colaborador_nome}</TableCell><TableCell>{l.funcao}</TableCell><TableCell>{fmtMoney(l.valor_total)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {linhas && linhas.logistica.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Logística</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Fornecedor</TableHead><TableHead>Valor</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {linhas.logistica.map((l) => (
                        <TableRow key={l.id}><TableCell>{l.cost_type}</TableCell><TableCell>{l.vendor_name ?? "—"}</TableCell><TableCell>{fmtMoney(l.amount)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {linhas && linhas.materiais.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Habitat / Rentals / Consumíveis</h3>
                  <Table>
                    <TableHeader><TableRow><TableHead>Categoria</TableHead><TableHead>Descrição</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {linhas.materiais.map((l) => (
                        <TableRow key={l.id}><TableCell>{l.categoria}</TableCell><TableCell>{l.descricao}</TableCell><TableCell>{fmtMoney(l.valor_total)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div>
                <Textarea placeholder="Comentário (obrigatório apenas para rejeitar)" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => decidir.mutate("reject")} loading={decidir.isPending && decidir.variables === "reject"}>
              <X className="mr-1.5 h-4 w-4" />Rejeitar
            </Button>
            <Button onClick={() => decidir.mutate("approve")} loading={decidir.isPending && decidir.variables === "approve"}>
              <Check className="mr-1.5 h-4 w-4" />Aprovar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
