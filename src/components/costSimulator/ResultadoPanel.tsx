import { useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from "recharts";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ResultadoSimulacao } from "@/lib/costSimulator";

// Etapa 3 do módulo: substitui o <pre>{JSON.stringify(...)}</pre> por KPIs, tabela formatada
// (com override manual inline por categoria) e dois gráficos (barras por categoria, linha de
// ritmo acumulado).

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const chartConfig: ChartConfig = {
  subtotal: { label: "Subtotal", color: "var(--chart-1)" },
  custoAcumulado: { label: "Custo acumulado", color: "var(--chart-2)" },
};

export function ResultadoPanel({
  resultado,
  overrides,
  onChangeOverride,
  onExportarPdf,
}: {
  resultado: ResultadoSimulacao | null;
  overrides: Record<string, number | null>;
  onChangeOverride: (chave: string, valor: number | null) => void;
  onExportarPdf: (graficos: HTMLElement[]) => Promise<void>;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const [exportando, setExportando] = useState(false);

  if (!resultado) {
    return (
      <Card className="p-4">
        <h2 className="font-medium mb-2">Resultado</h2>
        <p className="text-sm text-muted-foreground">Preencha o formulário e clique em Calcular.</p>
      </Card>
    );
  }

  const barData = resultado.porCategoria.map((c) => ({
    categoria: c.categoria,
    subtotal: c.subtotal,
  }));

  async function exportar() {
    if (!raiz.current) return;
    setExportando(true);
    try {
      await onExportarPdf(Array.from(raiz.current.querySelectorAll<HTMLElement>("[data-grafico]")));
    } catch (e) {
      toast.error(`Não foi possível gerar o PDF: ${(e as Error).message}`);
    } finally {
      setExportando(false);
    }
  }

  return (
    <div ref={raiz} className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">Resultado</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={exportar}
            disabled={exportando}
          >
            <FileDown className="h-4 w-4 mr-1" /> {exportando ? "Gerando PDF..." : "Exportar PDF"}
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Total" valor={formatBRL(resultado.total)} />
          <Kpi label="Por pessoa" valor={formatBRL(resultado.porPessoa)} />
          <Kpi label="Por mês" valor={formatBRL(resultado.porMes)} />
          <Kpi
            label={resultado.nCiclos > 0 ? "Por troca de turma/viagem" : "—"}
            valor={resultado.nCiclos > 0 ? formatBRL(resultado.porTrocaDeTurma) : "—"}
          />
        </div>
      </Card>

      <Card className="p-4 overflow-x-auto">
        <h2 className="font-medium mb-3">Custos por categoria</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-1.5 pr-2">Categoria</th>
              <th className="py-1.5 pr-2">Valor unitário</th>
              <th className="py-1.5 pr-2">Qtd</th>
              <th className="py-1.5 pr-2">Subtotal</th>
              <th className="py-1.5 pr-2">% do total</th>
            </tr>
          </thead>
          <tbody>
            {resultado.porCategoria.map((c) => (
              <tr key={c.chaveOverride} className="border-b last:border-0">
                <td className="py-1.5 pr-2">{c.categoria}</td>
                <td className="py-1.5 pr-2">
                  <Input
                    type="number"
                    step="0.01"
                    className="h-8 w-28"
                    value={overrides[c.chaveOverride] ?? ""}
                    placeholder={formatBRL(c.unitario)}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChangeOverride(c.chaveOverride, v === "" ? null : Number(v) || 0);
                    }}
                  />
                </td>
                <td className="py-1.5 pr-2">{c.qtd}</td>
                <td className="py-1.5 pr-2 font-medium">{formatBRL(c.subtotal)}</td>
                <td className="py-1.5 pr-2 text-muted-foreground">
                  {c.percentualDoTotal.toFixed(1)}%
                </td>
              </tr>
            ))}
            {resultado.porCategoria.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-muted-foreground">
                  Nenhum custo histórico encontrado pros filtros informados.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t">
              <td className="py-1.5 pr-2 font-medium">Subtotal</td>
              <td colSpan={3} />
              <td className="py-1.5 pr-2 font-medium text-right">
                {formatBRL(resultado.subtotal)}
              </td>
            </tr>
            {resultado.reajusteValor !== 0 && (
              <tr>
                <td className="py-1 pr-2 text-muted-foreground">Reajuste</td>
                <td colSpan={3} />
                <td className="py-1 pr-2 text-right">{formatBRL(resultado.reajusteValor)}</td>
              </tr>
            )}
            {resultado.contingenciaValor !== 0 && (
              <tr>
                <td className="py-1 pr-2 text-muted-foreground">Contingência</td>
                <td colSpan={3} />
                <td className="py-1 pr-2 text-right">{formatBRL(resultado.contingenciaValor)}</td>
              </tr>
            )}
            {resultado.markupValor !== 0 && (
              <tr>
                <td className="py-1 pr-2 text-muted-foreground">Markup</td>
                <td colSpan={3} />
                <td className="py-1 pr-2 text-right">{formatBRL(resultado.markupValor)}</td>
              </tr>
            )}
            <tr className="border-t text-base">
              <td className="py-2 pr-2 font-semibold">Total</td>
              <td colSpan={3} />
              <td className="py-2 pr-2 font-semibold text-right">{formatBRL(resultado.total)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {barData.length > 0 && (
        <Card className="p-4" data-grafico>
          <h2 className="font-medium mb-3">Subtotal por categoria</h2>
          <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
            <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="categoria"
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={60}
              />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="subtotal" fill="var(--color-subtotal)" radius={4} />
            </BarChart>
          </ChartContainer>
        </Card>
      )}

      {resultado.serieMensal.length > 1 && (
        <Card className="p-4" data-grafico>
          <h2 className="font-medium mb-3">Ritmo de gasto acumulado</h2>
          <ChartContainer config={chartConfig} className="aspect-auto h-[200px] w-full">
            <LineChart
              data={resultado.serieMensal}
              margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="mes"
                tickLine={false}
                axisLine={false}
                tickFormatter={(m) => `Mês ${m}`}
              />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="custoAcumulado"
                stroke="var(--color-custoAcumulado)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{valor}</p>
    </div>
  );
}
