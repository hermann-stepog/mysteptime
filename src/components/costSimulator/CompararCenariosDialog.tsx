import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CostSimulationRow } from "@/lib/api/costSimulator.functions";
import { TIPO_LABEL, formatBRL } from "@/components/costSimulator/formatacao";

// Comparação lado a lado de até 3 cenários salvos (pedido dela, 2026-10-02). Usa o resultado
// congelado de cada cenário — nunca recalcula aqui.

export function CompararCenariosDialog({
  open,
  onOpenChange,
  cenarios,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cenarios: CostSimulationRow[];
}) {
  const categorias = useMemo(() => {
    const nomes = new Set<string>();
    for (const c of cenarios) for (const cat of c.resultado.porCategoria) nomes.add(cat.categoria);
    return Array.from(nomes);
  }, [cenarios]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(95vw,1100px)] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Comparar cenários</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1.5 pr-3" />
                {cenarios.map((c) => (
                  <th key={c.id} className="py-1.5 pr-3 font-medium text-foreground">
                    {c.nomeCenario}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <LinhaComparacao
                rotulo="Tipo"
                valores={cenarios.map((c) => TIPO_LABEL[c.entradas.tipo])}
              />
              <LinhaComparacao rotulo="Cliente" valores={cenarios.map((c) => c.cliente ?? "—")} />
              <LinhaComparacao rotulo="Método" valores={cenarios.map((c) => c.metodoCalculo)} />
              <LinhaComparacao
                rotulo="Pessoas"
                valores={cenarios.map((c) => String(c.resultado.totalPessoas))}
              />
              <LinhaComparacao
                rotulo="Subtotal"
                valores={cenarios.map((c) => formatBRL(c.resultado.subtotal))}
              />
              <LinhaComparacao
                rotulo="Total"
                valores={cenarios.map((c) => formatBRL(c.resultado.total))}
                destaque
              />
              <LinhaComparacao
                rotulo="Por pessoa"
                valores={cenarios.map((c) => formatBRL(c.resultado.porPessoa))}
              />
              <LinhaComparacao
                rotulo="Por mês"
                valores={cenarios.map((c) => formatBRL(c.resultado.porMes))}
              />
              <tr>
                <td
                  colSpan={cenarios.length + 1}
                  className="pt-3 pb-1 text-xs font-medium text-muted-foreground uppercase"
                >
                  Por categoria
                </td>
              </tr>
              {categorias.map((cat) => (
                <LinhaComparacao
                  key={cat}
                  rotulo={cat}
                  valores={cenarios.map((c) => {
                    const item = c.resultado.porCategoria.find((x) => x.categoria === cat);
                    return item ? formatBRL(item.subtotal) : "—";
                  })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinhaComparacao({
  rotulo,
  valores,
  destaque,
}: {
  rotulo: string;
  valores: string[];
  destaque?: boolean;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 pr-3 text-muted-foreground">{rotulo}</td>
      {valores.map((v, i) => (
        <td key={i} className={`py-1.5 pr-3 ${destaque ? "font-semibold" : ""}`}>
          {v}
        </td>
      ))}
    </tr>
  );
}
