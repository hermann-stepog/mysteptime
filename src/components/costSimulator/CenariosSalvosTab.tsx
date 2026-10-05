import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listCostSimulations,
  fetchCostStats,
  duplicateCostSimulation,
  updateCostSimulation,
  deleteCostSimulation,
  type CostSimulationRow,
} from "@/lib/api/costSimulator.functions";
import { cidadesERotas, montarResultado } from "@/lib/costSimulator";
import { CompararCenariosDialog } from "@/components/costSimulator/CompararCenariosDialog";
import { TIPO_LABEL, formatBRL } from "@/components/costSimulator/formatacao";

// Pedido dela (2026-10-02): cenários salvos são compartilhados com o papel inteiro. Os números
// congelados no snapshot só mudam quando alguém clica em "Recalcular com custos atuais".

const LIMITE_COMPARACAO = 3;

function formatData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function rowParaInput(row: CostSimulationRow) {
  return {
    nomeCenario: row.nomeCenario,
    cliente: row.cliente,
    unidade: row.unidade,
    bsp: row.bsp,
    observacoes: row.observacoes,
    periodoReferenciaInicio: row.periodoReferenciaInicio,
    periodoReferenciaFim: row.periodoReferenciaFim,
    metodoCalculo: row.metodoCalculo,
    entradas: row.entradas,
    ajustes: row.ajustes,
    snapshotCustos: row.snapshotCustos,
    resultado: row.resultado,
    createdByName: row.createdByName,
  };
}

export function CenariosSalvosTab({ onEditar }: { onEditar: (row: CostSimulationRow) => void }) {
  const queryClient = useQueryClient();
  const {
    data: cenarios = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["cost-simulations"],
    queryFn: listCostSimulations,
  });

  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [comparando, setComparando] = useState(false);
  const [excluindo, setExcluindo] = useState<CostSimulationRow | null>(null);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return cenarios;
    return cenarios.filter(
      (c) =>
        c.nomeCenario.toLowerCase().includes(termo) ||
        (c.cliente ?? "").toLowerCase().includes(termo),
    );
  }, [cenarios, busca]);

  function alternarSelecao(id: string) {
    setSelecionados((atual) => {
      if (atual.includes(id)) return atual.filter((x) => x !== id);
      if (atual.length >= LIMITE_COMPARACAO) {
        toast.error(`Você pode comparar no máximo ${LIMITE_COMPARACAO} cenários.`);
        return atual;
      }
      return [...atual, id];
    });
  }

  const duplicar = useMutation({
    mutationFn: (row: CostSimulationRow) =>
      duplicateCostSimulation(row.id, `Cópia de ${row.nomeCenario}`, row.createdByName),
    onSuccess: () => {
      toast.success("Cenário duplicado.");
      queryClient.invalidateQueries({ queryKey: ["cost-simulations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recalcular = useMutation({
    mutationFn: async (row: CostSimulationRow) => {
      const { cidades, rotas } = cidadesERotas(row.entradas);
      const stats = await fetchCostStats({
        periodoInicio: row.ajustes.periodoReferencia.inicio,
        periodoFim: row.ajustes.periodoReferencia.fim,
        cidades,
        rotas,
        bsp: row.entradas.bsp,
        hotelIds: row.ajustes.filtros.hotelIds,
        tipoTransporte: row.ajustes.filtros.tipoTransporte,
      });
      const resultado = montarResultado(row.entradas, row.ajustes, stats);
      return updateCostSimulation(row.id, {
        ...rowParaInput(row),
        snapshotCustos: stats,
        resultado,
      });
    },
    onSuccess: () => {
      toast.success("Cenário recalculado com os custos atuais.");
      queryClient.invalidateQueries({ queryKey: ["cost-simulations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: (id: string) => deleteCostSimulation(id),
    onSuccess: (_, id) => {
      setSelecionados((s) => s.filter((x) => x !== id));
      setExcluindo(null);
      toast.success("Cenário excluído.");
      queryClient.invalidateQueries({ queryKey: ["cost-simulations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cenariosSelecionados = cenarios.filter((c) => selecionados.includes(c.id));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome ou cliente"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={selecionados.length < 2}
          onClick={() => setComparando(true)}
        >
          Comparar ({selecionados.length}/{LIMITE_COMPARACAO})
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando cenários...</p>}
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {!isLoading && !error && filtrados.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum cenário salvo ainda.</p>
      )}

      {filtrados.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1.5 pr-2 w-8" />
                <th className="py-1.5 pr-2">Cenário</th>
                <th className="py-1.5 pr-2">Tipo</th>
                <th className="py-1.5 pr-2">Cliente</th>
                <th className="py-1.5 pr-2 text-right">Total</th>
                <th className="py-1.5 pr-2">Criado por</th>
                <th className="py-1.5 pr-2">Data</th>
                <th className="py-1.5 pr-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => {
                const marcado = selecionados.includes(c.id);
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => alternarSelecao(c.id)}
                        aria-label={`Selecionar ${c.nomeCenario} para comparar`}
                      />
                    </td>
                    <td className="py-1.5 pr-2 font-medium">{c.nomeCenario}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="secondary">{TIPO_LABEL[c.entradas.tipo]}</Badge>
                    </td>
                    <td className="py-1.5 pr-2">{c.cliente ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right font-medium">
                      {formatBRL(c.resultado.total)}
                    </td>
                    <td className="py-1.5 pr-2">{c.createdByName ?? "—"}</td>
                    <td className="py-1.5 pr-2">{formatData(c.createdAt)}</td>
                    <td className="py-1.5 pr-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Abrir / editar"
                          onClick={() => onEditar(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Duplicar"
                          onClick={() => duplicar.mutate(c)}
                          disabled={duplicar.isPending}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Recalcular com custos atuais"
                          onClick={() => recalcular.mutate(c)}
                          disabled={recalcular.isPending}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Excluir"
                          onClick={() => setExcluindo(c)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CompararCenariosDialog
        open={comparando}
        onOpenChange={setComparando}
        cenarios={cenariosSelecionados}
      />

      <AlertDialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cenário?</AlertDialogTitle>
            <AlertDialogDescription>
              "{excluindo?.nomeCenario}" será apagado para todo o time de Orçamentos e Projetos.
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => excluindo && excluir.mutate(excluindo.id)}
              disabled={excluir.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
