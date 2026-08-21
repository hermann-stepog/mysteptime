import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase as supabaseTyped } from "@/integrations/supabase/client";
// bm_mob_desmob_costs/markups ainda não estão no types.ts gerado — mesmo padrão do resto do módulo de BM.
const supabase: any = supabaseTyped;
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, Percent, Car, BedDouble } from "lucide-react";
import { type BmMobDesmobCost, type TipoMarkup } from "@/lib/bm";

function fmtMoney(n: number): string {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Mesma fórmula de src/components/bm/MobDesmobTab.tsx — pura, então duplicar as poucas linhas
// aqui é mais simples do que acoplar os dois arquivos por causa de uma função de 3 linhas.
function calcularValorComMarkup(valorBase: number, tipo: TipoMarkup, percentualLucro: number, percentualImposto: number): number {
  const bruto = valorBase * (1 + percentualLucro / 100);
  if (tipo === "simples") return round2(bruto);
  return round2(bruto / (1 - percentualImposto / 100));
}

interface AplicarCustoMobDesmobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bsp: string;
  // Número(s) do BM já escolhido(s) no cabeçalho do assistente — aplica direto nele(s), sem
  // precisar buscar/selecionar de novo numa lista (diferente do fluxo da aba Logística
  // Mob/Desmob, que não sabe de antemão qual BM é o alvo).
  bmNumber: string;
}

// Atalho do assistente "Gerar BM": em vez de navegar pra aba Logística Mob/Desmob (o que
// perderia o progresso do cabeçalho/horas já preenchido, já que o assistente só guarda
// estado em memória até "Salvar Rascunho"), abre aqui mesmo os custos pendentes do BSP já
// selecionado e aplica direto no BM que está sendo gerado — mesmo fluxo de "Aplicar ao BM"
// (incluindo a etapa de Markup), só que sem a etapa de escolher o BM, que aqui já é conhecida.
export function AplicarCustoMobDesmobDialog({ open, onOpenChange, bsp, bmNumber }: AplicarCustoMobDesmobDialogProps) {
  const qc = useQueryClient();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [etapa, setEtapa] = useState<"lista" | "markup-ask" | "markup-form">("lista");
  const [markupTipo, setMarkupTipo] = useState<TipoMarkup>("simples");
  const [markupLucro, setMarkupLucro] = useState("15");
  const [markupImposto, setMarkupImposto] = useState("13");

  const { data: pendentes = [], isFetching } = useQuery({
    queryKey: ["bm-mob-desmob-costs-pendentes", bsp],
    enabled: open && !!bsp,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bm_mob_desmob_costs").select("*")
        .eq("bsp", bsp).eq("applied", false)
        .order("data");
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c, qtd: Number(c.qtd) || 0, valor: Number(c.valor) || 0,
        markup: c.markup == null ? null : Number(c.markup), total_cost: Number(c.total_cost) || 0,
      })) as BmMobDesmobCost[];
    },
  });

  function fecharEResetar() {
    setSelecionados(new Set());
    setEtapa("lista");
    setMarkupTipo("simples"); setMarkupLucro("15"); setMarkupImposto("13");
    onOpenChange(false);
  }

  const itensParaAplicar = useMemo(
    () => (selecionados.size > 0 ? pendentes.filter((c) => selecionados.has(c.id)) : pendentes),
    [pendentes, selecionados],
  );
  const totalParaAplicar = round2(itensParaAplicar.reduce((a, c) => a + c.total_cost, 0));

  const valorMarkupPreview = useMemo(() => {
    const lucro = Number(markupLucro.replace(",", "."));
    const imposto = Number(markupImposto.replace(",", "."));
    if (!Number.isFinite(lucro) || lucro < 0) return null;
    if (markupTipo === "com_imposto" && (!Number.isFinite(imposto) || imposto < 0 || imposto >= 100)) return null;
    const valorFinal = calcularValorComMarkup(totalParaAplicar, markupTipo, lucro, imposto);
    return { valorFinal, valorMarkup: round2(valorFinal - totalParaAplicar), lucro, imposto };
  }, [totalParaAplicar, markupTipo, markupLucro, markupImposto]);

  const aplicar = useMutation({
    mutationFn: async (incluirMarkup: { tipo: TipoMarkup; lucro: number; imposto: number | null; valorFinal: number; valorMarkup: number } | null) => {
      if (!itensParaAplicar.length) throw new Error("Nenhum custo pendente selecionado.");
      const ids = itensParaAplicar.map((c) => c.id);
      const { error } = await supabase.from("bm_mob_desmob_costs").update({
        applied: true, applied_bm_number: bmNumber, applied_at: new Date().toISOString(),
      }).in("id", ids);
      if (error) throw error;

      const { error: markupError } = await supabase.from("bm_mob_desmob_markups").insert({
        bsp, applied_bm_number: bmNumber, custo_ids: ids,
        incluiu_markup: !!incluirMarkup,
        tipo_markup: incluirMarkup?.tipo ?? null,
        percentual_lucro: incluirMarkup?.lucro ?? null,
        percentual_imposto: incluirMarkup?.imposto ?? null,
        valor_pendente_original: totalParaAplicar,
        valor_markup_calculado: incluirMarkup?.valorMarkup ?? 0,
        valor_final: incluirMarkup?.valorFinal ?? totalParaAplicar,
      });
      if (markupError) throw markupError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-costs-pendentes"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-aplicados"] });
      qc.invalidateQueries({ queryKey: ["bm-mob-desmob-markups"] });
      notify.success(`${itensParaAplicar.length} custo(s) aplicado(s) ao BM ${bmNumber}.`);
      fecharEResetar();
    },
    onError: (e: any) => notify.error(e.message || "Erro ao aplicar custos ao BM."),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) fecharEResetar(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar custo de Mob/Desmob ao BM {bmNumber || "(sem número)"}</DialogTitle>
        </DialogHeader>

        {etapa === "lista" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Custos pendentes de transporte/hotel importados na aba Logística Mob/Desmob pro BSP <strong>{bsp}</strong>.
              Marque os que quer incluir — sem marcação nenhuma, aplica todos os pendentes.
            </p>
            {isFetching ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Carregando…</p>
            ) : pendentes.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Nenhum custo pendente pra esse BSP.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox
                          checked={pendentes.every((c) => selecionados.has(c.id)) ? true : pendentes.some((c) => selecionados.has(c.id)) ? "indeterminate" : false}
                          onCheckedChange={(v) => setSelecionados(v ? new Set(pendentes.map((c) => c.id)) : new Set())}
                        />
                      </TableHead>
                      <TableHead className="text-xs">Nome</TableHead>
                      <TableHead className="text-xs">Cat.</TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                      <TableHead className="text-xs">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendentes.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Checkbox
                            checked={selecionados.has(c.id)}
                            onCheckedChange={() => setSelecionados((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            })}
                          />
                        </TableCell>
                        <TableCell className="text-xs font-medium">{c.nome}</TableCell>
                        <TableCell className="text-xs">
                          {c.categoria === "transporte" ? <Car className="h-3.5 w-3.5" /> : c.categoria === "hotel" ? <BedDouble className="h-3.5 w-3.5" /> : "Outros"}
                        </TableCell>
                        <TableCell className="text-xs">{c.data ? c.data.split("-").reverse().join("/") : "—"}</TableCell>
                        <TableCell className="text-xs font-medium">{fmtMoney(c.total_cost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-3 text-xs">
              <span>Total a aplicar: <strong>{fmtMoney(totalParaAplicar)}</strong></span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={fecharEResetar}>Cancelar</Button>
                <Button size="sm" disabled={!itensParaAplicar.length || !bmNumber} onClick={() => setEtapa("markup-ask")}>
                  <Send className="mr-1.5 h-3.5 w-3.5" />Continuar
                </Button>
              </div>
            </div>
            {!bmNumber && (
              <p className="text-[11px] text-destructive">Escolha o(s) número(s) do BM no cabeçalho antes de aplicar um custo.</p>
            )}
          </div>
        )}

        {etapa === "markup-ask" && (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-xs">
              <p>BSP <span className="font-medium">{bsp}</span> · {itensParaAplicar.length} custo(s)</p>
              <p className="mt-1">Total pendente: <span className="font-semibold">{fmtMoney(totalParaAplicar)}</span></p>
            </div>
            <p className="text-xs text-muted-foreground">Incluir markup nesse valor antes de enviar pro BM?</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => aplicar.mutate(null)} loading={aplicar.isPending}>Não</Button>
              <Button size="sm" onClick={() => setEtapa("markup-form")}>Sim</Button>
            </div>
          </div>
        )}

        {etapa === "markup-form" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Tipo de Markup</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={markupTipo} onChange={(e) => setMarkupTipo(e.target.value as TipoMarkup)}
              >
                <option value="simples">Simples (custo + %)</option>
                <option value="com_imposto">Com imposto embutido</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Percentual de Lucro (%)</Label>
                <Input type="number" step="0.01" value={markupLucro} onChange={(e) => setMarkupLucro(e.target.value)} />
              </div>
              {markupTipo === "com_imposto" && (
                <div>
                  <Label className="text-xs">Percentual de Imposto (%)</Label>
                  <Input type="number" step="0.01" value={markupImposto} onChange={(e) => setMarkupImposto(e.target.value)} />
                </div>
              )}
            </div>
            {valorMarkupPreview && (
              <div className="rounded-md border p-3 text-xs">
                <p>Valor base: <span className="font-medium">{fmtMoney(totalParaAplicar)}</span></p>
                <p>Markup: <span className="font-medium">{fmtMoney(valorMarkupPreview.valorMarkup)}</span></p>
                <p className="mt-1 border-t pt-1">Valor final: <span className="font-semibold">{fmtMoney(valorMarkupPreview.valorFinal)}</span></p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEtapa("markup-ask")}>Voltar</Button>
              <Button
                size="sm" disabled={!valorMarkupPreview} loading={aplicar.isPending}
                onClick={() => {
                  if (!valorMarkupPreview) return;
                  aplicar.mutate({
                    tipo: markupTipo, lucro: valorMarkupPreview.lucro,
                    imposto: markupTipo === "com_imposto" ? valorMarkupPreview.imposto : null,
                    valorFinal: valorMarkupPreview.valorFinal, valorMarkup: valorMarkupPreview.valorMarkup,
                  });
                }}
              >
                <Percent className="mr-1.5 h-3.5 w-3.5" />Aplicar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
